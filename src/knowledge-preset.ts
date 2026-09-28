/**
 * Knowledge-preset construction, shared verbatim by the build-time script
 * (`npm run preset:fetch`) and the runtime 「刷新预置」 route — both must
 * produce the same layer, so the logic lives once here.
 *
 * v0.6.0 policy — the baseline is the MODELS.DEV MAINSTREAM only; the relay
 * panel is no longer a baseline source (it is only ever the matched object):
 *
 *  1. whitelist: every model under the curated first-party author providers
 *     below (api.json keys verified against the live feed);
 *  2. release window: only models released within PRESET_MAX_AGE_DAYS
 *     (undated entries cannot qualify);
 *  3. non-dialogue models are not admitted (embedding / tts / image / video /
 *     music — judged by output-input modalities AND name form, either signal);
 *  4. channel re-registrations dedupe: names decorated with an `@channel`
 *     suffix, a `vendor/` prefix, or a `-maas` suffix drop when the stripped
 *     name already exists in the set, and rekey to the bare name when it does
 *     not (keeps MaaS-only entries like `deepseek-v3.2-maas` → `deepseek-v3.2`);
 *  5. optional OpenRouter usage backstop (build-time only, key-gated): the
 *     caller maps ranking permaslugs onto models.dev names and passes them in;
 *     they run through the same window and non-dialogue filters.
 *
 * Admitted names map through mapModelsDevEntry + mergeSuggestions (per name
 * across ALL providers — same-name entries union, largest known context window
 * and output limit win), exactly like the per-model ↻ reference values.
 */

import { mapModelsDevEntry, mergeSuggestions, type ModelsDevDocument, type ModelsDevEntry } from './capabilities.js'

/** One preset entry — the stored CatalogEntry shape, kept structurally plain. */
export interface PresetEntry {
  input?: string[]
  reasoning?: false | string[]
  contextWindow?: number
  maxTokens?: number
}
export interface PresetBuildResult {
  entries: Record<string, PresetEntry>
  /** Final names excluded purely by the release-age window. */
  agedOut: number
  /** Final names excluded as non-dialogue (embedding/tts/image/video/music). */
  nonDialogue: number
  /** Decorated channel registrations dropped as duplicates of a bare entry. */
  channelDropped: string[]
  /** Decorated names rekeyed to their bare form (no bare entry existed). */
  rekeyed: Array<{ from: string, to: string }>
  /** Names admitted through the OpenRouter rankings backstop. */
  openrouterNames: string[]
}

/**
 * Curated first-party author providers — exact api.json keys, verified against
 * the live feed (2026-09-27: `moonshotai`/`xai`/`zai` are the real spellings,
 * the vendor-brand forms are not; `-cn` mirrors exist for the Chinese houses).
 * Aggregator providers (llmgateway, 302ai, ...) host far more ids but are not
 * model authors and say nothing about mainstream. Adjusting this list =
 * edit + re-run preset:fetch.
 */
export const PRESET_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'google-vertex',
  'xai',
  'deepseek',
  'alibaba',
  'alibaba-cn',
  'moonshotai',
  'moonshotai-cn',
  'zai',
  'zhipuai',
  'minimax',
  'minimax-cn',
  'xiaomi',
  'mistral',
] as const

/** Presets keep only models released within this window (days; operator-set to 1 year). */
export const PRESET_MAX_AGE_DAYS = 365

/**
 * Name-form signal for non-dialogue models. Deliberately conservative: only
 * unambiguous generation/embedding morphemes; vision-language (`-vl`), omni,
 * and realtime chat models stay dialogue.
 */
const NON_DIALOGUE_NAME = /embed|imagen|imagine|image|video|tts|whisper|music|speech|dall-|flux|sora|veo|seedance|seedream|kling|runway|ideogram|recraft|hidream/i

/**
 * Non-dialogue judgment for one candidate: modalities signal (declared output
 * without text, or declared input without text) OR the name-form signal.
 * Absent modalities never decide alone — the name form does.
 */
export function isNonDialogueModel(name: string, entry: ModelsDevEntry | undefined): boolean {
  if (NON_DIALOGUE_NAME.test(name)) return true
  const input = entry?.modalities?.input
  if (Array.isArray(input) && input.length > 0 && !input.includes('text')) return true
  const output = entry?.modalities?.output
  if (Array.isArray(output) && output.length > 0 && !output.includes('text')) return true
  return false
}

/** Peel one decoration layer off a channel-registered name. */
function stripDecoration(name: string): string {
  if (/@[^@]+$/.test(name)) return name.replace(/@[^@]+$/, '')
  if (/^[^/]+\//.test(name)) return name.replace(/^[^/]+\//, '')
  if (/-maas$/.test(name)) return name.replace(/-maas$/, '')
  return name
}

/** Strip repeatedly until stable (bounded — decorations do not nest deeply). */
function stripAllDecorations(name: string): string {
  let current = name
  for (let i = 0; i < 4; i += 1) {
    const next = stripDecoration(current)
    if (next === current) break
    current = next
  }
  return current
}

export function buildPresetEntries(
  doc: ModelsDevDocument,
  options: { now?: number, openrouterNames?: readonly string[] } = {},
): PresetBuildResult {
  // name → merged suggestion / raw modalities, across ALL providers of the
  // document. Suggestions and modalities describe the model itself, so any
  // provider's entry contributes. RELEASE DATES are treated differently:
  // aggregator entries carry garbage dates (`1970-01-01`, guessed months),
  // so a whitelist name's date comes from the first-party providers only
  // (the author is authoritative); all-provider dates back only the
  // OpenRouter names, which by construction have no first-party entry.
  const mergedByName = new Map<string, ReturnType<typeof mergeSuggestions>>()
  const modalitiesByName = new Map<string, { input?: string[], output?: string[] }>()
  for (const models of Object.values(doc)) {
    if (!models?.models) continue
    for (const [name, entry] of Object.entries(models.models)) {
      const mapped = mapModelsDevEntry(entry)
      if (mapped) {
        const previous = mergedByName.get(name)
        mergedByName.set(name, previous ? mergeSuggestions([previous, mapped]) : mapped)
      }
      const rawModalities = modalitiesByName.get(name) ?? {}
      if (Array.isArray(entry.modalities?.input) && entry.modalities.input.length) {
        rawModalities.input = [...new Set([...(rawModalities.input ?? []), ...entry.modalities.input])]
      }
      if (Array.isArray(entry.modalities?.output) && entry.modalities.output.length) {
        rawModalities.output = [...new Set([...(rawModalities.output ?? []), ...entry.modalities.output])]
      }
      modalitiesByName.set(name, rawModalities)
    }
  }
  const releasedAtAny = new Map<string, number | null>()
  for (const models of Object.values(doc)) {
    if (!models?.models) continue
    for (const [name, entry] of Object.entries(models.models)) {
      const date = Date.parse(String(entry.release_date ?? ''))
      const previousDate = releasedAtAny.get(name)
      releasedAtAny.set(name, Number.isFinite(date) && (!(previousDate ?? 0) || (previousDate ?? 0) < date) ? date : previousDate ?? null)
    }
  }
  const releasedAtFirstParty = new Map<string, number | null>()
  for (const provider of PRESET_PROVIDERS) {
    const models = doc[provider]?.models
    if (!models) continue
    for (const [name, entry] of Object.entries(models)) {
      const date = Date.parse(String(entry.release_date ?? ''))
      const previousDate = releasedAtFirstParty.get(name)
      releasedAtFirstParty.set(name, Number.isFinite(date) && (!(previousDate ?? 0) || (previousDate ?? 0) < date) ? date : previousDate ?? null)
    }
  }

  // A3 — channel dedup over the whitelist names: decorated names drop when
  // their stripped form already exists, else rekey to the bare name.
  const whitelistNames: string[] = []
  for (const provider of PRESET_PROVIDERS) {
    const models = doc[provider]?.models
    if (!models) continue
    whitelistNames.push(...Object.keys(models))
  }
  const bare = new Set(whitelistNames.filter((name) => stripAllDecorations(name) === name))
  const finalNameOf = new Map<string, string>()
  // Rekey targets claimed so far — a Set, not a values() linear scan (the
  // whitelist runs a few hundred names; this keeps dedup O(n) for its own sake).
  const strippedUsed = new Set<string>()
  const channelDropped: string[] = []
  const rekeyed: Array<{ from: string, to: string }> = []
  for (const name of whitelistNames) {
    const stripped = stripAllDecorations(name)
    if (stripped === name) {
      finalNameOf.set(name, name)
      continue
    }
    if (bare.has(stripped) || strippedUsed.has(stripped)) {
      channelDropped.push(name)
      continue
    }
    finalNameOf.set(name, stripped)
    strippedUsed.add(stripped)
    rekeyed.push({ from: name, to: stripped })
  }

  // Collapse the per-original-name maps onto the final (deduped) names —
  // a rekeyed name carries its original's suggestion, modalities, and date.
  const finalSuggestion = new Map<string, ReturnType<typeof mergeSuggestions>>()
  const finalModalities = new Map<string, { input?: string[], output?: string[] }>()
  const finalDate = new Map<string, number | null>()
  const absorb = (finalName: string, original: string): void => {
    const suggestion = mergedByName.get(original)
    if (suggestion) {
      const previous = finalSuggestion.get(finalName)
      finalSuggestion.set(finalName, previous ? mergeSuggestions([previous, suggestion]) : suggestion)
    }
    const rawModalities = modalitiesByName.get(original)
    if (rawModalities) {
      const target = finalModalities.get(finalName) ?? {}
      if (rawModalities.input) target.input = [...new Set([...(target.input ?? []), ...rawModalities.input])]
      if (rawModalities.output) target.output = [...new Set([...(target.output ?? []), ...rawModalities.output])]
      finalModalities.set(finalName, target)
    }
    const date = releasedAtFirstParty.get(original) ?? null
    const previousDate = finalDate.get(finalName)
    if (previousDate === undefined || (date !== null && (previousDate === null || previousDate < date))) {
      finalDate.set(finalName, date)
    }
  }
  for (const name of whitelistNames) {
    const finalName = finalNameOf.get(name)
    if (finalName === undefined) continue
    absorb(finalName, name)
  }

  const now = options.now ?? Date.now()
  const cutoff = now - PRESET_MAX_AGE_DAYS * 86_400_000

  const openrouterNames: string[] = []
  for (const name of options.openrouterNames ?? []) {
    if (typeof name !== 'string' || !name.trim()) continue
    // the backstop never invents names: a slug that maps to nothing in the
    // document has no data, no date, and no business in the preset
    if (!finalDate.has(name) && (releasedAtAny.has(name) || mergedByName.has(name))) {
      finalDate.set(name, releasedAtAny.get(name) ?? null)
      const suggestion = mergedByName.get(name)
      if (suggestion) finalSuggestion.set(name, suggestion)
      const rawModalities = modalitiesByName.get(name)
      if (rawModalities) finalModalities.set(name, rawModalities)
      openrouterNames.push(name)
    }
  }

  // Window + non-dialogue filters over the final candidate set.
  const wanted = [...finalDate.keys()]
  const nonDialogueNames: string[] = []
  const admitted: string[] = []
  let agedOut = 0
  for (const name of wanted) {
    const date = finalDate.get(name) ?? null
    if (date === null || date < cutoff) {
      agedOut += 1
      continue
    }
    if (isNonDialogueModel(name, { modalities: finalModalities.get(name) })) {
      nonDialogueNames.push(name)
      continue
    }
    admitted.push(name)
  }

  const entries: Record<string, PresetEntry> = {}
  for (const name of admitted.sort()) {
    const suggestion = finalSuggestion.get(name)
    if (!suggestion) continue
    const entry: PresetEntry = {}
    if (suggestion.input.length) entry.input = [...suggestion.input]
    if (suggestion.reasoning === false) entry.reasoning = false
    else if (suggestion.reasoning && suggestion.reasoning.levels.length) entry.reasoning = [...suggestion.reasoning.levels]
    if (suggestion.contextWindow !== undefined) entry.contextWindow = suggestion.contextWindow
    if (suggestion.maxTokens !== undefined) entry.maxTokens = suggestion.maxTokens
    if (Object.keys(entry).length > 0) entries[name] = entry
  }
  return {
    entries,
    agedOut,
    nonDialogue: nonDialogueNames.length,
    channelDropped: channelDropped.sort(),
    rekeyed,
    openrouterNames: openrouterNames.sort(),
  }
}

/**
 * Map OpenRouter ranking slugs onto models.dev canonical names (exact or
 * case-fold; slugs like `deepseek/deepseek-chat` reduce to their last path
 * segment first). Unknown slugs are dropped — the backstop never invents
 * names the document does not describe.
 */
export function openrouterCanonicalNames(slugs: readonly string[], doc: ModelsDevDocument): string[] {
  const names = new Set<string>()
  for (const models of Object.values(doc)) {
    if (!models?.models) continue
    for (const name of Object.keys(models.models)) names.add(name)
  }
  const folded = new Map<string, string>()
  for (const name of names) folded.set(name.toLowerCase(), name)
  const out = new Set<string>()
  for (const slug of slugs) {
    const last = String(slug).trim().split('/').pop() ?? ''
    if (!last) continue
    if (names.has(last)) out.add(last)
    else if (folded.has(last.toLowerCase())) out.add(folded.get(last.toLowerCase())!)
  }
  return [...out].sort()
}
