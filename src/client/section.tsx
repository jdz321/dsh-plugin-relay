/**
 * The settings section: a six-tab page (连接 / API Keys / 模型 / 数据看板 /
 * 使用日志 / 模型能力) over the host plugin's `relay` namespace and
 * /api/relay/* routes. The keys tab creates, edits, and deletes keys through
 * the host's /api/relay/keys-* routes — key material never crosses to the
 * browser. Since v0.5.1 the keys tab follows the official Models page row↔card
 * interaction: one row per key, 「编辑」 expands that row in place into an
 * editor card (one card open at a time), Apply writes immediately, failures
 * keep the card open, and deletions go through a primitives Modal.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Modal, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { apiGet, apiPost } from './api.js'
import { CapabilitiesView, type CapData, type ModelsData } from './capabilities.js'
import { DashboardTab } from './dashboard.js'
import {
  dateInputValue,
  endOfDaySeconds,
  groupOptionLabel,
  keyMetaText,
  normalizeBaseUrlDraft,
  pointsToCnyText,
  priceText,
  setupHintFor,
} from './format.js'
import { LogsTab } from './logs.js'
import type { Translator } from './locale.js'
import { MenuSelect } from './menu-select.js'

export interface ScopeSnapshot {
  value?: Record<string, unknown>
  status?: string
  revision?: number
  writable?: boolean
}

export interface SettingsScope {
  subscribe(fn: () => void): () => void
  getSnapshot(): ScopeSnapshot
  set(field: string, value: unknown): Promise<void>
}

export interface SectionEnv {
  scope: SettingsScope
  t: Translator
}

interface StateView {
  baseUrl?: string
  userId?: number | null
  accessTokenConfigured?: boolean
  setupMissing?: string | null
  selectedKeyName?: string
  modelCount?: number
}

export interface KeyRow {
  id: number | string
  name: string
  enabled: boolean
  group?: string
  groupRatio?: number | null
  remainCny?: string | null
  remainPoints?: number
  unlimited?: boolean
  usedCny?: string
  neverExpires?: boolean
  expiredTime?: number
  selected?: boolean
}

interface KeysData {
  ok: boolean
  error?: string
  account?: { username?: string, quotaCny?: string } | null
  groups?: Record<string, string>
  /** Group billing ratios (name → ratio) for the group selector labels. */
  groupRatios?: Record<string, number>
  keys?: KeyRow[]
}

type TabId = 'connection' | 'keys' | 'models' | 'dashboard' | 'logs' | 'capabilities'

type Message = { ok: boolean, text: string } | null

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Draft of the inline create/edit key card. */
export interface KeyForm {
  mode: 'create' | 'edit'
  id?: number | string
  name: string
  group: string
  unlimitedQuota: boolean
  remainQuota: string
  expireNever: boolean
  expireDate: string
  enabled: boolean
  setAsActive: boolean
}

const EXPIRED_FOREVER = -1

/** The settings section component mounted by the entry. */
export function RelaySection(props: SectionEnv): JSX.Element {
  const { scope, t } = props
  const snapshot = useSyncExternalStore((fn) => scope.subscribe(fn), () => scope.getSnapshot())
  const value = snapshot.value ?? {}
  const readOnly = snapshot.writable === false

  const [tab, setTab] = useState<TabId>('connection')
  const [message, setMessage] = useState<Message>(null)
  const [draft, setDraft] = useState<{ baseUrl: string, userId: string, accessToken: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [state, setState] = useState<StateView | null>(null)
  const [keys, setKeys] = useState<KeysData | null>(null)
  const [keysBusy, setKeysBusy] = useState(false)
  const [useBusy, setUseBusy] = useState<string | null>(null)
  const [models, setModels] = useState<ModelsData | null>(null)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [caps, setCaps] = useState<CapData | null>(null)
  /** The one open key card: an edit target id, 'create', or none. */
  const [openKey, setOpenKey] = useState<string | null>(null)
  /** Key pending deletion (Modal target). */
  const [deleteTarget, setDeleteTarget] = useState<KeyRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    if (snapshot.status === 'ready' && draft === null) {
      setDraft({
        baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
        userId: value.userId ? String(value.userId) : '',
        accessToken: '',
      })
    }
  }, [snapshot.status, draft, value.baseUrl, value.userId])

  const refreshState = useCallback((): void => {
    apiGet('/api/relay/state').then((body) => setState((body.state ?? null) as StateView)).catch(() => setState(null))
  }, [])
  useEffect(() => {
    refreshState()
  }, [refreshState, snapshot.revision])

  const refreshKeys = useCallback((): void => {
    setKeysBusy(true)
    apiGet('/api/relay/keys')
      .then((body) => setKeys(body as unknown as KeysData))
      .catch((err) => setKeys({ ok: false, error: errText(err) }))
      .finally(() => setKeysBusy(false))
  }, [])
  useEffect(() => {
    refreshKeys()
  }, [refreshKeys])

  const refreshModels = useCallback((): void => {
    setModelsBusy(true)
    apiGet('/api/relay/models')
      .then((body) => setModels(body as unknown as ModelsData))
      .catch((err) => setModels({ ok: false, error: errText(err) }))
      .finally(() => setModelsBusy(false))
  }, [])
  useEffect(() => {
    refreshModels()
  }, [refreshModels])

  const refreshCaps = useCallback((): void => {
    apiGet('/api/relay/capabilities')
      .then((body) => setCaps(body as unknown as CapData))
      .catch((err) => setCaps({ ok: false, error: errText(err) }))
  }, [])
  useEffect(() => {
    refreshCaps()
  }, [refreshCaps])

  const draftDirty = draft !== null
    && (normalizeBaseUrlDraft(draft.baseUrl) !== (typeof value.baseUrl === 'string' ? value.baseUrl : '')
      || (draft.userId.trim() === '' ? 0 : Number(draft.userId.trim())) !== (typeof value.userId === 'number' ? value.userId : 0)
      || draft.accessToken !== '')
  const saveDraft = async (): Promise<void> => {
    if (draft === null) return
    setSaving(true)
    setMessage(null)
    try {
      const nextBaseUrl = normalizeBaseUrlDraft(draft.baseUrl)
      if (nextBaseUrl !== (typeof value.baseUrl === 'string' ? value.baseUrl : '')) await scope.set('baseUrl', nextBaseUrl)
      const nextUserId = draft.userId.trim() === '' ? 0 : Number(draft.userId.trim())
      if (!Number.isNaN(nextUserId) && nextUserId !== (typeof value.userId === 'number' ? value.userId : 0)) await scope.set('userId', nextUserId)
      if (draft.accessToken !== '') await scope.set('accessToken', draft.accessToken.trim())
      setDraft((current) => (current === null ? current : { ...current, accessToken: '' }))
      setMessage({ ok: true, text: t('saved') })
      refreshState()
      refreshKeys()
      refreshModels()
    } catch (err) {
      setMessage({ ok: false, text: t('actionFail')(errText(err)) })
    } finally {
      setSaving(false)
    }
  }

  const useKey = async (key: KeyRow): Promise<void> => {
    const name = String(key.name ?? '')
    setUseBusy(name)
    setMessage(null)
    try {
      const body = await apiPost('/api/relay/use', { idOrName: String(key.id ?? name) })
      if (body.ok) {
        const warn = Array.isArray(body.warnings) && body.warnings.length ? `\n${(body.warnings as string[]).join('\n')}` : ''
        setMessage({
          ok: true,
          text: t('switchedOk')(String((body.key as Record<string, unknown>)?.name ?? name), Number(body.modelCount ?? 0)) + warn,
        })
      } else {
        setMessage({ ok: false, text: t('actionFail')(String(body.error ?? '?')) })
      }
    } catch (err) {
      setMessage({ ok: false, text: t('actionFail')(errText(err)) })
    } finally {
      setUseBusy(null)
      refreshState()
      refreshKeys()
      refreshModels()
      refreshCaps()
    }
  }

  /** Create/edit submission: runs the request, refreshes, and reports. */
  const submitKeyForm = async (form: KeyForm): Promise<{ ok: boolean, error?: string }> => {
    const expiredTime = form.expireNever ? EXPIRED_FOREVER : endOfDaySeconds(form.expireDate)
    const payload = {
      name: form.name.trim(),
      group: form.group.trim(),
      unlimitedQuota: form.unlimitedQuota,
      remainQuota: form.unlimitedQuota ? 0 : Number(form.remainQuota),
      expiredTime,
    }
    let ok = false
    let error = ''
    try {
      if (form.mode === 'create') {
        const body = await apiPost('/api/relay/keys-create', { ...payload, setAsActive: form.setAsActive })
        if (body.ok) {
          ok = true
          const name = String((body.key as Record<string, unknown>)?.name ?? payload.name)
          const warn = Array.isArray(body.warnings) && body.warnings.length ? `\n${(body.warnings as string[]).join('\n')}` : ''
          setMessage({ ok: true, text: (form.setAsActive && body.switched === true ? t('keyCreatedSwitched')(name) : t('keyCreated')(name)) + warn })
        } else {
          error = String(body.error ?? '?')
        }
      } else {
        const body = await apiPost('/api/relay/keys-update', { id: form.id, ...payload, enabled: form.enabled })
        if (body.ok) {
          ok = true
          setMessage({ ok: true, text: t('keyUpdated') })
        } else {
          error = String(body.error ?? '?')
        }
      }
    } catch (err) {
      error = errText(err)
    }
    refreshKeys()
    refreshState()
    refreshModels()
    refreshCaps()
    return ok ? { ok } : { ok: false, error }
  }

  const deleteKey = async (): Promise<void> => {
    const key = deleteTarget
    if (key === null) return
    setDeleteBusy(true)
    setMessage(null)
    try {
      const body = await apiPost('/api/relay/keys-delete', { id: key.id })
      if (body.ok) {
        if (body.active === true) setMessage({ ok: false, text: t('keyDeleteActiveDone')(key.name) })
        else setMessage({ ok: true, text: t('keyDeleteDone') })
      } else {
        setMessage({ ok: false, text: t('actionFail')(String(body.error ?? '?')) })
      }
    } catch (err) {
      setMessage({ ok: false, text: t('actionFail')(errText(err)) })
    } finally {
      setDeleteBusy(false)
      setDeleteTarget(null)
      refreshKeys()
      refreshState()
    }
  }

  const account = keys?.ok === true ? keys.account ?? null : null
  const accountLine = account === null ? t('keysIntro') : [
    String(account.username ?? ''),
    `${t('balanceLabel')} ¥${String(account.quotaCny ?? '?')}`,
  ].join(' · ')

  const keyNames = (keys?.ok ? keys.keys ?? [] : []).map((key) => key.name)

  const tabs: Array<{ id: TabId, label: string }> = [
    { id: 'connection', label: t('tabConnection') },
    { id: 'keys', label: t('tabKeys') },
    { id: 'models', label: t('tabModels') },
    { id: 'dashboard', label: t('tabDashboard') },
    { id: 'logs', label: t('tabLogs') },
    { id: 'capabilities', label: t('tabCapabilities') },
  ]

  return (
    <div className="relay_section">
      <h3 className="relay_title">{t('title')}</h3>
      <p className="relay_intro">{t('intro')}</p>
      {state !== null && (
        <p className="relay_metaLine">
          {t('statusLine')(state.modelCount ?? 0, state.selectedKeyName || t('notSet'))}
        </p>
      )}
      {message !== null && <div className={message.ok ? 'relay_msg relay_msgOk' : 'relay_msg relay_msgErr'} role="status" aria-live="polite">{message.text}</div>}
      {readOnly && <p className="relay_metaLine">{t('readOnlyHint')}</p>}

      <div className="relay_tabs" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'relay_tab relay_tabActive' : 'relay_tab'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'connection' && (
        <div className="relay_card">
          <div className="relay_cardTitle">{t('connTitle')}</div>
          <label className="relay_field">
            <span className="relay_fieldLabel">{t('baseUrlLabel')}</span>
            <input
              className="relay_input"
              value={draft?.baseUrl ?? ''}
              placeholder={t('baseUrlPlaceholder')}
              disabled={readOnly}
              onChange={(e) => setDraft((d) => (d === null ? d : { ...d, baseUrl: e.target.value }))}
            />
          </label>
          <label className="relay_field">
            <span className="relay_fieldLabel">{t('userIdLabel')}</span>
            <input
              className="relay_input"
              value={draft?.userId ?? ''}
              placeholder="12345"
              disabled={readOnly}
              onChange={(e) => setDraft((d) => (d === null ? d : { ...d, userId: e.target.value }))}
            />
          </label>
          <label className="relay_field">
            <span className="relay_fieldLabel">{t('tokenLabel')}</span>
            <input
              className="relay_input"
              type="password"
              value={draft?.accessToken ?? ''}
              placeholder={state?.accessTokenConfigured ? t('tokenPlaceholderSet') : t('tokenPlaceholderUnset')}
              disabled={readOnly}
              onChange={(e) => setDraft((d) => (d === null ? d : { ...d, accessToken: e.target.value }))}
            />
          </label>
          <div className="relay_rowEnd">
            {draftDirty && <span className="relay_metaLine">{t('dirtyHint')}</span>}
            <Button
              variant="primary"
              size="sm"
              disabled={readOnly || !draftDirty || saving}
              onClick={() => { void saveDraft() }}
            >
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      )}

      {tab === 'keys' && (
        <div className="relay_tabPane">
          <div className="relay_card">
            <div className="relay_head">
              <div>
                <div className="relay_cardTitle">{t('keysTitle')}</div>
                <p className="relay_metaLine">{accountLine}</p>
              </div>
              <span className="relay_row">
                <Button variant="ghost" size="sm" disabled={keysBusy} onClick={refreshKeys}>
                  {keysBusy ? t('refreshing') : t('refresh')}
                </Button>
                <Button variant="outline" size="sm" disabled={readOnly || openKey !== null} onClick={() => setOpenKey('create')}>
                  + {t('keyCreate')}
                </Button>
              </span>
            </div>
            {keys === null ? <div className="relay_empty">{t('loading')}</div>
              : !keys.ok ? <div className="relay_msg relay_msgErr">{setupHintFor(String(keys.error ?? ''), t) ?? `${t('keysLoadFail')}: ${String(keys.error ?? '')}`}</div>
              : (keys.keys ?? []).length === 0 && openKey !== 'create' ? <div className="relay_empty">{t('keysEmpty')}</div>
              : (
                <div className="relay_keyList">
                  {openKey === 'create' && (
                    <KeyCard
                      form={newKeyForm()}
                      groups={keys.groups ?? {}}
                      groupRatios={keys.groupRatios ?? {}}
                      t={t}
                      readOnly={readOnly}
                      submit={submitKeyForm}
                      onCancel={() => setOpenKey(null)}
                      onDone={() => setOpenKey(null)}
                    />
                  )}
                  {(keys.keys ?? []).map((key) => {
                    const editing = openKey !== null && openKey !== 'create' && openKey === String(key.id)
                    if (editing) {
                      return (
                        <KeyCard
                          key={`edit:${String(key.id)}`}
                          form={editKeyForm(key)}
                          groups={keys.groups ?? {}}
                          groupRatios={keys.groupRatios ?? {}}
                          t={t}
                          readOnly={readOnly}
                          submit={submitKeyForm}
                          onCancel={() => setOpenKey(null)}
                          onDone={() => setOpenKey(null)}
                        />
                      )
                    }
                    return (
                      <div key={String(key.id)} className="relay_keyRow">
                        <StateDot state={key.enabled ? 'done' : 'error'} />
                        <div className="relay_keyMain">
                          <span className="relay_keyName">
                            {String(key.name ?? '')}
                            {' '}
                            {key.selected ? <Tag tone="solid">{t('selectedTag')}</Tag> : null}
                            {key.enabled ? null : <Tag tone="danger">{t('disabledTag')}</Tag>}
                          </span>
                          <span className="relay_keyMeta">{keyMetaText(key, t)}</span>
                        </div>
                        <span className="relay_row">
                          <Button variant="outline" size="sm" disabled={useBusy !== null || readOnly} onClick={() => { void useKey(key) }}>
                            {useBusy === String(key.name ?? '') ? t('using') : t('useKey')}
                          </Button>
                          <Button variant="outline" size="sm" disabled={useBusy !== null || readOnly} onClick={() => setOpenKey(String(key.id))}>
                            {t('keyEdit')}
                          </Button>
                          <Button variant="outline" size="sm" disabled={useBusy !== null || readOnly || deleteBusy} onClick={() => setDeleteTarget(key)}>
                            {t('keyDelete')}
                          </Button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
          </div>
          <Modal
            open={deleteTarget !== null}
            onClose={() => { if (!deleteBusy) setDeleteTarget(null) }}
            title={deleteTarget !== null ? t('keyDeleteTitle')(String(deleteTarget.name ?? '')) : ''}
            closeLabel={t('close')}
            description={deleteTarget !== null && deleteTarget.selected ? t('keyDeleteActiveDesc') : t('keyDeleteDesc')}
            footer={(
              <>
                <Button variant="outline" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>{t('cancel')}</Button>
                <Button variant="primary" disabled={deleteBusy} onClick={() => { void deleteKey() }}>
                  {deleteBusy ? t('keySaving') : t('keyDelete')}
                </Button>
              </>
            )}
          />
        </div>
      )}

      {tab === 'models' && (
        <div className="relay_card">
          <div className="relay_head">
            <div>
              <div className="relay_cardTitle">{t('modelsTitle')}</div>
              <p className="relay_metaLine">{t('modelsIntro')}</p>
            </div>
            <Button variant="ghost" size="sm" disabled={modelsBusy} onClick={refreshModels}>
              {modelsBusy ? t('refreshing') : t('refresh')}
            </Button>
          </div>
          {models === null ? <div className="relay_empty">{t('loading')}</div>
            : !models.ok ? <div className="relay_msg relay_msgErr">{setupHintFor(String(models.error ?? ''), t) ?? `${t('modelsLoadFail')}: ${String(models.error ?? '')}`}</div>
            : (
              <div className="relay_table">
                <div className="relay_tr relay_trHead">
                  <span className="relay_td relay_tdId">{t('colModel')}</span>
                  <span className="relay_td relay_tdPrice">{t('colPrice')}</span>
                  <span className="relay_td relay_tdGroups">{t('colGroups')}</span>
                </div>
                {(models.models ?? []).map((m) => (
                  <div key={m.id} className="relay_tr">
                    <span className="relay_td relay_tdId">{m.id}</span>
                    <span className="relay_td relay_tdPrice">{priceText(m.price ?? null, t)}</span>
                    <span className="relay_td relay_tdGroups">
                      {m.price !== null && m.price !== undefined && m.price.groups !== undefined && m.price.groups.length ? m.price.groups.join('、') : t('priceNone')}
                    </span>
                  </div>
                ))}
              </div>
              )}
        </div>
      )}

      {tab === 'dashboard' && <DashboardTab t={t} />}

      {tab === 'logs' && <LogsTab t={t} keyNames={keyNames} />}

      {tab === 'capabilities' && (
        <CapabilitiesView
          t={t}
          caps={caps}
          models={models}
          refreshCaps={refreshCaps}
          onMessage={setMessage}
        />
      )}
    </div>
  )
}

function newKeyForm(): KeyForm {
  return {
    mode: 'create',
    name: '',
    group: '',
    unlimitedQuota: false,
    remainQuota: '500000',
    expireNever: true,
    expireDate: dateInputValue(Math.floor(Date.now() / 1000) + 30 * 86400),
    enabled: true,
    setAsActive: false,
  }
}

function editKeyForm(key: KeyRow): KeyForm {
  return {
    mode: 'edit',
    id: key.id,
    name: key.name ?? '',
    group: key.group ?? '',
    unlimitedQuota: key.unlimited === true,
    remainQuota: String(key.remainPoints ?? 0),
    expireNever: key.neverExpires !== false,
    expireDate: (key.expiredTime ?? 0) > 0 ? dateInputValue(key.expiredTime ?? 0) : dateInputValue(Math.floor(Date.now() / 1000) + 30 * 86400),
    enabled: key.enabled,
    setAsActive: false,
  }
}

/** Validate the card locally; returns the error text or null. `name`/`group`
 *  are the effective values (an empty name falls back to the group name). */
function keyFormError(form: KeyForm, t: Translator, name: string, group: string): string | null {
  if (!group) return t('keyGroupRequired')
  if (!name) return `${t('keyName')}: ${t('keyNamePlaceholder')}`
  if (!form.unlimitedQuota) {
    const points = Number(form.remainQuota)
    if (!Number.isInteger(points) || points < 0) return `${t('keyQuota')}: ${t('quotaPointsPlaceholder')}`
  }
  if (!form.expireNever) {
    const seconds = endOfDaySeconds(form.expireDate)
    if (!Number.isFinite(seconds) || seconds <= 0) return t('keyExpiry')
  }
  return null
}

/**
 * The in-place create/edit key card. Holds its own draft (survives list
 * refreshes), shows validation and panel errors inside the card, and stays
 * open until Apply succeeds.
 */
function KeyCard(props: {
  form: KeyForm
  groups: Record<string, string>
  groupRatios: Record<string, number>
  t: Translator
  readOnly: boolean
  submit: (form: KeyForm) => Promise<{ ok: boolean, error?: string }>
  onCancel: () => void
  onDone: () => void
}): JSX.Element {
  const { form: initial, groups, groupRatios, t, submit, onCancel, onDone } = props
  const [form, setForm] = useState<KeyForm>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onChange = (changes: Partial<KeyForm>): void => setForm((current) => ({ ...current, ...changes }))

  const apply = async (): Promise<void> => {
    // An empty key name falls back to the selected group's name.
    const group = form.group.trim()
    const name = form.name.trim() || group
    const problem = keyFormError(form, t, name, group)
    if (problem !== null) {
      setError(problem)
      return
    }
    const effective: KeyForm = { ...form, name, group }
    if (name !== form.name || group !== form.group) onChange({ name, group })
    setBusy(true)
    setError(null)
    const result = await submit(effective)
    setBusy(false)
    if (result.ok) onDone()
    else setError(t('actionFail')(String(result.error ?? '?')))
  }

  return (
    <div className="relay_editCard">
      <div className="relay_formGrid">
        <label className="relay_field">
          <span className="relay_fieldLabel">{t('keyName')}</span>
          <input
            className="relay_input"
            value={form.name}
            placeholder={t('keyNamePlaceholder')}
            disabled={busy}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <div className="relay_field">
          <span className="relay_fieldLabel">{t('keyGroup')}</span>
          <MenuSelect
            value={form.group}
            placeholder={t('keyGroupEmptyOption')}
            items={Object.entries(groups).map(([name, description]) => ({ id: name, label: groupOptionLabel(name, groupRatios[name], description) }))}
            disabled={busy}
            onSelect={(id) => onChange({ group: id })}
          />
        </div>
        <div className="relay_field">
          <span className="relay_fieldLabel">{t('keyQuota')}</span>
          <div className="relay_radioRow">
            <label className="relay_checkRow">
              <input
                type="radio"
                className="relay_radio"
                name={`relay-quota-mode-${form.mode}-${String(form.id ?? '')}`}
                checked={form.unlimitedQuota}
                disabled={busy}
                onChange={() => onChange({ unlimitedQuota: true })}
              />
              <span className="relay_fieldLabel">{t('quotaUnlimited')}</span>
            </label>
            <label className="relay_checkRow">
              <input
                type="radio"
                className="relay_radio"
                name={`relay-quota-mode-${form.mode}-${String(form.id ?? '')}`}
                checked={!form.unlimitedQuota}
                disabled={busy}
                onChange={() => onChange({ unlimitedQuota: false })}
              />
              <span className="relay_fieldLabel">{t('quotaLimited')}</span>
            </label>
            {!form.unlimitedQuota && (
              <>
                <input
                  type="number"
                  min={0}
                  className="relay_input"
                  style={{ width: 140 }}
                  value={form.remainQuota}
                  placeholder={t('quotaPointsPlaceholder')}
                  disabled={busy}
                  onChange={(e) => onChange({ remainQuota: e.target.value })}
                />
                {Number.isFinite(Number(form.remainQuota)) && form.remainQuota.trim() !== '' && (
                  <span className="relay_capHint">{t('quotaCnyHint')(pointsToCnyText(Number(form.remainQuota)))}</span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="relay_field">
          <span className="relay_fieldLabel">{t('keyExpiry')}</span>
          <div className="relay_radioRow">
            <label className="relay_checkRow">
              <input
                type="radio"
                className="relay_radio"
                name={`relay-expiry-mode-${form.mode}-${String(form.id ?? '')}`}
                checked={form.expireNever}
                disabled={busy}
                onChange={() => onChange({ expireNever: true })}
              />
              <span className="relay_fieldLabel">{t('expireNever')}</span>
            </label>
            <label className="relay_checkRow">
              <input
                type="radio"
                className="relay_radio"
                name={`relay-expiry-mode-${form.mode}-${String(form.id ?? '')}`}
                checked={!form.expireNever}
                disabled={busy}
                onChange={() => onChange({ expireNever: false })}
              />
              <span className="relay_fieldLabel">{t('expirePick')}</span>
            </label>
            {!form.expireNever && (
              <input
                type="date"
                className="relay_input"
                style={{ width: 170 }}
                value={form.expireDate}
                disabled={busy}
                onChange={(e) => onChange({ expireDate: e.target.value })}
              />
            )}
          </div>
        </div>
      </div>
      <div className="relay_row">
        {form.mode === 'edit' && (
          <span className="relay_checkRow">
            <Switch checked={form.enabled} onChange={(next) => onChange({ enabled: next })} label={t('keyEnabled')} disabled={busy} />
            <span className="relay_fieldLabel">{t('keyEnabled')}</span>
          </span>
        )}
        {form.mode === 'create' && (
          <span className="relay_checkRow">
            <Switch checked={form.setAsActive} onChange={(next) => onChange({ setAsActive: next })} label={t('keyCreateAndUse')} disabled={busy} />
            <span className="relay_fieldLabel">{t('keyCreateAndUse')}</span>
          </span>
        )}
      </div>
      {error !== null && <div className="relay_msg relay_msgErr relay_cardMsg">{error}</div>}
      <div className="relay_editorFooter">
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => { void apply() }}>
          {form.mode === 'create' ? (busy ? t('keyCreating') : t('keyCreate')) : (busy ? t('keySaving') : t('keyApply'))}
        </Button>
      </div>
    </div>
  )
}
