/**
 * Capability suggestions from https://models.dev/api.json — the initial
 * values behind the capability Tab's ↻ button.
 *
 * Mapping (verified against the live feed): `modalities.input` intersects the
 * two modalities pi-ai understands; `reasoning: false` suggests an explicit
 * non-reasoning model; `reasoning_options` entries of type `effort` map their
 * values onto pi-ai's effort levels, and any other reasoning shape (toggle,
 * budget_tokens) means "reasons, but offers no effort ladder" — suggested as
 * reasoning ON with the middle effort level, which the user can adjust.
 * A model id may appear under several providers; suggestions merge (modalities
 * union; the most specific reasoning shape wins; largest known context window
 * wins). `limit.context` feeds the knowledge base's default context window.
 */

import { EFFORT_LEVELS, MODALITIES } from './constants.js'
import { requestJson } from './http.js'

/** Capability values a capability card holds. `null` reasoning = no data. */
export interface CapabilitySuggestion {
  input: string[]
  reasoning: false | { levels: string[] } | null
  /** Default context window in tokens (models.dev `limit.context`), when known. */
  contextWindow?: number
}

interface ModelsDevEntry {
  modalities?: { input?: string[] }
  reasoning?: boolean
  reasoning_options?: Array<{ type?: string, values?: string[] } & Record<string, unknown>>
  limit?: { context?: number, output?: number }
}

type ModelsDevDoc = Record<string, { models?: Record<string, ModelsDevEntry> }>

/** Pick the effort levels a reasoning_options list offers, in pi-ai's order. */
function effortLevels(options: Array<{ type?: string, values?: string[] }> | undefined): string[] | null {
  if (!Array.isArray(options)) return null
  const effort = options.find((option) => option.type === 'effort')
  if (effort?.values?.length) {
    const known = EFFORT_LEVELS.filter((level) => effort.values!.includes(level))
    return known.length ? known : null
  }
  // Any other reasoning option shape (toggle, budget_tokens, ...) reasons
  // without an effort ladder; suggest the middle level as a starting point.
  return options.length ? ['medium'] : null
}

/** Map one models.dev entry onto a capability suggestion; null = nothing usable. */
export function mapModelsDevEntry(entry: ModelsDevEntry | undefined): CapabilitySuggestion | null {
  if (!entry || typeof entry !== 'object') return null
  const input = MODALITIES.filter((modality) => entry.modalities?.input?.includes(modality))
  let reasoning: CapabilitySuggestion['reasoning']
  if (entry.reasoning === false) {
    reasoning = false
  } else if (entry.reasoning === true) {
    const levels = effortLevels(entry.reasoning_options)
    reasoning = levels ? { levels } : null
  } else {
    reasoning = null
  }
  const context = Number(entry.limit?.context)
  const contextWindow = Number.isFinite(context) && context > 0 ? context : undefined
  if (!input.length && reasoning === null && contextWindow === undefined) return null
  return { input, reasoning, ...(contextWindow !== undefined ? { contextWindow } : {}) }
}

/** Merge suggestions for the same model id seen under several providers. */
export function mergeSuggestions(suggestions: readonly (CapabilitySuggestion | null)[]): CapabilitySuggestion | null {
  const usable = suggestions.filter((s): s is CapabilitySuggestion => s !== null)
  if (!usable.length) return null
  const input = [...new Set(usable.flatMap((s) => s.input))]
  const orderedInput = MODALITIES.filter((modality) => input.includes(modality))
  let reasoning: CapabilitySuggestion['reasoning'] = null
  for (const candidate of usable) {
    if (candidate.reasoning === null) continue
    if (candidate.reasoning === false) {
      if (reasoning === null) reasoning = false
      continue
    }
    // A concrete effort ladder outranks both "no data" and plain toggle-on.
    reasoning = candidate.reasoning
    break
  }
  const windows = usable.map((s) => s.contextWindow).filter((w): w is number => typeof w === 'number')
  const contextWindow = windows.length ? Math.max(...windows) : undefined
  if (!orderedInput.length && reasoning === null && contextWindow === undefined) return null
  return {
    input: orderedInput,
    reasoning,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  }
}

export interface ModelsDevOptions {
  url?: string
  proxy?: string | null
  timeoutMs?: number
  /** Test seam: fetch the raw document. Defaults to requestJson over http.ts. */
  fetchDoc?: () => Promise<unknown>
  /** Cache lifetime in milliseconds (default 24h). */
  ttlMs?: number
  now?: () => number
}

/**
 * models.dev lookup with a process-wide cache and single-flight fetch, so a
 * burst of ↻ clicks produces at most one outbound request per TTL window.
 */
export class ModelsDevClient {
  private readonly options: Required<Pick<ModelsDevOptions, 'url' | 'proxy' | 'timeoutMs' | 'ttlMs'>> & ModelsDevOptions
  private document: ModelsDevDoc | null = null
  private fetchedAt = 0
  private inflight: Promise<ModelsDevDoc | null> | null = null

  constructor(options: ModelsDevOptions = {}) {
    this.options = { url: 'https://models.dev/api.json', proxy: null, timeoutMs: 20000, ttlMs: 24 * 60 * 60 * 1000, ...options }
  }

  private async load(): Promise<ModelsDevDoc | null> {
    const now = this.options.now ?? Date.now
    if (this.document && now() - this.fetchedAt < this.options.ttlMs) return this.document
    if (!this.inflight) {
      this.inflight = (async () => {
        try {
          const json = this.options.fetchDoc
            ? await this.options.fetchDoc()
            : await requestJson({ url: this.options.url, headers: { accept: 'application/json' }, proxy: this.options.proxy, timeoutMs: this.options.timeoutMs })
          this.document = (json && typeof json === 'object') ? json as ModelsDevDoc : null
          this.fetchedAt = now()
          return this.document
        } catch {
          // Keep the previous document (if any) cached; the UI falls back to
          // manual configuration when no data is available.
          this.fetchedAt = now()
          return this.document
        } finally {
          this.inflight = null
        }
      })()
    }
    return await this.inflight
  }

  /**
   * Suggest capabilities for one model id. Resolves `{ miss: true }` when the
   * feed has nothing usable (including fetch failure) — never throws, so the
   * ↻ button cannot block on the network.
   */
  async suggest(modelId: string): Promise<CapabilitySuggestion | { miss: true }> {
    const doc = await this.load()
    if (!doc) return { miss: true }
    const providers = Object.keys(doc).sort()
    const found: (CapabilitySuggestion | null)[] = []
    for (const provider of providers) {
      const entry = doc[provider]?.models?.[modelId]
      if (entry) found.push(mapModelsDevEntry(entry))
    }
    const merged = mergeSuggestions(found)
    return merged ?? { miss: true }
  }
}
