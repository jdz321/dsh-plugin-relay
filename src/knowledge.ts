/**
 * The model-capability knowledge base and the per-panel-id overrides, both
 * persisted in the plugin's `relay` settings namespace (hot-reloaded, and —
 * unlike route entries — never touched by key switches).
 *
 * The capability fields on `llm-pi-ai` route model entries are DERIVED state:
 * every catalog sync and capability save replays these rules over the route
 * catalog (one revision-guarded write):
 *
 *   1. `capabilityOverrides[panelId]` exists  → apply its defined fields;
 *   2. else the knowledge base matches (matchCatalogName) → apply its fields;
 *   3. else the entry's capability fields are NOT touched (official Models
 *      page edits and manual capacity tweaks survive).
 *
 * Only fields the plugin holds a configuration for are ever written — an
 * override/catalog entry that leaves a field undefined leaves the route field
 * alone, so partial configs compose with manual edits.
 */

import { EFFORT_LEVELS, MODALITIES } from './constants.js'
import type { RouteModelEntry } from './types.js'

/** One knowledge-base entry, keyed by canonical (models.dev-style) model name. */
export interface CatalogEntry {
  input?: string[]
  reasoning?: false | string[]
  contextWindow?: number
}

/** One per-panel-id override, keyed by the exact panel model id. */
export type OverrideEntry = CatalogEntry

/** Both plugin-owned capability structures as stored in the namespace. */
export interface KnowledgeConfig {
  capabilityCatalog: Record<string, CatalogEntry>
  capabilityOverrides: Record<string, OverrideEntry>
}

export type CapabilitySource = 'override' | 'catalog' | 'catalog-approximate' | null

/** The capability fields one panel model resolves to, with their origin. */
export interface DerivedCapability {
  input?: string[]
  reasoning?: false | string[]
  contextWindow?: number
  source: CapabilitySource
  /** Knowledge-base name that matched (catalog sources only). */
  catalogName?: string
}

const CONTEXT_WINDOW_MAX = 10_000_000

/** True when a modalities array carries no information (absent/empty after read-back). */
function isEmptyArray(value: readonly string[] | undefined): boolean {
  return !Array.isArray(value) || value.length === 0
}

function defined(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * Normalize one raw (possibly schema-round-tripped) entry: empty input arrays
 * collapse to undefined, reasoning keeps `false` or a non-empty level list,
 * contextWindow must be a positive finite number. Returns undefined when the
 * entry holds no configuration at all.
 */
export function normalizeCapabilityEntry(raw: unknown): CatalogEntry | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const entry: CatalogEntry = {}
  if (Array.isArray(record.input) && record.input.length) {
    entry.input = [...new Set(record.input.map(String).filter((m) => (MODALITIES as readonly string[]).includes(m)))]
    if (!entry.input.length) delete entry.input
  }
  if (record.reasoning === false) entry.reasoning = false
  else if (Array.isArray(record.reasoning) && record.reasoning.length) {
    entry.reasoning = record.reasoning.map(String)
  }
  if (record.contextWindow !== undefined && record.contextWindow !== null && record.contextWindow !== '') {
    const n = Number(record.contextWindow)
    if (Number.isFinite(n)) entry.contextWindow = n
  }
  return defined(entry.input) || defined(entry.reasoning) || defined(entry.contextWindow) ? entry : undefined
}

/** Normalize both namespace dicts, dropping empty entries and bad names. */
export function normalizeKnowledgeConfig(raw: unknown): KnowledgeConfig {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {}
  const readDict = (value: unknown): Record<string, CatalogEntry> => {
    const out: Record<string, CatalogEntry> = {}
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
    for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
      const key = name.trim()
      if (!key) continue
      const normalized = normalizeCapabilityEntry(entry)
      if (normalized) out[key] = normalized
    }
    return out
  }
  return {
    capabilityCatalog: readDict(source.capabilityCatalog),
    capabilityOverrides: readDict(source.capabilityOverrides),
  }
}

/** User-facing validation applied at the save boundary (host-side, before any write). */
export function validateCapabilityEntry(entry: CatalogEntry, label: string): void {
  if (entry.input !== undefined && isEmptyArray(entry.input)) {
    throw new Error(`${label}: 输入模态不能为空（可整体删除该配置）`)
  }
  if (Array.isArray(entry.input)) {
    for (const modality of entry.input) {
      if (!(MODALITIES as readonly string[]).includes(modality)) {
        throw new Error(`${label}: 未知输入模态「${modality}」`)
      }
    }
  }
  if (Array.isArray(entry.reasoning)) {
    if (!entry.reasoning.length) throw new Error(`${label}: 推理档位不能为空（非推理请选「关闭」）`)
    for (const level of entry.reasoning) {
      if (!(EFFORT_LEVELS as readonly string[]).includes(level)) {
        throw new Error(`${label}: 未知推理档位「${level}」`)
      }
    }
  }
  if (entry.contextWindow !== undefined) {
    if (!Number.isInteger(entry.contextWindow) || entry.contextWindow <= 0 || entry.contextWindow > CONTEXT_WINDOW_MAX) {
      throw new Error(`${label}: 上下文窗口须为正整数（tokens）`)
    }
  }
  if (entry.input === undefined && entry.reasoning === undefined && entry.contextWindow === undefined) {
    throw new Error(`${label}: 至少配置一项能力字段`)
  }
}

/**
 * Knowledge-base matching: exact id first, then strip up to two trailing
 * `-variant` segments and retry exact. `approximate` marks every stripped
 * hit. No fuzzy/case-insensitive fallback — measured zero-gain with real
 * mis-match risk (SPEC-0.5.0 §2.5).
 */
export function matchCatalogName(panelId: string, catalogNames: readonly string[]): { name: string, approximate: number } | null {
  if (catalogNames.includes(panelId)) return { name: panelId, approximate: 0 }
  const segments = panelId.split('-')
  for (let strip = 1; strip <= 2 && segments.length > strip; strip += 1) {
    const candidate = segments.slice(0, segments.length - strip).join('-')
    if (catalogNames.includes(candidate)) return { name: candidate, approximate: strip }
  }
  return null
}

/**
 * Resolve the effective capability config for one panel model id: override,
 * else knowledge base (exact or stripped-suffix match), else nothing.
 */
export function deriveCapabilityFor(panelId: string, knowledge: KnowledgeConfig): DerivedCapability {
  const override = knowledge.capabilityOverrides[panelId]
  if (override) {
    return {
      ...(override.input !== undefined ? { input: [...override.input] } : {}),
      ...(override.reasoning !== undefined ? { reasoning: override.reasoning } : {}),
      ...(override.contextWindow !== undefined ? { contextWindow: override.contextWindow } : {}),
      source: 'override',
    }
  }
  const match = matchCatalogName(panelId, Object.keys(knowledge.capabilityCatalog))
  if (match) {
    const entry = knowledge.capabilityCatalog[match.name]!
    return {
      ...(entry.input !== undefined ? { input: [...entry.input] } : {}),
      ...(entry.reasoning !== undefined ? { reasoning: entry.reasoning } : {}),
      ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
      source: match.approximate > 0 ? 'catalog-approximate' : 'catalog',
      catalogName: match.name,
    }
  }
  return { source: null }
}

/**
 * Replay the derivation rules over a route models array. Entries without any
 * plugin configuration pass through verbatim; configured fields overwrite
 * `input` / `reasoningEfforts` / `contextWindow` and leave every other field
 * (maxTokens, compat, name, …) untouched. Pure.
 */
export function applyDerivedCapabilities(models: readonly RouteModelEntry[], knowledge: KnowledgeConfig): RouteModelEntry[] {
  return models.map((entry) => {
    const derived = deriveCapabilityFor(String(entry.id), knowledge)
    if (derived.source === null) return entry
    const next: RouteModelEntry = { ...entry }
    if (derived.input !== undefined) next.input = [...derived.input]
    if (derived.reasoning !== undefined) {
      next.reasoningEfforts = derived.reasoning === false
        ? false
        : Object.fromEntries([['off', null], ...derived.reasoning.map((level) => [level, level])])
    }
    if (derived.contextWindow !== undefined) next.contextWindow = derived.contextWindow
    return next
  })
}
