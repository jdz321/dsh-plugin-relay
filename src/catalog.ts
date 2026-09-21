/**
 * Model catalog shaping for a pi-ai provider route. Model identity is the id
 * alone: a synced entry carries `name: <id>` because the pi-ai schema renders
 * a model without one as its id anyway, and heuristic capacities fill the
 * fields the panel does not report.
 *
 * Route catalog writes REPLACE the `models` array wholesale (settings update
 * semantics), so every writer must go through mergeCatalog(): it keeps each
 * surviving id's stored fields — capability config (input/reasoningEfforts),
 * capacity edits made on the official Models page, manual entries — and only
 * adds ids the key gained and drops ids it lost.
 */

import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from './constants.js'
import type { RouteModelEntry } from './types.js'

export interface CapacityDefaults {
  contextWindow: number
  maxTokens: number
}

interface CapacityRule {
  re: RegExp
  contextWindow: number
  maxTokens: number
}

const CAPACITY_RULES: CapacityRule[] = [
  { re: /^deepseek-chat/, contextWindow: 131072, maxTokens: 8192 },
  { re: /^deepseek-reasoner/, contextWindow: 131072, maxTokens: 65536 },
  { re: /^deepseek/, contextWindow: 131072, maxTokens: 8192 },
  { re: /^claude/, contextWindow: 200000, maxTokens: 32000 },
  { re: /^gemini-2\./, contextWindow: 1048576, maxTokens: 65536 },
  { re: /^gemini/, contextWindow: 1000000, maxTokens: 8192 },
  { re: /^(gpt-5|gpt-4\.1|gpt-4o|chatgpt-4o)/, contextWindow: 128000, maxTokens: 16384 },
  { re: /^gpt-4-turbo/, contextWindow: 128000, maxTokens: 4096 },
  { re: /^gpt-4/, contextWindow: 8192, maxTokens: 4096 },
  { re: /^o[134]-/, contextWindow: 200000, maxTokens: 100000 },
  { re: /^(kimi|moonshot)/, contextWindow: 131072, maxTokens: 16384 },
  { re: /^(qwen|qwen3)/, contextWindow: 131072, maxTokens: 16384 },
  { re: /^glm/, contextWindow: 131072, maxTokens: 16384 },
]

/** Shape one catalog entry for a model id (capacity heuristics, name = id). */
export function modelEntry(id: string, defaults: CapacityDefaults = { contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS }): RouteModelEntry {
  const rule = CAPACITY_RULES.find((r) => r.re.test(id))
  const entry: RouteModelEntry = {
    id,
    name: id,
    contextWindow: rule?.contextWindow ?? defaults.contextWindow,
  }
  const maxTokens = rule?.maxTokens ?? defaults.maxTokens
  if (maxTokens) entry.maxTokens = maxTokens
  if (/^deepseek/.test(id)) entry.compat = { thinkingFormat: 'deepseek' }
  return entry
}

/**
 * Build the sorted entry list for a set of model ids.
 * @param preferred ids to surface first (stable sort).
 */
export function buildCatalog(ids: readonly string[], defaults?: CapacityDefaults, preferred: readonly string[] = []): RouteModelEntry[] {
  const unique = [...new Set(ids.map(String).filter(Boolean))]
  const rank = (id: string) => {
    const idx = preferred.indexOf(id)
    return idx === -1 ? preferred.length : idx
  }
  const sorted = unique.sort((a, b) => {
    const d = rank(a) - rank(b)
    return d !== 0 ? d : a.localeCompare(b)
  })
  return sorted.map((id) => modelEntry(id, defaults))
}

/** True when a value carries no information (absent, empty array, or an object whose every value is empty). */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.values(value).every(isEmptyValue)
  return false
}

/**
 * Strip materialized no-value fields from a stored-or-resolved entry:
 * `input: []` and compat members that carry no information (absent means the
 * same to pi-ai) only add noise to settings.yaml.
 */
export function cleanModelEntry(entry: RouteModelEntry): RouteModelEntry {
  const cleaned: RouteModelEntry = { ...entry }
  if (Array.isArray(cleaned.input) && cleaned.input.length === 0) delete cleaned.input
  if (cleaned.compat !== undefined) {
    if (typeof cleaned.compat !== 'object') {
      delete cleaned.compat
    } else {
      const pruned: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(cleaned.compat)) {
        if (!isEmptyValue(value)) pruned[field] = value
      }
      if (Object.keys(pruned).length === 0) delete cleaned.compat
      else cleaned.compat = pruned
    }
  }
  return cleaned
}

/**
 * Merge the ids a key can currently call with the route's stored entries.
 * Surviving ids keep their stored entry verbatim (capability config, manual
 * capacity edits, hand-tuned names); new ids get fresh heuristic entries; ids the
 * key lost are dropped — the route's models list must stay the key's callable
 * set, that is what makes dsh offer exactly the workable models.
 *
 * Order: fresh-catalog order (preferred ids first, then alphabetical), which
 * keeps the array stable across syncs.
 */
export function mergeCatalog(
  ids: readonly string[],
  storedModels: readonly RouteModelEntry[] | undefined,
  defaults?: CapacityDefaults,
  preferred: readonly string[] = [],
): RouteModelEntry[] {
  const storedById = new Map((storedModels ?? []).map((entry) => [String(entry.id), entry]))
  return buildCatalog(ids, defaults, preferred).map((fresh) => {
    const stored = storedById.get(fresh.id)
    if (!stored) return fresh
    return { ...fresh, ...cleanModelEntry(stored) }
  })
}
