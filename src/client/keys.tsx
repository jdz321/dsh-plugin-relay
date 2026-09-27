/**
 * The 「API Keys」 tab of a panel detail page: one row per key, 「编辑」
 * expands that row in place into an editor card (one card open at a time),
 * Apply writes immediately, failures keep the card open, and deletions go
 * through a primitives Modal. Key material never crosses to the browser.
 * Every call carries the owning `panel` id.
 */

import { useState } from 'react'
import { Button, Modal, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { apiPost } from './api.js'
import {
  dateInputValue,
  endOfDaySeconds,
  groupOptionLabel,
  keyMetaText,
  pointsToCnyText,
  setupHintFor,
} from './format.js'
import type { Translator } from './locale.js'
import { MenuSelect } from './menu-select.js'

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

export interface KeysData {
  ok: boolean
  error?: string
  account?: { username?: string, quotaCny?: string } | null
  groups?: Record<string, string>
  /** Group billing ratios (name → ratio) for the group selector labels. */
  groupRatios?: Record<string, number>
  keys?: KeyRow[]
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

export function newKeyForm(): KeyForm {
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

export function editKeyForm(key: KeyRow): KeyForm {
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

export interface KeysTabProps {
  t: Translator
  /** Owning panel id — every request addresses this panel. */
  panel: string
  readOnly: boolean
  keys: KeysData | null
  keysBusy: boolean
  openKey: string | null
  setOpenKey: (key: string | null) => void
  refreshKeys: () => void
  submitKeyForm: (form: KeyForm) => Promise<{ ok: boolean, error?: string }>
  onMessage: (message: { ok: boolean, text: string } | null) => void
  /** Refresh every detail-page dataset after a state-changing action. */
  refreshAll: () => void
}

/** The keys list of one panel (data + submit live in the detail page shell). */
export function KeysTab({ t, panel, readOnly, keys, keysBusy, openKey, setOpenKey, refreshKeys, submitKeyForm, onMessage, refreshAll }: KeysTabProps): JSX.Element {
  const [deleteTarget, setDeleteTarget] = useState<KeyRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [useBusy, setUseBusy] = useState<string | null>(null)

  const useKey = async (key: KeyRow): Promise<void> => {
    const name = String(key.name ?? '')
    setUseBusy(name)
    onMessage(null)
    try {
      const body = await apiPost('/api/relay/use', { panel, idOrName: String(key.id ?? name) })
      if (body.ok) {
        const warn = Array.isArray(body.warnings) && body.warnings.length ? `\n${(body.warnings as string[]).join('\n')}` : ''
        onMessage({ ok: true, text: t('switchedOk')(String((body.key as Record<string, unknown>)?.name ?? name), Number(body.modelCount ?? 0)) + warn })
      } else {
        onMessage({ ok: false, text: t('actionFail')(String(body.error ?? '?')) })
      }
    } catch (err) {
      onMessage({ ok: false, text: t('actionFail')(err instanceof Error ? err.message : String(err)) })
    } finally {
      setUseBusy(null)
      refreshAll()
    }
  }

  const deleteKey = async (): Promise<void> => {
    const key = deleteTarget
    if (key === null) return
    setDeleteBusy(true)
    try {
      const body = await apiPost('/api/relay/keys-delete', { panel, id: key.id })
      if (body.ok) {
        if (body.active === true) onMessage({ ok: false, text: t('keyDeleteActiveDone')(key.name) })
        else onMessage({ ok: true, text: t('keyDeleteDone') })
      } else {
        onMessage({ ok: false, text: t('actionFail')(String(body.error ?? '?')) })
      }
    } catch (err) {
      onMessage({ ok: false, text: t('actionFail')(err instanceof Error ? err.message : String(err)) })
    } finally {
      setDeleteBusy(false)
      setDeleteTarget(null)
      refreshKeys()
      refreshAll()
    }
  }

  const account = keys?.ok === true ? keys.account ?? null : null
  const accountLine = account === null ? t('keysIntro') : [
    String(account.username ?? ''),
    `${t('balanceLabel')} ¥${String(account.quotaCny ?? '?')}`,
  ].join(' · ')

  return (
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
  )
}

/**
 * The in-place create/edit key card. Holds its own draft (survives list
 * refreshes), shows validation and panel errors inside the card, and stays
 * open until Apply succeeds.
 */
export function KeyCard(props: {
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
