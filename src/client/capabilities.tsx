/**
 * The 「模型能力」 tab, v0.5.1 shape — every card commits itself, there is no
 * global save button, and ALL THREE sections edit in place the way the
 * official Models page does: one row expands into an editor card, one card
 * open across the whole page (`openCard`), Apply/Done writes immediately and
 * failures keep the card open. Row action buttons sit on the right and share
 * one style everywhere (outline sm, like the API-keys rows); every editor
 * footer is 取消 (outline) on the left and the primary action on the right.
 *
 *  - 我的条目: user knowledge entries (namespace `capabilityCatalog`); 新增
 *    opens the editor as a create card on top of the list.
 *  - 预置条目: the preset layer (compiled-in baseline, rebuilt in host memory
 *    by the single 刷新预置 button INSIDE the collapsed panel) in a
 *    <details> with a name filter; Edit expands the row in place and Done
 *    saves the copy as a custom entry (which then overrides the preset).
 *  - 平台模型: one collapsed row per route-catalog id showing the derived
 *    config with a source badge; the matched knowledge-base name renders
 *    under the id. Edit expands the row in place; Done saves that id's
 *    override (overrideSet, or overrideDelete when the draft is blank);
 *    Clear override confirms in a Modal.
 */

import { useMemo, useState } from 'react'
import { Button, IconChevronDownOutline14, Modal, Pill, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { EFFORT_LEVELS, MODALITIES } from '../constants.js'
import { apiPost } from './api.js'
import {
  contextWindowHint,
  draftFromEntry,
  draftFromView,
  entryFromDraft,
  entrySummary,
  type CapDictEntry,
  type CapabilityDraft,
} from './capability-draft.js'
import type { PriceView } from './format.js'
import type { Translator } from './locale.js'

/** One derived per-model view from GET /api/relay/capabilities. */
export interface CapEntryView {
  id: string
  input: string[] | null
  reasoning: false | string[] | null
  contextWindow: number | null
  source: 'override' | 'catalog' | 'catalog-approximate' | 'preset' | 'preset-approximate' | null
  catalogName: string | null
}

/** One model row from GET /api/relay/models (price carries the vendor). */
export interface ModelRow {
  id: string
  price?: PriceView | null
}

export interface CapData {
  ok: boolean
  error?: string
  configured?: boolean
  routeDefaultInput?: string[]
  catalog?: Record<string, CapDictEntry>
  overrides?: Record<string, CapDictEntry>
  presets?: Record<string, CapDictEntry>
  models?: CapEntryView[]
}

export interface ModelsData {
  ok: boolean
  error?: string
  models?: ModelRow[]
}

export interface CapabilitiesViewProps {
  t: Translator
  caps: CapData | null
  models: ModelsData | null
  refreshCaps: () => void
  onMessage: (message: { ok: boolean, text: string } | null) => void
}

/** The one expanded editor across the whole page (official `editing` idiom). */
interface OpenCard {
  section: 'kb' | 'preset' | 'platform'
  /** My-entry name (kb), preset name, or platform model id. '' = kb create. */
  key: string
}

/** Localize the two client-side draft errors. */
function draftErrorText(err: unknown, t: Translator): string {
  const text = err instanceof Error ? err.message : String(err)
  return text === 'levels-required' ? t('capLevelsRequired') : text === 'context-invalid' ? t('capContextInvalid') : text
}

export function CapabilitiesView({ t, caps, models, refreshCaps, onMessage }: CapabilitiesViewProps): JSX.Element {
  const [openCard, setOpenCard] = useState<OpenCard | null>(null)
  const [kbDelete, setKbDelete] = useState<string | null>(null)
  const [overrideClear, setOverrideClear] = useState<string | null>(null)
  const [presetFilter, setPresetFilter] = useState('')
  const [refreshBusy, setRefreshBusy] = useState(false)

  const catalogEntries = useMemo(() => Object.entries(caps?.catalog ?? {}).sort(([a], [b]) => a.localeCompare(b)), [caps])
  const presetEntries = useMemo(() => Object.entries(caps?.presets ?? {}).sort(([a], [b]) => a.localeCompare(b)), [caps])
  const filteredPresets = useMemo(() => {
    const needle = presetFilter.trim().toLowerCase()
    if (!needle) return presetEntries
    return presetEntries.filter(([name]) => name.toLowerCase().includes(needle))
  }, [presetEntries, presetFilter])

  const vendorOf = (id: string): string | null => {
    const row = models?.ok && models.models ? models.models.find((m) => m.id === id) : undefined
    return row?.price?.vendor ?? null
  }

  /** Directed-op POST; resolves {ok:false,error} instead of throwing. */
  const postOps = async (ops: Record<string, unknown>): Promise<{ ok: boolean, error?: string }> => {
    try {
      const body = await apiPost('/api/relay/capabilities', ops)
      if (body.ok) {
        refreshCaps()
        return { ok: true }
      }
      return { ok: false, error: String(body.error ?? '?') }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const submitKbCard = async (original: string | null, draft: CapabilityDraft & { name: string }): Promise<{ ok: boolean, error?: string }> => {
    const name = draft.name.trim()
    if (!name) return { ok: false, error: `${t('capKbName')}: ${t('capKbNamePlaceholder')}` }
    let entry: CapDictEntry | undefined
    try {
      entry = entryFromDraft(draft)
    } catch (err) {
      return { ok: false, error: draftErrorText(err, t) }
    }
    if (!entry && original === null) return { ok: false, error: t('capEmptyEntry') }
    const ops: Record<string, unknown> = {}
    if (entry) ops.catalogSet = { [name]: entry }
    // blank draft over an existing entry = remove it; rename = move it
    if (original !== null && (!entry || original !== name)) ops.catalogDelete = [original]
    const result = await postOps(ops)
    if (result.ok) onMessage({ ok: true, text: t('capSavedOk') })
    return result
  }

  const submitPlatformCard = async (id: string, draft: CapabilityDraft): Promise<{ ok: boolean, error?: string }> => {
    let entry: CapDictEntry | undefined
    try {
      entry = entryFromDraft(draft)
    } catch (err) {
      return { ok: false, error: draftErrorText(err, t) }
    }
    const result = await postOps(entry ? { overrideSet: { [id]: entry } } : { overrideDelete: [id] })
    if (result.ok) onMessage({ ok: true, text: t('capSavedOk') })
    return result
  }

  const deleteKbEntry = async (): Promise<void> => {
    const name = kbDelete
    if (name === null) return
    const result = await postOps({ catalogDelete: [name] })
    setKbDelete(null)
    if (openCard?.section === 'kb' && openCard.key === name) setOpenCard(null)
    onMessage(result.ok ? { ok: true, text: t('capSavedOk') } : { ok: false, text: t('actionFail')(String(result.error ?? '?')) })
  }

  const clearOverride = async (): Promise<void> => {
    const id = overrideClear
    if (id === null) return
    const result = await postOps({ overrideDelete: [id] })
    setOverrideClear(null)
    if (openCard?.section === 'platform' && openCard.key === id) setOpenCard(null)
    onMessage(result.ok
      ? { ok: true, text: t('capOverrideCleared')(id) }
      : { ok: false, text: t('actionFail')(String(result.error ?? '?')) })
  }

  const refreshPreset = async (): Promise<void> => {
    setRefreshBusy(true)
    try {
      const body = await apiPost('/api/relay/knowledge-refresh', {})
      if (body.ok) {
        onMessage({ ok: true, text: t('capPresetRefreshed')(Number(body.count ?? 0)) })
        refreshCaps()
      } else {
        onMessage({ ok: false, text: t('capPresetRefreshFail')(String(body.error ?? '?')) })
      }
    } catch (err) {
      onMessage({ ok: false, text: t('capPresetRefreshFail')(err instanceof Error ? err.message : String(err)) })
    } finally {
      setRefreshBusy(false)
    }
  }

  const sourceBadge = (view: CapEntryView): JSX.Element => {
    if (view.source === 'override') return <Tag tone="warning">{t('capSourceOverride')}</Tag>
    if (view.source === 'catalog') return <Tag tone="success">{t('capSourceCatalog')}</Tag>
    if (view.source === 'catalog-approximate') return <Tag tone="info">{`${t('capSourceCatalog')}·${t('capSourceApprox')}`}</Tag>
    if (view.source === 'preset') return <Tag tone="quiet">{t('capSourcePreset')}</Tag>
    if (view.source === 'preset-approximate') return <Tag tone="info">{`${t('capSourcePreset')}·${t('capSourceApprox')}`}</Tag>
    return <Tag tone="neutral">{t('capSourceNone')}</Tag>
  }

  const open = (section: OpenCard['section'], key: string): void => setOpenCard({ section, key })
  const isOpen = (section: OpenCard['section'], key: string): boolean =>
    openCard !== null && openCard.section === section && openCard.key === key

  return (
    <div className="relay_tabPane">
      <div className="relay_head">
        <div>
          <div className="relay_cardTitle">{t('capTitle')}</div>
          <p className="relay_metaLine">{t('capIntro')}</p>
        </div>
      </div>
      {caps === null ? <div className="relay_empty">{t('loading')}</div>
        : !caps.ok ? <div className="relay_msg relay_msgErr">{`${t('actionFail')(String(caps.error ?? '?'))}`}</div>
        : (
          <>
            <div className="relay_capSection">
              <div className="relay_capSectionTitle">{t('capKbTitle')}</div>
              <p className="relay_metaLine">{t('capKbIntro')}</p>
              {isOpen('kb', '') && (
                <KbCard
                  key="__create__"
                  original={null}
                  initial={{ ...draftFromEntry({}), name: '' }}
                  t={t}
                  submit={(draft) => submitKbCard(null, draft)}
                  onCancel={() => setOpenCard(null)}
                  onDone={() => setOpenCard(null)}
                />
              )}
              {catalogEntries.length === 0 && !isOpen('kb', '') && <div className="relay_empty">{t('capKbEmpty')}</div>}
              {catalogEntries.map(([name, entry]) => isOpen('kb', name) ? (
                <KbCard
                  key={`edit:${name}`}
                  original={name}
                  initial={{ ...draftFromEntry(entry), name }}
                  t={t}
                  submit={(draft) => submitKbCard(name, draft)}
                  onCancel={() => setOpenCard(null)}
                  onDone={() => setOpenCard(null)}
                />
              ) : (
                <div key={name} className="relay_capRowLine">
                  <span className="relay_capId" title={name}>{name}</span>
                  <Tag tone="quiet">{t('capCustomTag')}</Tag>
                  <span className="relay_capSummary">{entrySummary(entry, t)}</span>
                  <span className="relay_capActions">
                    <Button variant="outline" size="sm" onClick={() => open('kb', name)}>{t('capEdit')}</Button>
                    <Button variant="outline" size="sm" onClick={() => setKbDelete(name)}>{t('capDelete')}</Button>
                  </span>
                </div>
              ))}
              <div className="relay_rowEnd">
                <Button variant="outline" size="sm" disabled={openCard !== null} onClick={() => open('kb', '')}>
                  + {t('capKbAdd')}
                </Button>
              </div>
            </div>

            <div className="relay_capSection">
              <details className="relay_presetDetails">
                <summary className="relay_presetSummary">
                  <IconChevronDownOutline14 className="relay_presetChevron" />
                  {t('capPresetCount')(presetEntries.length)}
                </summary>
                <div className="relay_presetBody">
                  <p className="relay_metaLine">{t('capPresetIntro')}</p>
                  <div className="relay_presetToolbar">
                    <input
                      className="relay_input relay_presetFilter"
                      placeholder={t('capPresetFilterPlaceholder')}
                      value={presetFilter}
                      onChange={(e) => setPresetFilter(e.target.value)}
                    />
                    <Button variant="ghost" size="sm" disabled={refreshBusy} onClick={() => { void refreshPreset() }}>
                      {refreshBusy ? t('capPresetRefreshing') : t('capPresetRefresh')}
                    </Button>
                  </div>
                  {filteredPresets.length === 0 ? <div className="relay_empty">{t('capPresetEmpty')}</div>
                    : filteredPresets.map(([name, entry]) => isOpen('preset', name) ? (
                      <KbCard
                        key={`preset:${name}`}
                        original={null}
                        initial={{ ...draftFromEntry(entry), name }}
                        t={t}
                        submit={(draft) => submitKbCard(null, draft)}
                        onCancel={() => setOpenCard(null)}
                        onDone={() => setOpenCard(null)}
                      />
                    ) : (
                      <div key={name} className="relay_capRowLine">
                        <span className="relay_capId" title={name}>{name}</span>
                        <Tag tone="quiet">{t('capPresetTag')}</Tag>
                        <span className="relay_capSummary">{entrySummary(entry, t)}</span>
                        <span className="relay_capActions">
                          <Button variant="outline" size="sm" disabled={openCard !== null} onClick={() => open('preset', name)}>
                            {t('capEdit')}
                          </Button>
                        </span>
                      </div>
                    ))}
                </div>
              </details>
            </div>

            <div className="relay_capSection">
              <div className="relay_capSectionTitle">{t('capPlatformTitle')}</div>
              <p className="relay_metaLine">{t('capPlatformIntro')}</p>
              {!caps.configured || (caps.models ?? []).length === 0 ? <div className="relay_empty">{t('capNotConfigured')}</div>
                : (caps.models ?? []).map((view) => {
                  if (isOpen('platform', view.id)) {
                    return (
                      <PlatformCard
                        key={`edit:${view.id}`}
                        view={view}
                        override={caps.overrides?.[view.id]}
                        vendor={vendorOf(view.id)}
                        routeDefault={caps.routeDefaultInput ?? ['text']}
                        t={t}
                        submit={(draft) => submitPlatformCard(view.id, draft)}
                        onClear={() => setOverrideClear(view.id)}
                        onClose={() => setOpenCard(null)}
                      />
                    )
                  }
                  const approx = view.source?.includes('approximate') ?? false
                  return (
                    <div key={view.id} className="relay_capRowLine">
                      <span className="relay_capNameCell">
                        <span className="relay_capId" title={view.id}>{view.id}</span>
                        {view.catalogName !== null && (
                          <span className="relay_capMatch">{t('capMatchedName')(view.catalogName, approx)}</span>
                        )}
                      </span>
                      {vendorOf(view.id) !== null && <Tag tone="outline">{vendorOf(view.id)}</Tag>}
                      {sourceBadge(view)}
                      <span className="relay_capSummary">{entrySummary({
                        input: view.input ?? undefined,
                        reasoning: view.reasoning ?? undefined,
                        contextWindow: view.contextWindow ?? undefined,
                      }, t)}</span>
                      <span className="relay_capActions">
                        <Button variant="outline" size="sm" disabled={openCard !== null} onClick={() => open('platform', view.id)}>
                          {t('capEdit')}
                        </Button>
                      </span>
                    </div>
                  )
                })}
            </div>
          </>
          )}

      <Modal
        open={kbDelete !== null}
        onClose={() => { setKbDelete(null) }}
        title={kbDelete !== null ? t('capKbDeleteTitle')(kbDelete) : ''}
        closeLabel={t('close')}
        description={t('capKbDeleteDesc')}
        footer={(
          <>
            <Button variant="outline" onClick={() => setKbDelete(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { void deleteKbEntry() }}>{t('capDelete')}</Button>
          </>
        )}
      />
      <Modal
        open={overrideClear !== null}
        onClose={() => { setOverrideClear(null) }}
        title={overrideClear !== null ? t('capOverrideClearTitle')(overrideClear) : ''}
        closeLabel={t('close')}
        description={t('capOverrideClearDesc')}
        footer={(
          <>
            <Button variant="outline" onClick={() => setOverrideClear(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { void clearOverride() }}>{t('capClearOverride')}</Button>
          </>
        )}
      />
    </div>
  )
}

/** Shared field editors: modality pills, reasoning switch + level pills, context text input. */
function CapabilityFields(props: {
  draft: CapabilityDraft
  onChange: (changes: Partial<CapabilityDraft>) => void
  t: Translator
  /** Route default shown when no modality is selected (platform cards only). */
  routeDefault?: string[]
}): JSX.Element {
  const { draft, onChange, t } = props
  const contextText = draft.contextWindow
  const hint = contextWindowHint(contextText)
  const contextInvalid = contextText.trim() !== '' && hint === null
  return (
    <>
      <div className="relay_capRow">
        <span className="relay_capLegend">{t('capInputLegend')}</span>
        {MODALITIES.map((modality) => {
          const on = draft.input.includes(modality)
          const label = modality === 'text' ? t('capModalityText') : t('capModalityImage')
          return (
            <Pill
              key={modality}
              active={on}
              onClick={() => onChange({ input: on ? draft.input.filter((m) => m !== modality) : [...draft.input, modality] })}
            >
              {label}
            </Pill>
          )
        })}
        {draft.input.length === 0 && props.routeDefault !== undefined && (
          <span className="relay_capHint">{props.routeDefault.join(' / ')}</span>
        )}
      </div>
      <div className="relay_capRow">
        <span className="relay_capLegend">{t('capReasoningLegend')}</span>
        <Switch
          checked={draft.reasoning === 'on'}
          onChange={(next) => onChange(next
            ? { reasoning: 'on', levels: draft.levels.length ? draft.levels : ['medium'] }
            : { reasoning: 'off', levels: [] })}
          label={t('capReasoningLegend')}
        />
        {draft.reasoning !== 'on' && (
          <span className="relay_capHint">{draft.reasoning === 'off' ? t('capReasoningOff') : t('capReasoningUndeclared')}</span>
        )}
        {draft.reasoning === 'on' && (
          <span className="relay_row">
            {EFFORT_LEVELS.map((level) => {
              const on = draft.levels.includes(level)
              return (
                <Pill
                  key={level}
                  active={on}
                  onClick={() => {
                    const next = on ? draft.levels.filter((l) => l !== level) : [...draft.levels, level]
                    onChange({ levels: EFFORT_LEVELS.filter((l) => next.includes(l)) })
                  }}
                >
                  {level}
                </Pill>
              )
            })}
          </span>
        )}
      </div>
      <div className="relay_capRow">
        <span className="relay_capLegend">{t('capContextLegend')}</span>
        <input
          type="text"
          className="relay_input relay_capContext"
          placeholder={t('capContextPlaceholder')}
          value={contextText}
          onChange={(e) => onChange({ contextWindow: e.target.value })}
        />
        {contextInvalid && <span className="relay_capInvalid">{t('capContextInvalid')}</span>}
        {!contextInvalid && hint !== null && <span className="relay_capHint">{hint}</span>}
      </div>
    </>
  )
}

/**
 * Editor footer (official EditorFooter shape): dismiss on the left, commit on
 * the right; the commit label swaps to its in-flight wording while busy.
 */
function EditorFooter(props: { busyLabel: string, actionLabel: string, busy: boolean, onCancel: () => void, onApply: () => void, t: Translator }): JSX.Element {
  return (
    <div className="relay_editorFooter">
      <Button variant="outline" disabled={props.busy} onClick={props.onCancel}>{props.t('cancel')}</Button>
      <Button variant="primary" disabled={props.busy} onClick={props.onApply}>
        {props.busy ? props.busyLabel : props.actionLabel}
      </Button>
    </div>
  )
}

/**
 * The knowledge-entry editor card, expanded in place of its row. Serves all
 * three origins: a create card (original = null, blank), an edit of one of my
 * entries, and a preset copy-edit (original = null, values prefilled).
 */
function KbCard(props: {
  original: string | null
  initial: CapabilityDraft & { name: string }
  t: Translator
  submit: (draft: CapabilityDraft & { name: string }) => Promise<{ ok: boolean, error?: string }>
  onCancel: () => void
  onDone: () => void
}): JSX.Element {
  const { original, initial, t, submit, onCancel, onDone } = props
  const [draft, setDraft] = useState<CapabilityDraft & { name: string }>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onChange = (changes: Partial<CapabilityDraft & { name: string }>): void => setDraft((current) => ({ ...current, ...changes }))

  const apply = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await submit(draft)
    setBusy(false)
    if (result.ok) onDone()
    else setError(t('actionFail')(String(result.error ?? '?')))
  }

  return (
    <div className="relay_editCard">
      <div className="relay_capRow">
        <span className="relay_capLegend">{t('capKbName')}</span>
        <input
          className="relay_input relay_kbName"
          placeholder={t('capKbNamePlaceholder')}
          value={draft.name}
          disabled={busy}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {original === null && initial.name !== '' && <Tag tone="quiet">{t('capPresetTag')}</Tag>}
      </div>
      <CapabilityFields draft={draft} onChange={onChange} t={t} />
      {error !== null && <div className="relay_msg relay_msgErr relay_cardMsg">{error}</div>}
      <EditorFooter busy={busy} busyLabel={t('capSaving')} actionLabel={t('capDone')} onCancel={onCancel} onApply={() => { void apply() }} t={t} />
    </div>
  )
}

/** The one open platform editor card (per-id override), expanded in place. */
function PlatformCard(props: {
  view: CapEntryView
  override: CapDictEntry | undefined
  vendor: string | null
  routeDefault: string[]
  t: Translator
  submit: (draft: CapabilityDraft) => Promise<{ ok: boolean, error?: string }>
  onClear: () => void
  onClose: () => void
}): JSX.Element {
  const { view, override, t, submit, onClear, onClose } = props
  const [draft, setDraft] = useState<CapabilityDraft>(override !== undefined ? draftFromEntry(override) : draftFromView(view))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onChange = (changes: Partial<CapabilityDraft>): void => setDraft((current) => ({ ...current, ...changes }))

  const apply = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await submit(draft)
    setBusy(false)
    if (result.ok) onClose()
    else setError(t('actionFail')(String(result.error ?? '?')))
  }

  return (
    <div className="relay_editCard">
      <div className="relay_capHead">
        <span className="relay_capNameCell">
          <span className="relay_capId" title={view.id}>{view.id}</span>
          {view.catalogName !== null && (
            <span className="relay_capMatch">{t('capMatchedName')(view.catalogName, view.source?.includes('approximate') ?? false)}</span>
          )}
        </span>
        {props.vendor !== null && <Tag tone="outline">{props.vendor}</Tag>}
        {override !== undefined && <Tag tone="warning">{t('capSourceOverride')}</Tag>}
      </div>
      <CapabilityFields draft={draft} onChange={onChange} t={t} routeDefault={props.routeDefault} />
      {error !== null && <div className="relay_msg relay_msgErr relay_cardMsg">{error}</div>}
      <div className="relay_editorFooter">
        {override !== undefined
          ? <Button variant="outline" className="relay_footerSide" disabled={busy} onClick={onClear}>{t('capClearOverride')}</Button>
          : <span />}
        <span className="relay_row">
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => { void apply() }}>
            {busy ? t('capSaving') : t('capDone')}
          </Button>
        </span>
      </div>
    </div>
  )
}
