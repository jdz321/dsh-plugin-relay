/**
 * The settings section: a four-tab page (连接 / API Keys / 模型 / 模型能力)
 * over the host plugin's `relay` namespace and /api/relay/* routes. Both
 * list tabs auto-load on mount; the capability tab is described in
 * capabilities.tsx.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { apiGet, apiPost } from './api.js'
import { CapabilitiesView, type CapData, type ModelsData } from './capabilities.js'
import { keyMetaText, normalizeBaseUrlDraft, priceText, setupHintFor, trimNum } from './format.js'
import type { Translator } from './locale.js'

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
  defaultModel?: string | null
}

interface KeysData {
  ok: boolean
  error?: string
  account?: Record<string, unknown> | null
  keys?: Array<Record<string, unknown>>
}

type TabId = 'connection' | 'keys' | 'models' | 'capabilities'

type Message = { ok: boolean, text: string } | null

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

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

  const useKey = async (key: Record<string, unknown>): Promise<void> => {
    const name = String(key.name ?? '')
    setUseBusy(name)
    setMessage(null)
    try {
      const body = await apiPost('/api/relay/use', { idOrName: String(key.id ?? name) })
      if (body.ok) {
        const warn = Array.isArray(body.warnings) && body.warnings.length ? `\n${(body.warnings as string[]).join('\n')}` : ''
        setMessage({
          ok: true,
          text: t('switchedOk')(String((body.key as Record<string, unknown>)?.name ?? name), Number(body.modelCount ?? 0), String(body.defaultModel ?? '?')) + warn,
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

  const account = keys?.ok === true ? keys.account ?? null : null
  const accountLine = account === null ? t('keysIntro') : [
    String(account.username ?? ''),
    account.group ? `${t('groupLabel')} ${String(account.group)}` : null,
    typeof account.groupRatio === 'number' ? `${t('ratioLabel')} ${trimNum(account.groupRatio)}×` : null,
    `${t('balanceLabel')} ¥${String(account.quotaCny ?? '?')}`,
  ].filter((part) => part !== null).join(' · ')

  const tabs: Array<{ id: TabId, label: string }> = [
    { id: 'connection', label: t('tabConnection') },
    { id: 'keys', label: t('tabKeys') },
    { id: 'models', label: t('tabModels') },
    { id: 'capabilities', label: t('tabCapabilities') },
  ]

  return (
    <div className="relay_section">
      <h3 className="relay_title">{t('title')}</h3>
      <p className="relay_intro">{t('intro')}</p>
      {state !== null && (
        <p className="relay_metaLine">
          {t('statusLine')(state.defaultModel ?? t('notSet'), state.modelCount ?? 0, state.selectedKeyName || t('notSet'))}
        </p>
      )}
      {message !== null && <div className={message.ok ? 'relay_msg relay_msgOk' : 'relay_msg relay_msgErr'}>{message.text}</div>}
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
            <button
              type="button"
              className="relay_button relay_buttonPrimary"
              disabled={readOnly || !draftDirty || saving}
              onClick={() => { void saveDraft() }}
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      )}

      {tab === 'keys' && (
        <div className="relay_card">
          <div className="relay_head">
            <div>
              <div className="relay_cardTitle">{t('keysTitle')}</div>
              <p className="relay_metaLine">{accountLine}</p>
            </div>
            <button
              type="button"
              className="relay_button relay_buttonSecondary relay_buttonSm"
              disabled={keysBusy}
              onClick={refreshKeys}
            >
              {keysBusy ? t('refreshing') : t('refresh')}
            </button>
          </div>
          {keys === null ? <div className="relay_empty">{t('loading')}</div>
            : !keys.ok ? <div className="relay_msg relay_msgErr">{setupHintFor(String(keys.error ?? ''), t) ?? `${t('keysLoadFail')}: ${String(keys.error ?? '')}`}</div>
            : (keys.keys ?? []).length === 0 ? <div className="relay_empty">{t('keysEmpty')}</div>
            : (keys.keys ?? []).map((key) => (
              <div key={String(key.id)} className="relay_keyRow">
                <div className="relay_keyMain">
                  <span className="relay_keyName">
                    {String(key.name ?? '')}
                    {' '}
                    {key.selected ? <span className="relay_tag relay_tagOk">{t('selectedTag')}</span> : null}
                    {key.enabled ? null : <span className="relay_tag relay_tagBad">{t('disabledTag')}</span>}
                  </span>
                  <span className="relay_keyMeta">{keyMetaText(key, t)}</span>
                </div>
                <button
                  type="button"
                  className="relay_button relay_buttonSecondary relay_buttonSm"
                  disabled={useBusy !== null || readOnly}
                  onClick={() => { void useKey(key) }}
                >
                  {useBusy === String(key.name ?? '') ? t('using') : t('useKey')}
                </button>
              </div>
            ))}
        </div>
      )}

      {tab === 'models' && (
        <div className="relay_card">
          <div className="relay_head">
            <div>
              <div className="relay_cardTitle">{t('modelsTitle')}</div>
              <p className="relay_metaLine">{t('modelsIntro')}</p>
            </div>
            <button
              type="button"
              className="relay_button relay_buttonSecondary relay_buttonSm"
              disabled={modelsBusy}
              onClick={refreshModels}
            >
              {modelsBusy ? t('refreshing') : t('refresh')}
            </button>
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
