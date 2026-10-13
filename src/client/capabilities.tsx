/**
 * The 「模型能力」 tab, v0.6.0 shape — every card commits itself, there is no
 * global save button, and ALL THREE sections edit in place the way the
 * official Models page does: one row expands into an editor card, one card
 * open across the whole page (`openCard`), Apply/Done writes immediately and
 * failures keep the card open. Row action buttons sit on the right and share
 * one style everywhere (outline sm, like the API-keys rows); every editor
 * footer is 取消 (outline) on the left and the primary action on the right.
 *
 *  - 我的条目: user knowledge entries (namespace `capabilityCatalog`); 新增
 *    opens the editor as a create card on top of the list.
 *  - 预置条目: the preset layer (compiled-in mainstream baseline, rebuilt in
 *    host memory by the single 刷新预置 button INSIDE the collapsed panel —
 *    the refresh also replays into every configured route) in a <details>
 *    with a name filter; Edit expands the row in place and Done saves the
 *    copy as a custom entry (which then overrides the preset).
 *  - 平台模型: grouped BY PANEL — one subsection per panel route showing the
 *    derived config with a source badge and a coverage indicator; the matched
 *    knowledge-base name renders under the id. Edit expands the row in place;
 *    Done saves that id's override for THAT panel (overrideSet + panel, or
 *    overrideDelete + panel when the draft is blank); Clear override
 *    confirms in a Modal.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button, IconChevronDownOutlineMedium, Modal, Pill, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { EFFORT_LEVELS, MAX_TOKENS_MAX, MODALITIES } from '../constants.js'
import { apiGet, apiPost } from './api.js'
import {
  contextWindowHint,
  draftFromEntry,
  draftFromView,
  entryFromDraft,
  entrySummary,
  maxTokensHint,
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
  maxTokens: number | null
  source: 'override' | 'catalog' | 'catalog-approximate' | 'preset' | 'preset-approximate' | null
  catalogName: string | null
}

/** One panel's route-catalog view (the platform section groups by this). */
export interface CapPanelView {
  id: string
  configured: boolean
  route: string
  routeDefaultInput?: string[]
  models?: CapEntryView[]
}

export interface CapData {
  ok: boolean
  error?: string
  configured?: boolean
  panels?: CapPanelView[]
  catalog?: Record<string, CapDictEntry>
  overrides?: Record<string, Record<string, CapDictEntry>>
  presets?: Record<string, CapDictEntry>
  /** Compiled-in baseline entry count (v0.6.1 preset status line). */
  baselineCount?: number
  /** Persisted refresh delta summary; absent = no delta stored. */
  presetDelta?: { builtAt: number, added: number, updated: number, removed: number }
}

/** One model row from GET /api/relay/models (price carries the vendor). */
export interface ModelRow {
  id: string
  price?: PriceView | null
}

export interface ModelsData {
  ok: boolean
  error?: string
  models?: ModelRow[]
}

export interface CapabilitiesViewProps {
  t: Translator
  caps: CapData | null
  refreshCaps: () => void
  onMessage: (message: { ok: boolean, text: string } | null) => void
}

/** The one expanded editor across the whole page (official `editing` idiom). */
interface OpenCard {
  section: 'kb' | 'preset' | 'platform'
  /** My-entry name (kb), preset name, or platform model id. '' = kb create. */
  key: string
  /** Owning panel for platform cards. */
  panel?: string
}

/** Localize the client-side draft errors. */
function draftErrorText(err: unknown, t: Translator): string {
  const text = err instanceof Error ? err.message : String(err)
  return text === 'levels-required' ? t('capLevelsRequired')
    : text === 'context-invalid' ? t('capContextInvalid')
    : text === 'max-tokens-invalid' ? t('capMaxTokensInvalid')
    : text
}

/** Coverage counts of one panel's derived models, by source bucket. */
export function coverageCounts(models: readonly CapEntryView[]): { total: number, preset: number, catalog: number, override: number, none: number } {
  const counts = { total: models.length, preset: 0, catalog: 0, override: 0, none: 0 }
  for (const model of models) {
    if (model.source === 'override') counts.override += 1
    else if (model.source === 'catalog' || model.source === 'catalog-approximate') counts.catalog += 1
    else if (model.source === 'preset' || model.source === 'preset-approximate') counts.preset += 1
    else counts.none += 1
  }
  return counts
}

/** The filterable source buckets of the coverage indicator (R5). */
export type CoverageBucket = 'preset' | 'catalog' | 'override' | 'none'

/** Which bucket one derived view belongs to. */
export function coverageBucketOf(view: CapEntryView): CoverageBucket {
  if (view.source === 'override') return 'override'
  if (view.source === 'catalog' || view.source === 'catalog-approximate') return 'catalog'
  if (view.source === 'preset' || view.source === 'preset-approximate') return 'preset'
  return 'none'
}

/** `M-DD` of a unix-ms timestamp (the preset status line's refresh date). */
export function monthDay(builtAt: number): string {
  const d = new Date(builtAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())}`
}

export function CapabilitiesView({ t, caps, refreshCaps, onMessage }: CapabilitiesViewProps): JSX.Element {
  const [openCard, setOpenCard] = useState<OpenCard | null>(null)
  const [kbDelete, setKbDelete] = useState<string | null>(null)
  const [overrideClear, setOverrideClear] = useState<{ panel: string, id: string } | null>(null)
  const [presetFilter, setPresetFilter] = useState('')
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [restoreConfirm, setRestoreConfirm] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [vendors, setVendors] = useState<Record<string, Record<string, string>>>({})
  /** Coverage filter (R5): one panel + one source bucket at a time. */
  const [sourceFilter, setSourceFilter] = useState<{ panel: string, source: CoverageBucket } | null>(null)

  const catalogEntries = useMemo(() => Object.entries(caps?.catalog ?? {}).sort(([a], [b]) => a.localeCompare(b)), [caps])
  const presetEntries = useMemo(() => Object.entries(caps?.presets ?? {}).sort(([a], [b]) => a.localeCompare(b)), [caps])
  const filteredPresets = useMemo(() => {
    const needle = presetFilter.trim().toLowerCase()
    if (!needle) return presetEntries
    return presetEntries.filter(([name]) => name.toLowerCase().includes(needle))
  }, [presetEntries, presetFilter])

  const panelViews = caps?.panels ?? []
  const panelIds = panelViews.map((panel) => panel.id).join(',')

  // Vendor badges come from the per-panel pricing; fetch each panel's model
  // list once per panel-set change (the same call the models tab makes).
  useEffect(() => {
    const ids = panelIds ? panelIds.split(',') : []
    let cancelled = false
    void (async () => {
      const next: Record<string, Record<string, string>> = {}
      await Promise.all(ids.map(async (panelId) => {
        try {
          const body = await apiGet(`/api/relay/models?panel=${encodeURIComponent(panelId)}`)
          const data = body as unknown as ModelsData
          const map: Record<string, string> = {}
          if (data.ok) {
            for (const row of data.models ?? []) {
              if (row.price?.vendor) map[row.id] = row.price.vendor
            }
          }
          next[panelId] = map
        } catch {
          next[panelId] = {}
        }
      }))
      if (!cancelled) setVendors(next)
    })()
    return () => {
      cancelled = true
    }
  }, [panelIds])

  const vendorOf = (panelId: string, id: string): string | null => vendors[panelId]?.[id] ?? null

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

  const submitPlatformCard = async (panelId: string, id: string, draft: CapabilityDraft): Promise<{ ok: boolean, error?: string }> => {
    let entry: CapDictEntry | undefined
    try {
      entry = entryFromDraft(draft)
    } catch (err) {
      return { ok: false, error: draftErrorText(err, t) }
    }
    const ops: Record<string, unknown> = { panel: panelId }
    if (entry) ops.overrideSet = { [id]: entry }
    else ops.overrideDelete = [id]
    const result = await postOps(ops)
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
    const target = overrideClear
    if (target === null) return
    const result = await postOps({ panel: target.panel, overrideDelete: [target.id] })
    setOverrideClear(null)
    if (openCard?.section === 'platform' && openCard.key === target.id && openCard.panel === target.panel) setOpenCard(null)
    onMessage(result.ok
      ? { ok: true, text: t('capOverrideCleared')(target.id) }
      : { ok: false, text: t('actionFail')(String(result.error ?? '?')) })
  }

  const refreshPreset = async (): Promise<void> => {
    setRefreshBusy(true)
    try {
      const body = await apiPost('/api/relay/knowledge-refresh', {})
      if (body.ok && body.replayed !== false) {
        onMessage({ ok: true, text: t('capPresetRefreshedSynced')(Number(body.count ?? 0)) })
        refreshCaps()
      } else if (body.ok) {
        onMessage({ ok: false, text: t('capPresetReplayFail')(String(body.replayError ?? '?')) })
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

  const restoreBaseline = async (): Promise<void> => {
    setRestoreBusy(true)
    try {
      const body = await apiPost('/api/relay/preset-restore', {})
      if (body.ok && body.replayed !== false) {
        onMessage({ ok: true, text: t('capPresetRestored') })
      } else if (body.ok) {
        onMessage({ ok: false, text: t('capPresetRestoreReplayFail')(String(body.replayError ?? '?')) })
      } else {
        onMessage({ ok: false, text: t('capPresetRestoreFail')(String(body.error ?? '?')) })
      }
    } catch (err) {
      onMessage({ ok: false, text: t('capPresetRestoreFail')(err instanceof Error ? err.message : String(err)) })
    } finally {
      setRestoreBusy(false)
      setRestoreConfirm(false)
      refreshCaps()
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

  const open = (section: OpenCard['section'], key: string, panel?: string): void => setOpenCard({ section, key, panel })
  const isOpen = (section: OpenCard['section'], key: string, panel?: string): boolean =>
    openCard !== null && openCard.section === section && openCard.key === key && openCard.panel === panel

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
                  <IconChevronDownOutlineMedium className="relay_presetChevron" />
                  {t('capPresetCount')(presetEntries.length)}
                </summary>
                <div className="relay_presetBody">
                  <p className="relay_metaLine">
                    {caps.presetDelta !== undefined && caps.baselineCount !== undefined
                      ? t('capPresetDeltaLine')(caps.baselineCount, caps.presetDelta.added + caps.presetDelta.updated, caps.presetDelta.removed, monthDay(caps.presetDelta.builtAt))
                      : t('capPresetBaseline')(caps.baselineCount ?? presetEntries.length)}
                  </p>
                  <p className="relay_metaLine">{t('capPresetIntro')}</p>
                  <div className="relay_presetToolbar">
                    <input
                      className="relay_input relay_presetFilter"
                      placeholder={t('capPresetFilterPlaceholder')}
                      value={presetFilter}
                      onChange={(e) => setPresetFilter(e.target.value)}
                    />
                    <Button variant="ghost" size="sm" disabled={refreshBusy || restoreBusy} onClick={() => { void refreshPreset() }}>
                      {refreshBusy ? t('capPresetRefreshing') : t('capPresetRefresh')}
                    </Button>
                    {caps.presetDelta !== undefined && (
                      <Button variant="outline" size="sm" disabled={refreshBusy || restoreBusy} onClick={() => setRestoreConfirm(true)}>
                        {restoreBusy ? t('capPresetRestoring') : t('capPresetRestore')}
                      </Button>
                    )}
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
              {panelViews.every((panel) => !panel.configured) || panelViews.length === 0 ? <div className="relay_empty">{t('capNotConfigured')}</div>
                : panelViews.map((panel) => {
                  const models = panel.models ?? []
                  const coverage = coverageCounts(models)
                  const panelFilter = sourceFilter !== null && sourceFilter.panel === panel.id ? sourceFilter.source : null
                  const shownModels = panelFilter === null ? models : models.filter((view) => coverageBucketOf(view) === panelFilter)
                  const segment = (bucket: CoverageBucket, label: string, count: number): JSX.Element => (
                    <button
                      key={bucket}
                      type="button"
                      className={panelFilter === bucket ? 'relay_capFilterSeg relay_capFilterSegActive' : 'relay_capFilterSeg'}
                      onClick={() => setSourceFilter(panelFilter === bucket ? null : { panel: panel.id, source: bucket })}
                    >
                      {label} {count}
                    </button>
                  )
                  return (
                    <div key={panel.id} className="relay_capPanelGroup">
                      <div className="relay_capPanelHead">
                        <span className="relay_capPanelName">{panel.id}</span>
                        <span className="relay_capHint">
                          {t('capCoverageTotal')(coverage.total)}
                          {t('capCoverageColon')}
                          {segment('preset', t('capSourcePreset'), coverage.preset)}
                          {' · '}
                          {segment('catalog', t('capSourceCatalog'), coverage.catalog)}
                          {' · '}
                          {segment('override', t('capSourceOverride'), coverage.override)}
                          {' · '}
                          {segment('none', t('capSourceNone'), coverage.none)}
                        </span>
                      </div>
                      {!panel.configured || models.length === 0 ? <div className="relay_empty">{t('capNotConfigured')}</div>
                        : shownModels.length === 0 ? <div className="relay_empty">{t('capPresetEmpty')}</div>
                        : shownModels.map((view) => {
                          if (isOpen('platform', view.id, panel.id)) {
                            return (
                              <PlatformCard
                                key={`edit:${panel.id}:${view.id}`}
                                panel={panel.id}
                                view={view}
                                override={caps.overrides?.[panel.id]?.[view.id]}
                                vendor={vendorOf(panel.id, view.id)}
                                routeDefault={panel.routeDefaultInput ?? ['text']}
                                t={t}
                                submit={(draft) => submitPlatformCard(panel.id, view.id, draft)}
                                onClear={() => setOverrideClear({ panel: panel.id, id: view.id })}
                                onClose={() => setOpenCard(null)}
                              />
                            )
                          }
                          const approx = view.source?.includes('approximate') ?? false
                          const vendor = vendorOf(panel.id, view.id)
                          return (
                            <div key={`${panel.id}:${view.id}`} className="relay_capRowLine">
                              <span className="relay_capNameCell">
                                <span className="relay_capId" title={view.id}>{view.id}</span>
                                {view.catalogName !== null && (
                                  <span className="relay_capMatch">{t('capMatchedName')(view.catalogName, approx)}</span>
                                )}
                              </span>
                              {vendor !== null && <Tag tone="outline">{vendor}</Tag>}
                              {sourceBadge(view)}
                              <span className="relay_capSummary">{entrySummary({
                                input: view.input ?? undefined,
                                reasoning: view.reasoning ?? undefined,
                                contextWindow: view.contextWindow ?? undefined,
                                maxTokens: view.maxTokens ?? undefined,
                              }, t)}</span>
                              <span className="relay_capActions">
                                <Button variant="outline" size="sm" disabled={openCard !== null} onClick={() => open('platform', view.id, panel.id)}>
                                  {t('capEdit')}
                                </Button>
                              </span>
                            </div>
                          )
                        })}
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
        title={overrideClear !== null ? t('capOverrideClearTitle')(overrideClear.id) : ''}
        closeLabel={t('close')}
        description={t('capOverrideClearDesc')}
        footer={(
          <>
            <Button variant="outline" onClick={() => setOverrideClear(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { void clearOverride() }}>{t('capClearOverride')}</Button>
          </>
        )}
      />
      <Modal
        open={restoreConfirm}
        onClose={() => { if (!restoreBusy) setRestoreConfirm(false) }}
        title={t('capPresetRestoreTitle')}
        closeLabel={t('close')}
        description={t('capPresetRestoreDesc')}
        footer={(
          <>
            <Button variant="outline" disabled={restoreBusy} onClick={() => setRestoreConfirm(false)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={restoreBusy} onClick={() => { void restoreBaseline() }}>
              {restoreBusy ? t('capPresetRestoring') : t('capPresetRestore')}
            </Button>
          </>
        )}
      />
    </div>
  )
}

/** Shared field editors: modality pills, reasoning switch + level pills, context/output text inputs. */
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
  const maxText = draft.maxTokens
  const maxHint = maxTokensHint(maxText)
  const maxInvalid = maxText.trim() !== '' && maxHint === null
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
      <div className="relay_capRow">
        <span className="relay_capLegend">{t('capMaxTokensLegend')}</span>
        <input
          type="text"
          className="relay_input relay_capContext"
          placeholder={t('capMaxTokensPlaceholder')}
          value={maxText}
          onChange={(e) => onChange({ maxTokens: e.target.value })}
        />
        {maxInvalid && <span className="relay_capInvalid">{t('capMaxTokensInvalid')}</span>}
        {!maxInvalid && maxHint !== null && <span className="relay_capHint">{maxHint}</span>}
        {maxText.trim() === '' && <span className="relay_capHint">≤ {MAX_TOKENS_MAX.toLocaleString('en-US')}</span>}
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

/** The one open platform editor card (per-panel per-id override). */
function PlatformCard(props: {
  panel: string
  view: CapEntryView
  override: CapDictEntry | undefined
  vendor: string | null
  routeDefault: string[]
  t: Translator
  submit: (draft: CapabilityDraft) => Promise<{ ok: boolean, error?: string }>
  onClear: () => void
  onClose: () => void
}): JSX.Element {
  const { panel, view, override, t, submit, onClear, onClose } = props
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
        <Tag tone="quiet">{panel}</Tag>
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
