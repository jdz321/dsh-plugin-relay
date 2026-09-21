/**
 * The 「模型能力」 tab: one card per model with its input modalities and
 * reasoning configuration. Card values edit local drafts; the page-level
 * 保存 submits every dirty card in one POST, which the host merges into the
 * stored route models field-by-field. The ↻ button pulls reference values
 * from models.dev via the host (cached there), never blocking on the network.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { EFFORT_LEVELS, MODALITIES } from '../constants.js'
import { apiGet, apiPost } from './api.js'
import type { PriceView } from './format.js'
import type { Translator } from './locale.js'

/** One stored capability entry from GET /api/relay/capabilities. */
export interface CapEntry {
  id: string
  input: string[] | null
  reasoning: false | string[] | null
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
  models?: CapEntry[]
}

export interface ModelsData {
  ok: boolean
  error?: string
  models?: ModelRow[]
}

interface CapCard {
  id: string
  /** Selected modalities; empty = follow the route default. */
  input: string[]
  /** 'on' = reasoning with levels, 'off' = explicitly non-reasoning, null = undeclared. */
  reasoning: 'on' | 'off' | null
  levels: string[]
  vendor: string | null
  /** The id is not served by the active key (manual or stale entry). */
  removable: boolean
  /** The entry exists in the stored route config. */
  stored: boolean
  dirty: boolean
}

export interface CapabilitiesViewProps {
  t: Translator
  caps: CapData | null
  models: ModelsData | null
  refreshCaps: () => void
  onMessage: (message: { ok: boolean, text: string } | null) => void
}

function cardFrom(entry: CapEntry, keyIds: ReadonlySet<string> | null, vendorOf: (id: string) => string | null): CapCard {
  const reasoning = entry.reasoning === false ? 'off' : Array.isArray(entry.reasoning) ? 'on' : null
  return {
    id: entry.id,
    input: entry.input ?? [],
    reasoning,
    levels: Array.isArray(entry.reasoning) ? entry.reasoning : [],
    vendor: vendorOf(entry.id),
    removable: keyIds !== null && !keyIds.has(entry.id),
    stored: true,
    dirty: false,
  }
}

function hasStoredValues(card: CapCard): boolean {
  return card.input.length > 0 || card.reasoning !== null
}

/**
 * Rebuild the card list from server data. Drafts of dirty cards survive
 * (an interrupted save, or a refresh triggered mid-edit, must not wipe
 * local changes); clean cards take the server view. Manual additions
 * survive until the next successful save.
 */
export function reconcileCards(
  capsModels: readonly CapEntry[],
  keyIds: ReadonlySet<string> | null,
  vendorOf: (id: string) => string | null,
  previous: readonly CapCard[] | undefined,
  added: readonly string[],
): CapCard[] {
  const drafts = new Map((previous ?? []).filter((card) => card.dirty).map((card) => [card.id, card]))
  const next: CapCard[] = []
  const seen = new Set<string>()
  for (const entry of capsModels) {
    const fresh = cardFrom(entry, keyIds, vendorOf)
    const draft = drafts.get(entry.id)
    next.push(draft ? { ...fresh, input: draft.input, reasoning: draft.reasoning, levels: draft.levels, dirty: true } : fresh)
    seen.add(entry.id)
  }
  for (const id of keyIds ?? []) {
    if (seen.has(id)) continue
    seen.add(id)
    const draft = drafts.get(id)
    next.push(draft ?? { id, input: [], reasoning: null, levels: [], vendor: vendorOf(id), removable: false, stored: false, dirty: false })
  }
  for (const id of added) {
    if (seen.has(id)) continue
    seen.add(id)
    const draft = drafts.get(id)
    next.push(draft ?? { id, input: [], reasoning: null, levels: [], vendor: null, removable: true, stored: false, dirty: true })
  }
  return next.sort((a, b) => a.id.localeCompare(b.id))
}

/** The capabilities tab pane. */
export function CapabilitiesView({ t, caps, models, refreshCaps, onMessage }: CapabilitiesViewProps): JSX.Element {
  const [cards, setCards] = useState<CapCard[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  /** Pending two-click confirmation ("clear:<id>" / "remove:<id>"). */
  const [confirming, setConfirming] = useState<string | null>(null)
  /** Inline add-model row. */
  const [adding, setAdding] = useState(false)
  const [addId, setAddId] = useState('')

  const keyIds = useMemo(
    () => (models?.ok && models.models ? new Set(models.models.map((m) => m.id)) : null),
    [models],
  )
  const vendorOf = useCallback((id: string): string | null => {
    const row = models?.ok && models.models ? models.models.find((m) => m.id === id) : undefined
    return row?.price?.vendor ?? null
  }, [models])

  // Rebuild the card list whenever server data lands (see reconcileCards).
  useEffect(() => {
    if (caps === null || !caps.ok) return
    setCards(reconcileCards(caps.models ?? [], keyIds, vendorOf, cards ?? [], added))
  }, [caps, models, added, keyIds, vendorOf])

  const patch = (id: string, changes: Partial<CapCard>): void => {
    setCards((current) => (current ?? []).map((card) => (card.id === id ? { ...card, ...changes, dirty: true } : card)))
  }

  const dirtyCards = (cards ?? []).filter((card) => card.dirty)
  const routeDefault = caps?.routeDefaultInput ?? ['text']

  const save = async (): Promise<void> => {
    if (dirtyCards.length === 0) return
    for (const card of dirtyCards) {
      if (card.reasoning === 'on' && card.levels.length === 0) {
        onMessage({ ok: false, text: `${card.id}: ${t('capLevelsRequired')}` })
        return
      }
    }
    setSaving(true)
    onMessage(null)
    try {
      const updates = dirtyCards.map((card) => ({
        id: card.id,
        input: card.input,
        reasoning: card.reasoning === 'on' ? { levels: card.levels } : card.reasoning === 'off' ? false as const : null,
      }))
      const body = await apiPost('/api/relay/capabilities', { updates })
      if (body.ok) {
        setAdded([])
        // Drop the local dirty flags so the post-save rebuild takes the
        // server view instead of re-merging the just-saved drafts.
        setCards((current) => (current ?? []).map((card) => ({ ...card, dirty: false })))
        onMessage({ ok: true, text: t('capSavedOk')(updates.length) })
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

  const fetchSuggestion = async (card: CapCard): Promise<void> => {
    setFetching(card.id)
    try {
      const body = await apiGet(`/api/relay/model-info?model=${encodeURIComponent(card.id)}`)
      const suggestion = body.suggestion as { input?: string[], reasoning?: false | { levels?: string[] } | null, miss?: boolean } | undefined
      if (suggestion && !suggestion.miss) {
        const changes: Partial<CapCard> = { dirty: true }
        if (Array.isArray(suggestion.input)) changes.input = suggestion.input
        if (suggestion.reasoning === false) {
          changes.reasoning = 'off'
          changes.levels = []
        } else if (suggestion.reasoning && Array.isArray(suggestion.reasoning.levels) && suggestion.reasoning.levels.length) {
          changes.reasoning = 'on'
          changes.levels = suggestion.reasoning.levels
        }
        patch(card.id, changes)
        onMessage(null)
      } else {
        onMessage({ ok: false, text: `${card.id}: ${t('capFetchMiss')}` })
      }
    } catch {
      onMessage({ ok: false, text: t('capFetchFail') })
    } finally {
      setFetching(null)
    }
  }

  const clearCard = async (card: CapCard): Promise<void> => {
    // Two-click confirm: window.confirm is suppressed in embedded webviews.
    if (confirming !== `clear:${card.id}`) {
      setConfirming(`clear:${card.id}`)
      return
    }
    setConfirming(null)
    if (!card.stored && !hasStoredValues(card)) {
      // Never-saved card: just drop it locally.
      setCards((current) => (current ?? []).filter((entry) => entry.id !== card.id))
      return
    }
    try {
      const body = await apiPost('/api/relay/capabilities', { updates: [{ id: card.id, removeCapability: true }] })
      if (body.ok) {
        onMessage({ ok: true, text: t('capCleared') })
        refreshCaps()
      } else {
        onMessage({ ok: false, text: t('actionFail')(String(body.error ?? '?')) })
      }
    } catch (err) {
      onMessage({ ok: false, text: t('actionFail')(err instanceof Error ? err.message : String(err)) })
    }
  }

  const removeCard = async (card: CapCard): Promise<void> => {
    if (confirming !== `remove:${card.id}`) {
      setConfirming(`remove:${card.id}`)
      return
    }
    setConfirming(null)
    try {
      const body = await apiPost('/api/relay/capabilities', { updates: [{ id: card.id, removeModel: true }] })
      if (body.ok) {
        setCards((current) => (current ?? []).filter((entry) => entry.id !== card.id))
        refreshCaps()
      } else {
        onMessage({ ok: false, text: t('actionFail')(String(body.error ?? '?')) })
      }
    } catch (err) {
      onMessage({ ok: false, text: t('actionFail')(err instanceof Error ? err.message : String(err)) })
    }
  }

  const submitAdd = (): void => {
    const id = addId.trim()
    if (!id) return
    if ((cards ?? []).some((card) => card.id === id)) {
      setAddId('')
      setAdding(false)
      return
    }
    setAdded((current) => [...current, id])
    setAddId('')
    setAdding(false)
    onMessage(null)
  }

  return (
    <div className="relay_tabPane">
      <div className="relay_head">
        <div>
          <div className="relay_cardTitle">{t('capTitle')}</div>
          <p className="relay_metaLine">{t('capIntro')}</p>
        </div>
        <button
          type="button"
          className="relay_button relay_buttonPrimary"
          disabled={saving || dirtyCards.length === 0}
          onClick={() => { void save() }}
        >
          {saving ? t('capSaving') : t('capSave')}
        </button>
      </div>
      {cards === null ? <div className="relay_empty">{t('loading')}</div>
        : cards.length === 0 ? <div className="relay_empty">{t('capNotConfigured')}</div>
        : cards.map((card) => (
          <div key={card.id} className={card.dirty ? 'relay_capCard relay_capCardDirty' : 'relay_capCard'}>
            <div className="relay_capHead">
              <span className="relay_capId">{card.id}</span>
              {card.vendor !== null && <span className="relay_capVendor">{card.vendor}</span>}
              <span className="relay_capActions">
                <button
                  type="button"
                  className="relay_button relay_buttonSecondary relay_buttonSm"
                  disabled={fetching !== null}
                  title={t('capFetch')}
                  onClick={() => { void fetchSuggestion(card) }}
                >
                  {fetching === card.id ? t('capFetching') : '↻'}
                </button>
                {card.removable
                  ? (
                    <button
                      type="button"
                      className="relay_button relay_buttonSecondary relay_buttonSm"
                      onClick={() => { void removeCard(card) }}
                    >
                      {confirming === `remove:${card.id}` ? t('capConfirmYes') : t('capRemove')}
                    </button>
                    )
                  : (
                    <button
                      type="button"
                      className="relay_button relay_buttonSecondary relay_buttonSm"
                      onClick={() => { void clearCard(card) }}
                    >
                      {confirming === `clear:${card.id}` ? t('capConfirmYes') : t('capClear')}
                    </button>
                    )}
              </span>
            </div>
            <div className="relay_capRow">
              <span className="relay_capLegend">{t('capInputLegend')}</span>
              {MODALITIES.map((modality) => {
                const on = card.input.includes(modality)
                const label = modality === 'text' ? t('capModalityText') : t('capModalityImage')
                return (
                  <button
                    key={modality}
                    type="button"
                    className={on ? 'relay_chip relay_chipOn' : 'relay_chip'}
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? card.input.filter((m) => m !== modality) : [...card.input, modality]
                      patch(card.id, { input: next })
                    }}
                  >
                    {label}
                  </button>
                )
              })}
              {card.input.length === 0 && (
                <span className="relay_capHint">
                  {t('capInputEmptyHint')}{routeDefault.join(' / ')}{t('capInputEmptyHintTail')}
                </span>
              )}
            </div>
            <div className="relay_capRow">
              <span className="relay_capLegend">{t('capReasoningLegend')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={card.reasoning === 'on'}
                aria-label={`${card.id} ${t('capReasoningLegend')}`}
                className={card.reasoning === 'on' ? 'relay_switch relay_switchOn' : 'relay_switch'}
                onClick={() => {
                  if (card.reasoning === 'on') patch(card.id, { reasoning: 'off', levels: [] })
                  else patch(card.id, { reasoning: 'on', levels: card.levels.length ? card.levels : ['medium'] })
                }}
              >
                <span className="relay_switchKnob" />
              </button>
              {card.reasoning === null && <span className="relay_capHint">{t('capReasoningUndeclared')}</span>}
              {card.reasoning !== null && (
                <span className="relay_row">
                  {EFFORT_LEVELS.map((level) => {
                    const on = card.levels.includes(level)
                    return (
                      <button
                        key={level}
                        type="button"
                        className={on ? 'relay_chip relay_chipOn' : 'relay_chip'}
                        aria-pressed={on}
                        onClick={() => {
                          const next = on ? card.levels.filter((l) => l !== level) : [...card.levels, level]
                          patch(card.id, { levels: EFFORT_LEVELS.filter((l) => next.includes(l)) })
                        }}
                      >
                        {level}
                      </button>
                    )
                  })}
                </span>
              )}
              {card.reasoning === 'off' && <span className="relay_capHint">{t('capReasoningOff')}</span>}
            </div>
          </div>
        ))}
      {cards !== null && cards.length > 0 && (
        adding ? (
          <div className="relay_row">
            <input
              className="relay_input"
              style={{ maxWidth: 320 }}
              value={addId}
              placeholder={t('capAddPrompt')}
              autoFocus
              onChange={(e) => setAddId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitAdd() }}
            />
            <button type="button" className="relay_button relay_buttonPrimary relay_buttonSm" disabled={!addId.trim()} onClick={submitAdd}>
              {t('capAdd')}
            </button>
            <button type="button" className="relay_button relay_buttonSecondary relay_buttonSm" onClick={() => { setAdding(false); setAddId('') }}>
              {t('capCancel')}
            </button>
          </div>
        ) : (
          <div className="relay_rowEnd">
            <button type="button" className="relay_button relay_buttonSecondary" onClick={() => setAdding(true)}>
              + {t('capAdd')}
            </button>
          </div>
        )
      )}
    </div>
  )
}
