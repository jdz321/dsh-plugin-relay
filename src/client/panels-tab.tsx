/**
 * The 「连接」 tab (v0.6.0): the relay-panel list. Each row = StateDot +
 * name + host + meta (account · balance · models · active key) + test /
 * edit / delete actions; clicking the row opens the panel's detail page.
 * 「+ 新增」 expands an in-place create card (one card open at a time, same
 * idiom as the keys rows): name (immutable after creation), base URL, access
 * token (write-only), user ID. Apply writes immediately; failures keep the
 * card open. Deletions go through a Modal that lists what gets cleaned up.
 */

import { useState } from 'react'
import { Button, Modal, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { apiPost } from './api.js'
import { normalizeBaseUrlDraft, setupHintFor } from './format.js'
import type { Translator } from './locale.js'

/** One panel row summary from GET /api/relay/panels. */
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
  account: { username: string, quotaCny: string } | null
}

export interface PanelsTabProps {
  t: Translator
  panels: PanelSummary[] | null
  readOnly: boolean
  busy: boolean
  refreshPanels: () => void
  onOpen: (panelId: string) => void
  onMessage: (message: { ok: boolean, text: string } | null) => void
}

/** Draft of the inline create/edit panel card. */
export interface PanelForm {
  mode: 'create' | 'edit'
  id: string
  baseUrl: string
  accessToken: string
  userId: string
}

export function panelFormError(form: PanelForm, t: Translator): string | null {
  if (form.mode === 'create' && !form.id.trim()) return `${t('panelNameLabel')}: ${t('panelNamePlaceholder')}`
  if (form.mode === 'edit' && !normalizeBaseUrlDraft(form.baseUrl)) return t('baseUrlLabel')
  return null
}

export function PanelsTab({ t, panels, readOnly, busy, refreshPanels, onOpen, onMessage }: PanelsTabProps): JSX.Element {
  const [openCard, setOpenCard] = useState<'create' | string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PanelSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [testBusy, setTestBusy] = useState<string | null>(null)

  /** POST one panel mutation, report, and refresh; returns ok for the card. */
  const submitPanel = async (form: PanelForm): Promise<{ ok: boolean, error?: string }> => {
    const payload = form.mode === 'create'
      ? {
          id: form.id.trim(),
          baseUrl: normalizeBaseUrlDraft(form.baseUrl),
          ...(form.accessToken.trim() !== '' ? { accessToken: form.accessToken.trim() } : {}),
          ...(form.userId.trim() !== '' ? { userId: Number(form.userId.trim()) } : {}),
        }
      : {
          panel: form.id,
          baseUrl: normalizeBaseUrlDraft(form.baseUrl),
          ...(form.accessToken.trim() !== '' ? { accessToken: form.accessToken.trim() } : {}),
          ...(form.userId.trim() !== '' ? { userId: Number(form.userId.trim()) } : {}),
        }
    try {
      const body = await apiPost(form.mode === 'create' ? '/api/relay/panels-create' : '/api/relay/panels-update', payload)
      if (body.ok) {
        onMessage({ ok: true, text: form.mode === 'create' ? t('panelCreated')(form.id.trim()) : t('panelUpdated') })
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

  const testPanel = async (panelId: string): Promise<void> => {
    setTestBusy(panelId)
    onMessage(null)
    try {
      const body = await apiPost('/api/relay/connection-test', { panel: panelId })
      onMessage(testResultMessage(body, t))
    } catch (err) {
      onMessage({ ok: false, text: t('actionFail')(err instanceof Error ? err.message : String(err)) })
    } finally {
      setTestBusy(null)
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
                  form={{ mode: 'create', id: '', baseUrl: '', accessToken: '', userId: '' }}
                  t={t}
                  submit={submitPanel}
                  onCancel={() => setOpenCard(null)}
                  onDone={() => setOpenCard(null)}
                />
              )}
              {panels.map((panel) => {
                if (openCard === panel.id) {
                  return (
                    <PanelCard
                      key={`edit:${panel.id}`}
                      form={{ mode: 'edit', id: panel.id, baseUrl: panel.baseUrl, accessToken: '', userId: panel.userId === null ? '' : String(panel.userId) }}
                      tokenConfigured={panel.tokenConfigured}
                      t={t}
                      submit={submitPanel}
                      onCancel={() => setOpenCard(null)}
                      onDone={() => setOpenCard(null)}
                    />
                  )
                }
                return (
                  <div key={panel.id} className="relay_keyRow relay_panelRow">
                    <StateDot state={panel.configured ? 'done' : 'error'} />
                    <button type="button" className="relay_panelMain" onClick={() => onOpen(panel.id)} title={panel.id}>
                      <span className="relay_keyName">
                        {panel.id}
                        {panel.configured ? null : <Tag tone="danger">{t('notSet')}</Tag>}
                      </span>
                      <span className="relay_keyMeta">{panelMetaText(panel, t)}</span>
                    </button>
                    <span className="relay_row">
                      <Button variant="outline" size="sm" disabled={testBusy !== null} onClick={() => { void testPanel(panel.id) }}>
                        {testBusy === panel.id ? t('testing') : t('panelTestFromRow')}
                      </Button>
                      <Button variant="outline" size="sm" disabled={readOnly || openCard !== null} onClick={() => setOpenCard(panel.id)}>
                        {t('keyEdit')}
                      </Button>
                      <Button variant="outline" size="sm" disabled={readOnly || deleteBusy} onClick={() => setDeleteTarget(panel)}>
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
        title={deleteTarget !== null ? t('panelDeleteTitle')(deleteTarget.id) : ''}
        closeLabel={t('close')}
        description={t('panelDeleteDesc')}
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

/** Meta line under a panel name: host · account · balance · models · key. */
export function panelMetaText(panel: PanelSummary, t: Translator): string {
  const parts: string[] = []
  if (panel.host) parts.push(panel.host)
  if (panel.account) parts.push(`${panel.account.username} · ${t('balanceLabel')} ¥${panel.account.quotaCny}`)
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
 * The in-place create/edit panel card. The name field is editable only on
 * create; the token field is write-only (blank = keep). Apply writes
 * immediately and failures keep the card open.
 */
export function PanelCard(props: {
  form: PanelForm
  /** Whether the panel already stores a token (edit card placeholder). */
  tokenConfigured?: boolean
  t: Translator
  submit: (form: PanelForm) => Promise<{ ok: boolean, error?: string }>
  onCancel: () => void
  onDone: () => void
}): JSX.Element {
  const { form: initial, tokenConfigured = false, t, submit, onCancel, onDone } = props
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
            disabled={busy || form.mode === 'edit'}
            onChange={(e) => onChange({ id: e.target.value })}
          />
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
        </label>
        <label className="relay_field">
          <span className="relay_fieldLabel">{t('tokenLabel')}</span>
          <input
            className="relay_input"
            type="password"
            value={form.accessToken}
            placeholder={tokenConfigured ? t('tokenPlaceholderSet') : t('tokenPlaceholderUnset')}
            disabled={busy}
            onChange={(e) => onChange({ accessToken: e.target.value })}
          />
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
