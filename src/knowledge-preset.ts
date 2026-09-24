/**
 * Knowledge-preset construction, shared verbatim by the build-time script
 * (`npm run preset:fetch`) and the runtime 「刷新预置」 route — both must
 * produce the same layer, so the logic lives once here.
 *
 * Sources:
 *  - 主源 (panel): the panel's public `GET /api/pricing` model ids,
 *    normalized onto models.dev canonical names through the SAME
 *    matchCatalogName rules the runtime derivation uses (exact → strip up to
 *    two variant suffixes); panel-specific ids that match nothing are
 *    dropped. Public endpoint — no credentials involved anywhere.
 *  - 基源 (whitelist): every model under a curated list of mainstream
 *    providers in the models.dev api.json document.
 *
 * The union of both name sets is mapped through mapModelsDevEntry +
 * mergeSuggestions (per name across ALL providers — same-name entries union,
 * largest known context window wins), exactly like the v0.5.0 per-model ↻.
 */

import { mapModelsDevEntry, mergeSuggestions, type ModelsDevDocument } from './capabilities.js'
import { matchCatalogName } from './knowledge.js'
import { normalizePricing } from './pricing.js'

/** Panel model ids from a public /api/pricing payload (null when it has no table). */
export function panelModelNames(pricingBody: unknown): string[] | null {
  const pricing = normalizePricing(pricingBody)
  return pricing ? [...pricing.byModel.keys()] : null
}

/** One preset entry — the stored CatalogEntry shape, kept structurally plain. */
export interface PresetEntry {
  input?: string[]
  reasoning?: false | string[]
  contextWindow?: number
}

/**
 * Curated mainstream providers — exact api.json keys, verified 2026-09-25
 * against the live feed (223 providers; note `moonshotai`/`xai`/`zai` are the
 * real spellings, the vendor-brand forms are not). Adjusting this list =
 * edit + re-run preset:fetch.
 */
export const PRESET_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'google-vertex',
  'deepseek',
  'alibaba',
  'moonshotai',
  'xai',
  'mistral',
  'zai',
] as const

/** Presets keep only models released within this window (days; ~6 months). */
export const PRESET_MAX_AGE_DAYS = 183

export interface PresetBuildResult {
  entries: Record<string, PresetEntry>
  /** Panel-matched names that live outside the whitelist providers. */
  panelOnlyNames: string[]
  /** Panel model ids that matched nothing in the document (panel-specific). */
  dropped: string[]
  /** Non-empty panel ids considered (the 主源 size). */
  panelTotal: number
  /** Names excluded purely by the release-age window. */
  agedOut: number
}

export function buildPresetEntries(
  panelModels: readonly string[] | null,
  doc: ModelsDevDocument,
  options: { now?: number } = {},
): PresetBuildResult {
  // name → merged suggestion across ALL providers of the document.
  const mergedByName = new Map<string, ReturnType<typeof mergeSuggestions>>()
  // name → latest release date across providers (ms), null when undated.
  const releasedAt = new Map<string, number | null>()
  for (const models of Object.values(doc)) {
    if (!models?.models) continue
    for (const [name, entry] of Object.entries(models.models)) {
      const mapped = mapModelsDevEntry(entry)
      if (mapped) {
        const previous = mergedByName.get(name)
        mergedByName.set(name, previous ? mergeSuggestions([previous, mapped]) : mapped)
      }
      const date = Date.parse(String((entry as { release_date?: unknown }).release_date ?? ''))
      const previousDate = releasedAt.get(name)
      releasedAt.set(name, Number.isFinite(date) && (!(previousDate ?? 0) || (previousDate ?? 0) < date) ? date : previousDate ?? null)
    }
  }
  const allNames = [...mergedByName.keys()].sort()

  // Release-age window: keep only names whose latest release_date falls
  // within the last PRESET_MAX_AGE_DAYS (undated names cannot qualify).
  const now = options.now ?? Date.now()
  const cutoff = now - PRESET_MAX_AGE_DAYS * 86_400_000
  const recent = (name: string): boolean => {
    const date = releasedAt.get(name)
    return date !== undefined && date !== null && date >= cutoff
  }

  const wanted = new Set<string>()
  const whitelistNames = new Set<string>()
  let agedOut = 0
  for (const provider of PRESET_PROVIDERS) {
    const models = doc[provider]?.models
    if (!models) continue
    for (const name of Object.keys(models)) {
      whitelistNames.add(name)
      if (recent(name)) wanted.add(name)
      else agedOut += 1
    }
  }

  const dropped: string[] = []
  const panelHits = new Set<string>()
  if (panelModels) {
    for (const raw of panelModels) {
      const id = String(raw).trim()
      if (!id) continue
      const match = matchCatalogName(id, allNames)
      if (match) {
        panelHits.add(match.name)
        if (recent(match.name)) wanted.add(match.name)
      } else {
        dropped.push(id)
      }
    }
  }

  const entries: Record<string, PresetEntry> = {}
  for (const name of [...wanted].sort()) {
    const suggestion = mergedByName.get(name)
    if (!suggestion) continue
    const entry: PresetEntry = {}
    if (suggestion.input.length) entry.input = [...suggestion.input]
    if (suggestion.reasoning === false) entry.reasoning = false
    else if (suggestion.reasoning && suggestion.reasoning.levels.length) entry.reasoning = [...suggestion.reasoning.levels]
    if (suggestion.contextWindow !== undefined) entry.contextWindow = suggestion.contextWindow
    if (Object.keys(entry).length > 0) entries[name] = entry
  }
  return {
    entries,
    panelOnlyNames: [...panelHits].filter((name) => !whitelistNames.has(name)).sort(),
    dropped,
    panelTotal: panelModels ? panelModels.filter((raw) => String(raw).trim() !== '').length : 0,
    agedOut,
  }
}
