/**
 * The 「模型能力」 tab, restructured as two sections:
 *
 *  - 知识库: capability entries keyed by canonical model name (models.dev
 *    naming), with add (↻ prefills from models.dev, including the context
 *    window), edit, delete.
 *  - 平台模型: one card per id in the current route catalog, showing the
 *    derived config with a source badge (override / knowledge base /
 *    approximate / unconfigured). Editing a card creates/edits that id's
 *    override; clearing it falls back to the knowledge base or unconfigured.
 *
 * One 保存 submits both dicts to POST /api/relay/capabilities; the host
 * persists them into the relay namespace and replays the derivation rules
 * over the route catalog. Drafts of dirty rows/cards survive rebuilds (the
 * reconcile* helpers are pure and unit-tested).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { EFFORT_LEVELS, MODALITIES } from '../constants.js'
import { apiGet, apiPost } from './api.js'
import type { PriceView } from './format.js'
import type { Translator } from './locale.js'

/** One capability dict entry as served/stored (fields optional). */
export interface CapDictEntry {
  input?: string[]
  reasoning?: false | string[]
  contextWindow?: number
}

/** One derived per-model view from GET /api/relay/capabilities. */
export interface CapEntryView {
  id: string
  input: string[] | null
  reasoning: false | string[] | null
  contextWindow: number | null
  source: 'override' | 'catalog' | 'catalog-approximate' | null
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
  models?: CapEntryView[]
}

export interface ModelsData {
  ok: boolean
  error?: string
  models?: ModelRow[]
}

/** Local draft of one knowledge-base row. */
export interface KbRow {
  name: string
  input: string[]
  /** 'on' = reasoning with levels, 'off' = explicitly non-reasoning, null = undeclared. */
  reasoning: 'on' | 'off' | null
  levels: string[]
  /** Textual number input; '' = unconfigured. */
  contextWindow: string
  dirty: boolean
}

/** Local draft of one per-id override. */
export interface OverrideDraft {
  input: string[]
  reasoning: 'on' | 'off' | null
  levels: string[]
  contextWindow: string
  dirty: boolean
}

function reasoningOf(entry: CapDictEntry): 'on' | 'off' | null {
  return entry.reasoning === false ? 'off' : Array.isArray(entry.reasoning) ? 'on' : null
}

function levelsOf(entry: CapDictEntry): string[] {
  return Array.isArray(entry.reasoning) ? [...entry.reasoning] : []
}

function rowFromEntry(name: string, entry: CapDictEntry): KbRow {
  return {
    name,
    input: entry.input ? [...entry.input] : [],
    reasoning: reasoningOf(entry),
    levels: levelsOf(entry),
    contextWindow: entry.contextWindow !== undefined ? String(entry.contextWindow) : '',
    dirty: false,
  }
}

function draftFromEntry(entry: CapDictEntry): OverrideDraft {
  return {
    input: entry.input ? [...entry.input] : [],
    reasoning: reasoningOf(entry),
    levels: levelsOf(entry),
    contextWindow: entry.contextWindow !== undefined ? String(entry.contextWindow) : '',
    dirty: false,
  }
}

/**
 * Rebuild the knowledge rows from server data. Dirty drafts survive a
 * rebuild (mid-edit refresh); clean rows take the server view; rows the user
 * deleted stay deleted until the next successful save.
 */
export function reconcileKbRows(
  server: Record<string, CapDictEntry>,
  previous: readonly KbRow[],
  deleted: readonly string[],
): KbRow[] {
  const deletedSet = new Set(deleted)
  const drafts = new Map(previous.filter((row) => row.dirty).map((row) => [row.name, row]))
  const rows: KbRow[] = []
  for (const [name, entry] of Object.entries(server)) {
    if (deletedSet.has(name)) continue
    rows.push(drafts.get(name) ?? rowFromEntry(name, entry))
  }
  for (const row of previous) {
    if (!row.dirty || deletedSet.has(row.name)) continue
    if (!rows.some((existing) => existing.name === row.name)) rows.push(row)
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Rebuild the override drafts: dirty local drafts win, clean ones re-read
 * the server view, cleared ids stay cleared until the next save.
 */
export function reconcileOverrides(
  server: Record<string, CapDictEntry>,
  previous: Readonly<Record<string, OverrideDraft>>,
  cleared: readonly string[],
): Record<string, OverrideDraft> {
  const clearedSet = new Set(cleared)
  const next: Record<string, OverrideDraft> = {}
  for (const [id, entry] of Object.entries(server)) {
    if (clearedSet.has(id)) continue
    const local = previous[id]
    next[id] = local?.dirty ? local : draftFromEntry(entry)
  }
  for (const [id, local] of Object.entries(previous)) {
    if (local.dirty && !next[id] && !clearedSet.has(id)) next[id] = local
  }
  return next
}

/** Build a dict entry from a draft; undefined = nothing configured. Throws on invalid values. */
export function entryFromDraft(draft: { input: readonly string[], reasoning: 'on' | 'off' | null, levels: readonly string[], contextWindow: string }): CapDictEntry | undefined {
  if (draft.reasoning === 'on' && draft.levels.length === 0) {
    throw new Error('levels-required')
  }
  const entry: CapDictEntry = {}
  if (draft.input.length > 0) entry.input = [...draft.input]
  if (draft.reasoning === 'off') entry.reasoning = false
  else if (draft.reasoning === 'on') entry.reasoning = [...draft.levels]
  const context = draft.contextWindow.trim()
  if (context !== '') {
    const parsed = Number(context)
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('context-invalid')
    entry.contextWindow = parsed
  }
  return Object.keys(entry).length > 0 ? entry : undefined
}

export interface CapabilitiesViewProps {
  t: Translator
  caps: CapData | null
  models: ModelsData | null
  refreshCaps: () => void
  onMessage: (message: { ok: boolean, text: string } | null) => void
}

export function CapabilitiesView({ t, caps, models, refreshCaps, onMessage }: CapabilitiesViewProps): JSX.Element {
  const [kbRows, setKbRows] = useState<KbRow[] | null>(null)
  const [overridesDraft, setOverridesDraft] = useState<Record<string, OverrideDraft>>({})
  const [deletedNames, setDeletedNames] = useState<string[]>([])
  const [clearedIds, setClearedIds] = useState<string[]>([])
  const [editingName, setEditingName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState<string | null>(null)
  /** Pending two-click confirmation ("kb:<name>" / "clear:<id>"). */
  const [confirming, setConfirming] = useState<string | null>(null)

  // Rebuild drafts when server data lands; dirty drafts survive.
  useEffect(() => {
    if (caps === null || !caps.ok) return
    setKbRows(reconcileKbRows(caps.catalog ?? {}, kbRows ?? [], deletedNames))
    setOverridesDraft(reconcileOverrides(caps.overrides ?? {}, overridesDraft, clearedIds))
    // caps is the only input by design: parent state changes only on fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps])

  const vendorOf = useCallback((id: string): string | null => {
    const row = models?.ok && models.models ? models.models.find((m) => m.id === id) : undefined
    return row?.price?.vendor ?? null
  }, [models])

  const viewById = useMemo(() => {
    const map = new Map<string, CapEntryView>()
    for (const entry of caps?.models ?? []) map.set(entry.id, entry)
    return map
  }, [caps])

  const dirty = (kbRows ?? []).some((row) => row.dirty)
    || Object.values(overridesDraft).some((draft) => draft.dirty)
    || deletedNames.length > 0
    || clearedIds.length > 0
  const routeDefault = caps?.routeDefaultInput ?? ['text']

  const patchKb = (name: string, changes: Partial<KbRow>): void => {
    setKbRows((current) => (current ?? []).map((row) => (row.name === name ? { ...row, ...changes, dirty: true } : row)))
  }

  const patchOverride = (id: string, changes: Partial<OverrideDraft>): void => {
    setOverridesDraft((current) => {
      const base = current[id] ?? seedOverride(id)
      return { ...current, [id]: { ...base, ...changes, dirty: true } }
    })
  }

  /** Seed an override draft from the card's currently displayed values. */
  function seedOverride(id: string): OverrideDraft {
    const view = viewById.get(id)
    return {
      input: view?.input ?? [],
      reasoning: view?.reasoning === false ? 'off' : Array.isArray(view?.reasoning) ? 'on' : null,
      levels: Array.isArray(view?.reasoning) ? view!.reasoning : [],
      contextWindow: view?.contextWindow !== null && view?.contextWindow !== undefined ? String(view.contextWindow) : '',
      dirty: false,
    }
  }

  const fetchSuggestion = async (target: string, apply: (suggestion: { input?: string[], reasoning?: false | { levels?: string[] } | null, contextWindow?: number }) => void): Promise<void> => {
    setFetching(target)
    try {
      const body = await apiGet(`/api/relay/model-info?model=${encodeURIComponent(target)}`)
      const suggestion = body.suggestion as { input?: string[], reasoning?: false | { levels?: string[] } | null, contextWindow?: number, miss?: boolean } | undefined
      if (suggestion && !suggestion.miss) {
        apply(suggestion)
        onMessage(null)
      } else {
        onMessage({ ok: false, text: `${target}: ${t('capFetchMiss')}` })
      }
    } catch {
      onMessage({ ok: false, text: t('capFetchFail') })
    } finally {
      setFetching(null)
    }
  }

  const applySuggestionToDraft = (target: { input: string[], reasoning: 'on' | 'off' | null, levels: string[], contextWindow: string }, suggestion: { input?: string[], reasoning?: false | { levels?: string[] } | null, contextWindow?: number }): void => {
    if (Array.isArray(suggestion.input) && suggestion.input.length) target.input = [...suggestion.input]
    if (suggestion.reasoning === false) {
      target.reasoning = 'off'
      target.levels = []
    } else if (suggestion.reasoning && Array.isArray(suggestion.reasoning.levels) && suggestion.reasoning.levels.length) {
      target.reasoning = 'on'
      target.levels = [...suggestion.reasoning.levels]
    }
    if (typeof suggestion.contextWindow === 'number' && suggestion.contextWindow > 0) {
      target.contextWindow = String(suggestion.contextWindow)
    }
  }

  const save = async (): Promise<void> => {
    let catalog: Record<string, CapDictEntry>
    let overrides: Record<string, CapDictEntry>
    try {
      catalog = {}
      const seen = new Set<string>()
      for (const row of kbRows ?? []) {
        const entry = entryFromDraft(row)
        const name = row.name.trim()
        if (!entry && !name) continue
        if (!name) throw new Error(`${t('capKbName')}: ${t('capKbNamePlaceholder')}`)
        if (seen.has(name)) throw new Error(`${t('capKbName')}: ${name}`)
        seen.add(name)
        if (entry) catalog[name] = entry
      }
      overrides = {}
      for (const [id, draft] of Object.entries(overridesDraft)) {
        const entry = entryFromDraft(draft)
        if (entry) overrides[id] = entry
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      const hint = text === 'levels-required' ? t('capLevelsRequired') : text === 'context-invalid' ? t('capContextInvalid') : `${t('actionFail')(text)}`
      onMessage({ ok: false, text: hint })
      return
    }
    setSaving(true)
    onMessage(null)
    try {
      const body = await apiPost('/api/relay/capabilities', { catalog, overrides })
      if (body.ok) {
        setKbRows((current) => (current ?? []).filter((row) => row.name.trim() !== '').map((row) => ({ ...row, dirty: false })))
        setOverridesDraft((current) => Object.fromEntries(Object.entries(current).map(([id, draft]) => [id, { ...draft, dirty: false }])))
        setDeletedNames([])
        setClearedIds([])
        setEditingName(null)
        onMessage({ ok: true, text: t('capSavedOk') })
        refreshCaps()
      } else {
        onMessage({ ok: false, text: `${t('actionFail')(String(body.error ?? '?'))}` })
      }
    } catch (err) {
      onMessage({ ok: false, text: t('actionFail')(err instanceof Error ? err.message : String(err)) })
    } finally {
      setSaving(false)
    }
  }

  const deleteKbRow = (row: KbRow): void => {
    if (confirming !== `kb:${row.name}`) {
      setConfirming(`kb:${row.name}`)
      return
    }
    setConfirming(null)
    setKbRows((current) => (current ?? []).filter((entry) => entry.name !== row.name))
    if (!row.dirty && caps?.catalog?.[row.name]) {
      setDeletedNames((current) => [...current, row.name])
    }
  }

  const clearOverride = (id: string): void => {
    if (confirming !== `clear:${id}`) {
      setConfirming(`clear:${id}`)
      return
    }
    setConfirming(null)
    setOverridesDraft((current) => {
      const { [id]: _removed, ...kept } = current
      return kept
    })
    setClearedIds((current) => (current.includes(id) ? current : [...current, id]))
  }

  const addKbRow = (): void => {
    if ((kbRows ?? []).some((row) => row.name === '')) {
      setEditingName('')
      return
    }
    const ghost: KbRow = { name: '', input: ['text'], reasoning: null, levels: [], contextWindow: '', dirty: true }
    setKbRows((current) => [...(current ?? []), ghost])
    setEditingName('')
  }

  const renameKbRow = (previousName: string, nextName: string): void => {
    setKbRows((current) => (current ?? []).map((row) => (row.name === previousName ? { ...row, name: nextName, dirty: true } : row)))
  }

  /** Renaming a stored row = delete old name + add the new one on save. */
  const commitKbRename = (row: KbRow, nextName: string): void => {
    const trimmed = nextName.trim()
    if (trimmed === row.name) return
    if (!row.dirty && caps?.catalog?.[row.name]) {
      setDeletedNames((current) => (current.includes(row.name) ? current : [...current, row.name]))
    }
    renameKbRow(row.name, trimmed)
    // the row is keyed by name: keep edit mode on the renamed row
    setEditingName((current) => (current === row.name ? trimmed : current))
  }

  const sourceBadge = (view: { source: CapEntryView['source'], catalogName: string | null }): { text: string, className: string } => {
    if (view.source === 'override') return { text: t('capSourceOverride'), className: 'relay_capBadge relay_capBadgeOverride' }
    if (view.source === 'catalog') return { text: t('capSourceCatalog')(view.catalogName ?? ''), className: 'relay_capBadge relay_capBadgeCatalog' }
    if (view.source === 'catalog-approximate') return { text: t('capSourceApproximate')(view.catalogName ?? ''), className: 'relay_capBadge relay_capBadgeApprox' }
    return { text: t('capSourceNone'), className: 'relay_capBadge' }
  }

  const modalityChips = (selected: readonly string[], onChange: (next: string[]) => void): JSX.Element => (
    <>
      {MODALITIES.map((modality) => {
        const on = selected.includes(modality)
        const label = modality === 'text' ? t('capModalityText') : t('capModalityImage')
        return (
          <button
            key={modality}
            type="button"
            className={on ? 'relay_chip relay_chipOn' : 'relay_chip'}
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((m) => m !== modality) : [...selected, modality])}
          >
            {label}
          </button>
        )
      })}
    </>
  )

  const reasoningEditor = (draft: { reasoning: 'on' | 'off' | null, levels: string[] }, onChange: (changes: { reasoning?: 'on' | 'off' | null, levels?: string[] }) => void): JSX.Element => (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={draft.reasoning === 'on'}
        className={draft.reasoning === 'on' ? 'relay_switch relay_switchOn' : 'relay_switch'}
        onClick={() => {
          if (draft.reasoning === 'on') onChange({ reasoning: 'off', levels: [] })
          else onChange({ reasoning: 'on', levels: draft.levels.length ? draft.levels : ['medium'] })
        }}
      >
        <span className="relay_switchKnob" />
      </button>
      {draft.reasoning === null && <span className="relay_capHint">{t('capReasoningUndeclared')}</span>}
      {draft.reasoning === 'off' && <span className="relay_capHint">{t('capReasoningOff')}</span>}
      {draft.reasoning === 'on' && (
        <span className="relay_row">
          {EFFORT_LEVELS.map((level) => {
            const on = draft.levels.includes(level)
            return (
              <button
                key={level}
                type="button"
                className={on ? 'relay_chip relay_chipOn' : 'relay_chip'}
                aria-pressed={on}
                onClick={() => {
                  const next = on ? draft.levels.filter((l) => l !== level) : [...draft.levels, level]
                  onChange({ levels: EFFORT_LEVELS.filter((l) => next.includes(l)) })
                }}
              >
                {level}
              </button>
            )
          })}
        </span>
      )}
    </>
  )

  const contextInput = (value: string, onChange: (next: string) => void): JSX.Element => (
    <>
      <span className="relay_capLegend">{t('capContextLegend')}</span>
      <input
        type="number"
        min={1}
        className="relay_input relay_capContext"
        placeholder={t('capContextPlaceholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  )

  const kbSummary = (row: KbRow): string => {
    const parts: string[] = []
    parts.push(row.input.length ? row.input.join(' / ') : '—')
    parts.push(row.reasoning === 'off' ? t('capReasoningOff') : row.reasoning === 'on' ? row.levels.join(' / ') : t('capReasoningUndeclared'))
    parts.push(row.contextWindow.trim() !== '' ? row.contextWindow.trim() : '—')
    return parts.join(' · ')
  }

  return (
    <div className="relay_tabPane">
      <div className="relay_head">
        <div>
          <div className="relay_cardTitle">{t('capTitle')}</div>
          <p className="relay_metaLine">{t('capIntro')}</p>
        </div>
        <button type="button" className="relay_button relay_buttonPrimary" disabled={saving || !dirty} onClick={() => { void save() }}>
          {saving ? t('capSaving') : t('capSave')}
        </button>
      </div>
      {caps === null ? <div className="relay_empty">{t('loading')}</div>
        : !caps.ok ? <div className="relay_msg relay_msgErr">{`${t('actionFail')(String(caps.error ?? '?'))}`}</div>
        : (
          <>
            <div className="relay_capSection">
              <div className="relay_capSectionTitle">{t('capKbTitle')}</div>
              <p className="relay_metaLine">{t('capKbIntro')}</p>
              {(kbRows ?? []).length === 0 && <div className="relay_empty">{t('capKbEmpty')}</div>}
              {(kbRows ?? []).map((row) => {
                const editing = editingName === row.name
                return (
                  <div key={row.name === '' ? '__new__' : row.name} className={row.dirty ? 'relay_capCard relay_capCardDirty' : 'relay_capCard'}>
                    <div className="relay_capHead">
                      <span className="relay_capId">{row.name || t('capKbName')}</span>
                      {!editing && <span className="relay_capBadge">{kbSummary(row)}</span>}
                      <span className="relay_capActions">
                        <button
                          type="button"
                          className="relay_button relay_buttonSecondary relay_buttonSm"
                          disabled={fetching !== null || row.name.trim() === ''}
                          title={t('capFetch')}
                          onClick={() => {
                            void fetchSuggestion(row.name, (suggestion) => {
                              const next = { input: [...row.input], reasoning: row.reasoning, levels: [...row.levels], contextWindow: row.contextWindow }
                              applySuggestionToDraft(next, suggestion)
                              patchKb(row.name, next)
                            })
                          }}
                        >
                          {fetching === row.name ? t('capFetching') : '↻'}
                        </button>
                        <button
                          type="button"
                          className="relay_button relay_buttonSecondary relay_buttonSm"
                          onClick={() => setEditingName(editing ? null : row.name)}
                        >
                          {editing ? t('capDone') : t('capEdit')}
                        </button>
                        <button
                          type="button"
                          className="relay_button relay_buttonSecondary relay_buttonSm"
                          onClick={() => deleteKbRow(row)}
                        >
                          {confirming === `kb:${row.name}` ? t('capDeleteConfirm') : t('capDelete')}
                        </button>
                      </span>
                    </div>
                    {!editing ? null : (
                      <>
                        <div className="relay_capRow">
                          <span className="relay_capLegend">{t('capKbName')}</span>
                          <input
                            className="relay_input relay_kbName"
                            placeholder={t('capKbNamePlaceholder')}
                            value={row.name}
                            onChange={(e) => commitKbRename(row, e.target.value)}
                          />
                        </div>
                        <div className="relay_capRow">
                          <span className="relay_capLegend">{t('capInputLegend')}</span>
                          {modalityChips(row.input, (next) => patchKb(row.name, { input: next }))}
                        </div>
                        <div className="relay_capRow">
                          <span className="relay_capLegend">{t('capReasoningLegend')}</span>
                          {reasoningEditor(row, (changes) => patchKb(row.name, changes))}
                        </div>
                        <div className="relay_capRow">
                          {contextInput(row.contextWindow, (next) => patchKb(row.name, { contextWindow: next }))}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
              <div className="relay_rowEnd">
                <button type="button" className="relay_button relay_buttonSecondary" onClick={addKbRow}>
                  + {t('capKbAdd')}
                </button>
              </div>
            </div>

            <div className="relay_capSection">
              <div className="relay_capSectionTitle">{t('capPlatformTitle')}</div>
              <p className="relay_metaLine">{t('capPlatformIntro')}</p>
              {!caps.configured || (caps.models ?? []).length === 0 ? <div className="relay_empty">{t('capNotConfigured')}</div>
                : (caps.models ?? []).map((view) => {
                  const draft = overridesDraft[view.id]
                  const current = draft ?? seedOverride(view.id)
                  const badge = sourceBadge(draft
                    ? { source: 'override' as const, catalogName: null }
                    : { source: view.source, catalogName: view.catalogName })
                  return (
                    <div key={view.id} className={draft?.dirty ? 'relay_capCard relay_capCardDirty' : 'relay_capCard'}>
                      <div className="relay_capHead">
                        <span className="relay_capId">{view.id}</span>
                        {vendorOf(view.id) !== null && <span className="relay_capVendor">{vendorOf(view.id)}</span>}
                        <span className={badge.className}>{badge.text}</span>
                        <span className="relay_capActions">
                          <button
                            type="button"
                            className="relay_button relay_buttonSecondary relay_buttonSm"
                            disabled={fetching !== null}
                            title={t('capFetch')}
                            onClick={() => {
                              void fetchSuggestion(view.id, (suggestion) => {
                                const next = { input: [...current.input], reasoning: current.reasoning, levels: [...current.levels], contextWindow: current.contextWindow }
                                applySuggestionToDraft(next, suggestion)
                                patchOverride(view.id, next)
                              })
                            }}
                          >
                            {fetching === view.id ? t('capFetching') : '↻'}
                          </button>
                          {draft && (
                            <button
                              type="button"
                              className="relay_button relay_buttonSecondary relay_buttonSm"
                              onClick={() => clearOverride(view.id)}
                            >
                              {confirming === `clear:${view.id}` ? t('capDeleteConfirm') : t('capClearOverride')}
                            </button>
                          )}
                        </span>
                      </div>
                      <div className="relay_capRow">
                        <span className="relay_capLegend">{t('capInputLegend')}</span>
                        {modalityChips(current.input, (next) => patchOverride(view.id, { input: next }))}
                        {current.input.length === 0 && (
                          <span className="relay_capHint">
                            {routeDefault.join(' / ')}
                          </span>
                        )}
                      </div>
                      <div className="relay_capRow">
                        <span className="relay_capLegend">{t('capReasoningLegend')}</span>
                        {reasoningEditor(current, (changes) => patchOverride(view.id, changes))}
                      </div>
                      <div className="relay_capRow">
                        {contextInput(current.contextWindow, (next) => patchOverride(view.id, { contextWindow: next }))}
                      </div>
                    </div>
                  )
                })}
            </div>
          </>
          )}
    </div>
  )
}
