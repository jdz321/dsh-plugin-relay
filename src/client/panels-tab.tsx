/**
 * The 「连接」 tab (v0.6.1): an ACCORDION of collapsible panels — the former
 * second-level detail page folded into the row. Collapsed row: StateDot +
 * name + meta line (host · account · balance · models · active key) + a
 * direct 删除 button; the whole row toggles expansion, and only one panel is
 * expanded at a time (the shared openPanelId state lives in section.tsx).
 * Expanded: status line + 测试连接 / 删除 + the four per-panel tabs
 * (panel-body.tsx). Editing is GONE — the create card is the only form (name
 * / base URL / user ID / access token, apply-writes-immediately); change
 * means delete + re-create.
 *
 * The account line fills LAZILY: GET /api/relay/account per configured panel
 * once the list renders (host caches 5s, failures included); failures stay
 * silent — the row then shows config state only.
 */

import { useEffect, useState } from 'react'
import { Button, IconChevronDownOutline14, Modal, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { apiPost, apiGet } from './api.js'
import { normalizeBaseUrlDraft, setupHintFor } from './format.js'
import { PanelBody } from './panel-body.js'
import type { Translator } from './locale.js'

/** One panel row summary from GET /api/relay/panels (config state only). */
export interface PanelSummary {
  id: string
  baseUrl: string
  host: string
  relayKind: string
  configured: boolean
  missing?: string | null
  tokenConfigured: boolean
  userId: number | null
  keyRef: string
  selectedKeyName: string
  modelCount: number
  /** Entries in this panel's capabilityOverrides group (delete warning). */
  overrideCount: number
  /** dsh's default model provider points at this panel (delete warning). */
  defaultModelTarget: boolean
}

/** The lazy account line of one panel row. */
export interface AccountLine {
  username: string
  quotaCny: string
}

export interface PanelsTabProps {
  t: Translator
  panels: PanelSummary[] | null
  readOnly: boolean
  busy: boolean
  /** Settings revision — bumps re-run the lazy account fill (host-cached). */
  revision?: number
  refreshPanels: () => void
  /** Which accordion panel is expanded (single-open), null = all collapsed. */
  openPanelId: string | null
  setOpenPanelId: (panelId: string | null) => void
  onMessage: (message: { ok: boolean, text: string } | null) => void
}

/** Draft of the inline create panel card. */
export interface PanelForm {
  id: string
  baseUrl: string
  accessToken: string
  userId: string
}

export function panelFormError(form: PanelForm, t: Translator): string | null {
  if (!form.id.trim()) return `${t('panelNameLabel')}: ${t('panelNamePlaceholder')}`
  if (!normalizeBaseUrlDraft(form.baseUrl)) return t('baseUrlLabel')
  return null
}

export function PanelsTab({ t, panels, readOnly, busy, revision, refreshPanels, openPanelId, setOpenPanelId, onMessage }: PanelsTabProps): JSX.Element {
  const [openCard, setOpenCard] = useState<'create' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PanelSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  /** id → account line; absent key = still loading, null value = failed. */
  const [accounts, setAccounts] = useState<Record<string, AccountLine | null>>({})

  // Lazy account fill: one /account per configured panel whenever the panel
  // set or the settings revision changes. Failures are silent.
  const panelKey = (panels ?? []).map((panel) => panel.id).join(',')
  useEffect(() => {
    if (!panelKey) return
    const ids = panelKey.split(',')
    let cancelled = false
    void Promise.all(ids.map(async (panelId) => {
      try {
        const body = await apiGet(`/api/relay/account?panel=${encodeURIComponent(panelId)}`)
        if (body.ok && body.account && typeof body.account === 'object') {
          const account = body.account as { username?: unknown, quotaCny?: unknown }
          return [panelId, { username: String(account.username ?? '?'), quotaCny: String(account.quotaCny ?? '?') }] as const
        }
      } catch {
        /* silent: the row falls back to config state */
      }
      return [panelId, null] as const
    })).then((entries) => {
      if (!cancelled) setAccounts(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [panelKey, revision])

  /** POST the create form, report, and refresh; returns ok for the card. */
  const submitPanel = async (form: PanelForm): Promise<{ ok: boolean, error?: string }> => {
    const payload = {
      id: form.id.trim(),
      baseUrl: normalizeBaseUrlDraft(form.baseUrl),
      ...(form.accessToken.trim() !== '' ? { accessToken: form.accessToken.trim() } : {}),
      ...(form.userId.trim() !== '' ? { userId: Number(form.userId.trim()) } : {}),
    }
    try {
      const body = await apiPost('/api/relay/panels-create', payload)
      if (body.ok) {
        onMessage({ ok: true, text: t('panelCreated')(form.id.trim()) })
        refreshPanels()
        return { ok: true }
      }
      return { ok: false, error: String(body.error ?? '?') }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const deletePanel = async (): Promise<void> => {
    const panel = deleteTarget
    if (panel === null) return
    setDeleteBusy(true)
    try {
      const body = await apiPost('/api/relay/panels-delete', { panel: panel.id })
      if (body.ok) {
        const warnings = Array.isArray(body.warnings) && body.warnings.length ? `\n${(body.warnings as string[]).join('\n')}` : ''
        onMessage({ ok: true, text: t('panelDeleteDone')(warnings) })
      } else {
        onMessage({ ok: false, text: t('actionFail')(String(body.error ?? '?')) })
      }
    } catch (err) {
      onMessage({ ok: false, text: t('actionFail')(err instanceof Error ? err.message : String(err)) })
    } finally {
      setDeleteBusy(false)
      setDeleteTarget(null)
      refreshPanels()
    }
  }

  return (
    <div className="relay_tabPane">
      <div className="relay_card">
        <div className="relay_head">
          <div>
            <div className="relay_cardTitle">{t('panelsTitle')}</div>
            <p className="relay_metaLine">{t('panelsIntro')}</p>
          </div>
          <Button variant="outline" size="sm" disabled={readOnly || openCard !== null} onClick={() => setOpenCard('create')}>
            + {t('panelAdd')}
          </Button>
        </div>
        {panels === null ? <div className="relay_empty">{t('loading')}</div>
          : panels.length === 0 && openCard !== 'create' ? <div className="relay_empty">{t('panelEmpty')}</div>
          : (
            <div className="relay_keyList">
              {openCard === 'create' && (
                <PanelCard
                  form={{ id: '', baseUrl: '', accessToken: '', userId: '' }}
                  t={t}
                  submit={submitPanel}
                  onCancel={() => setOpenCard(null)}
                  onDone={() => setOpenCard(null)}
                />
              )}
              {panels.map((panel) => (
                <PanelItem
                  key={panel.id}
                  panel={panel}
                  account={Object.hasOwn(accounts, panel.id) ? accounts[panel.id] ?? null : undefined}
                  expanded={openPanelId === panel.id}
                  readOnly={readOnly}
                  createOpen={openCard !== null}
                  onToggle={() => setOpenPanelId(openPanelId === panel.id ? null : panel.id)}
                  onDelete={() => setDeleteTarget(panel)}
                  t={t}
                  onMessage={onMessage}
                />
              ))}
            </div>
            )}
      </div>
      <Modal
        open={deleteTarget !== null}
        onClose={() => { if (!deleteBusy) setDeleteTarget(null) }}
        title={deleteTarget !== null ? t('panelDeleteTitle')(deleteTarget.id) : ''}
        closeLabel={t('close')}
        description={t('panelDeleteDesc')}
        children={deleteTarget !== null && (deleteTarget.overrideCount > 0 || deleteTarget.defaultModelTarget)
          ? (
            <>
              {deleteTarget.overrideCount > 0 && <p>{t('panelDeleteOverrides')(deleteTarget.overrideCount)}</p>}
              {deleteTarget.defaultModelTarget === true && <p>{t('panelDeleteDefaultModel')}</p>}
            </>
            )
          : undefined}
        footer={(
          <>
            <Button variant="outline" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={deleteBusy} onClick={() => { void deletePanel() }}>
              {deleteBusy ? t('panelSaving') : t('keyDelete')}
            </Button>
          </>
        )}
      />
    </div>
  )
}

/** One accordion panel: collapsible row + (expanded) the four-tab body. */
function PanelItem(props: {
  panel: PanelSummary
  /** undefined = still loading ('…'), null = failed (config state only). */
  account: AccountLine | null | undefined
  expanded: boolean
  readOnly: boolean
  createOpen: boolean
  onToggle: () => void
  onDelete: () => void
  t: Translator
  onMessage: (message: { ok: boolean, text: string } | null) => void
}): JSX.Element {
  const { panel, account, expanded, readOnly, createOpen, onToggle, onDelete, t, onMessage } = props
  return (
    <div className={expanded ? 'relay_panelItem relay_panelItemOpen' : 'relay_panelItem'}>
      <div className="relay_panelRowHead">
        <StateDot state={panel.configured ? 'done' : 'error'} />
        <button type="button" className="relay_panelMain" onClick={onToggle} title={panel.id} aria-expanded={expanded}>
          <span className="relay_keyName">
            {panel.id}
            {panel.configured ? null : <Tag tone="danger">{t('notSet')}</Tag>}
          </span>
          <span className="relay_keyMeta">{panelMetaText(panel, account, t)}</span>
        </button>
        <IconChevronDownOutline14 className={expanded ? 'relay_panelChevron relay_panelChevronOpen' : 'relay_panelChevron'} />
        <span className="relay_row">
          <Button variant="outline" size="sm" disabled={readOnly || createOpen} onClick={onDelete}>
            {t('keyDelete')}
          </Button>
        </span>
      </div>
      {expanded && (
        <div className="relay_panelBody">
          <PanelBody t={t} panel={panel} readOnly={readOnly} onMessage={onMessage} onDelete={onDelete} />
        </div>
      )}
    </div>
  )
}

/** Meta line under a panel name: host · account · balance · models · key. */
export function panelMetaText(panel: PanelSummary, account: AccountLine | null | undefined, t: Translator): string {
  const parts: string[] = []
  if (panel.host) parts.push(panel.host)
  if (account !== undefined && account !== null) parts.push(`${account.username} · ${t('balanceLabel')} ¥${account.quotaCny}`)
  else if (account === undefined && panel.configured) parts.push(t('accountLoading'))
  parts.push(t('statusLine')(panel.modelCount, panel.selectedKeyName || t('notSet')))
  return parts.join(' · ')
}

/** Map a connection-test response onto the message-area copy. */
export function testResultMessage(body: Record<string, unknown>, t: Translator): { ok: boolean, text: string } {
  if (body.ok === true) {
    const account = body.account as { username?: string, quotaCny?: string } | undefined
    return { ok: true, text: t('testOk')(String(account?.username ?? '?'), String(account?.quotaCny ?? '?')) }
  }
  const error = String(body.error ?? '?')
  const reason = String(body.reason ?? '')
  if (reason === 'unreachable') return { ok: false, text: t('testUnreachable') }
  if (reason === 'user-mismatch') return { ok: false, text: t('testUserMismatch') }
  if (reason === 'token-invalid') return { ok: false, text: t('testTokenInvalid') }
  const hint = setupHintFor(error, t)
  return { ok: false, text: hint ?? t('testError')(error) }
}

/**
 * The in-place create panel card (create-only since v0.6.1 — no edit mode).
 * Labels stay short word-groups; the explanations sit on hint lines under
 * the inputs so both grid columns' inputs align on one top edge.
 */
export function PanelCard(props: {
  form: PanelForm
  t: Translator
  submit: (form: PanelForm) => Promise<{ ok: boolean, error?: string }>
  onCancel: () => void
  onDone: () => void
}): JSX.Element {
  const { form: initial, t, submit, onCancel, onDone } = props
  const [form, setForm] = useState<PanelForm>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onChange = (changes: Partial<PanelForm>): void => setForm((current) => ({ ...current, ...changes }))

  const apply = async (): Promise<void> => {
    const problem = panelFormError(form, t)
    if (problem !== null) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    const result = await submit(form)
    setBusy(false)
    if (result.ok) onDone()
    else setError(t('actionFail')(String(result.error ?? '?')))
  }

  return (
    <div className="relay_editCard">
      <div className="relay_formGrid">
        <label className="relay_field">
          <span className="relay_fieldLabel">{t('panelNameLabel')}</span>
          <input
            className="relay_input"
            value={form.id}
            placeholder={t('panelNamePlaceholder')}
            disabled={busy}
            onChange={(e) => onChange({ id: e.target.value })}
          />
          <span className="relay_capHint">{t('panelNameHint')}</span>
        </label>
        <label className="relay_field">
          <span className="relay_fieldLabel">{t('baseUrlLabel')}</span>
          <input
            className="relay_input"
            value={form.baseUrl}
            placeholder={t('baseUrlPlaceholder')}
            disabled={busy}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
          />
          <span className="relay_capHint">{t('baseUrlHint')}</span>
        </label>
        <label className="relay_field">
          <span className="relay_fieldLabel">{t('userIdLabel')}</span>
          <input
            className="relay_input"
            value={form.userId}
            placeholder="12345"
            disabled={busy}
            onChange={(e) => onChange({ userId: e.target.value })}
          />
          <span className="relay_capHint">{t('userIdHint')}</span>
        </label>
        <label className="relay_field">
          <span className="relay_fieldLabel">{t('tokenLabel')}</span>
          <input
            className="relay_input"
            type="password"
            value={form.accessToken}
            placeholder={t('tokenPlaceholderUnset')}
            disabled={busy}
            onChange={(e) => onChange({ accessToken: e.target.value })}
          />
          <span className="relay_capHint">{t('tokenHint')}</span>
        </label>
      </div>
      {error !== null && <div className="relay_msg relay_msgErr relay_cardMsg">{error}</div>}
      <div className="relay_editorFooter">
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => { void apply() }}>
          {busy ? t('panelSaving') : t('panelApply')}
        </Button>
      </div>
    </div>
  )
}
