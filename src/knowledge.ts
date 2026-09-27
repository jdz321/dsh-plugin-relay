/**
 * The model-capability knowledge base and the per-panel per-id overrides,
 * both persisted in the plugin's `relay` settings namespace (hot-reloaded,
 * and — unlike route entries — never touched by key switches).
 *
 * The capability fields on `llm-pi-ai` route model entries are DERIVED state:
 * every catalog sync and capability save replays these rules over the route
 * catalog (one revision-guarded write):
 *
 *   1. `capabilityOverrides[panelId][id]` exists → apply its defined fields;
 *   2. else the knowledge base matches (matchCatalogName) → apply its fields;
 *   3. else the entry's capability fields are NOT touched (official Models
 *      page edits and manual capacity tweaks survive).
 *
 * Only fields the plugin holds a configuration for are ever written — an
 * override/catalog entry that leaves a field undefined leaves the route field
 * alone, so partial configs compose with manual edits (and clearing a field
 * falls back to the route heuristic, contextWindow and maxTokens alike).
 */

import { EFFORT_LEVELS, MAX_TOKENS_MAX, MODALITIES } from './constants.js'
import type { RouteModelEntry } from './types.js'

/** One knowledge-base entry, keyed by canonical (models.dev-style) model name. */
export interface CatalogEntry {
  input?: string[]
  reasoning?: false | string[]
  contextWindow?: number
  maxTokens?: number
}

/** One per-panel-id override, keyed by the exact panel model id. */
export type OverrideEntry = CatalogEntry

/**
 * The capability structures as STORED in the namespace: overrides are grouped
 * per panel (each panel has its own model ids), while the knowledge base and
 * the preset layer stay global — they match by canonical model name,
 * regardless of panel. Presets never persist to settings and have no delete
 * semantics: a same-named user entry overrides one, which is the only way to
 * suppress a bad preset.
 */
export interface KnowledgeConfig {
  capabilityCatalog: Record<string, CatalogEntry>
  capabilityOverrides: Record<string, Record<string, OverrideEntry>>
  capabilityPreset?: Record<string, CatalogEntry>
}

/**
 * The flat capability sources ONE panel derives from: the global catalog and
 * preset layers plus only that panel's override group. Every derivation
 * (deriveCapabilityFor / applyDerivedCapabilities) consumes this view.
 */
export interface KnowledgeView {
  capabilityCatalog: Record<string, CatalogEntry>
  capabilityOverrides: Record<string, OverrideEntry>
  capabilityPreset?: Record<string, CatalogEntry>
}

/** The knowledge view one panel derives from: globals + its override group. */
export function knowledgeForPanel(knowledge: KnowledgeConfig, panelId: string): KnowledgeView {
  return {
    capabilityCatalog: knowledge.capabilityCatalog,
    capabilityOverrides: knowledge.capabilityOverrides[panelId] ?? {},
    capabilityPreset: knowledge.capabilityPreset,
  }
}

export type CapabilitySource = 'override' | 'catalog' | 'catalog-approximate' | 'preset' | 'preset-approximate' | null

/** The capability fields one panel model resolves to, with their origin. */
export interface DerivedCapability {
  input?: string[]
  reasoning?: false | string[]
  contextWindow?: number
  maxTokens?: number
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
 * contextWindow/maxTokens must be positive finite numbers. Returns undefined
 * when the entry holds no configuration at all.
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
  if (record.maxTokens !== undefined && record.maxTokens !== null && record.maxTokens !== '') {
    const n = Number(record.maxTokens)
    if (Number.isFinite(n)) entry.maxTokens = n
  }
  return defined(entry.input) || defined(entry.reasoning) || defined(entry.contextWindow) || defined(entry.maxTokens)
    ? entry
    : undefined
}

/** Normalize the namespace dicts, dropping empty entries and bad names. */
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
  const overrides: Record<string, Record<string, CatalogEntry>> = {}
  const rawOverrides = source.capabilityOverrides
  if (rawOverrides !== null && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)) {
    for (const [panelId, group] of Object.entries(rawOverrides as Record<string, unknown>)) {
      const key = panelId.trim()
      if (!key) continue
      const entries = readDict(group)
      if (Object.keys(entries).length) overrides[key] = entries
    }
  }
  return {
    capabilityCatalog: readDict(source.capabilityCatalog),
    capabilityOverrides: overrides,
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
  if (entry.maxTokens !== undefined) {
    if (!Number.isInteger(entry.maxTokens) || entry.maxTokens <= 0 || entry.maxTokens > MAX_TOKENS_MAX) {
      throw new Error(`${label}: 输出上限须为正整数（tokens，≤ ${MAX_TOKENS_MAX}）`)
    }
  }
  if (entry.input === undefined && entry.reasoning === undefined && entry.contextWindow === undefined && entry.maxTokens === undefined) {
    throw new Error(`${label}: 至少配置一项能力字段`)
  }
}

/**
 * Curated alias table for panel ids that models.dev names differently with
 * no mechanical rule (SPEC-0.6.0 §3.1-D). Every entry is hand-verified to be
 * unambiguous; an alias hit is always approximate.
 */
export const PRESET_ALIASES: Record<string, string> = {
  k3: 'kimi-k3',
}

/** Version-separator forms of one id: `x-5.1` ↔ `x-5-1` (both directions). */
function versionSeparatorForms(id: string): string[] {
  const forms: string[] = []
  const dotToDash = id.replace(/(\d)\.(\d)/g, '$1-$2')
  const dashToDot = id.replace(/(\d)-(\d)/g, '$1.$2')
  if (dotToDash !== id) forms.push(dotToDash)
  if (dashToDot !== id) forms.push(dashToDot)
  return forms
}

/** Variant tokens L4 may complete a panel id with (fixed set, per spec). */
const VARIANT_TOKENS = ['preview', 'latest', 'exp'] as const

/**
 * Knowledge-base matching, hierarchy L0-L5 (SPEC-0.6.0 §3.3) — every level
 * demands equality (plus uniqueness where folding is involved); no fuzzy or
 * substring matching. `approximate` reports the level: 0 = exact, 1-5 = the
 * matching level (always rendered as an approximate hit downstream).
 *
 *  - L0 exact id;
 *  - L1 case-folded exact (aborts entirely when several names fold alike);
 *  - L2 strip 1-2 trailing `-variant` segments (verbatim, then folded);
 *  - L3 version-separator swap (`5.1`↔`5-1`), then L0/L1 on the form;
 *  - L4 unique variant completion (`<id>[-strip]` + exactly one of
 *    preview/latest/exp names exactly one canonical entry);
 *  - L5 curated alias table.
 *
 * Mis-match surface (SPEC-0.6.0 §3.3, verified against the live panel): the
 * 19 case-form pairs in models.dev are same-model spellings; L3's bidirectional
 * swap self-aborts when both forms are cataloged (the other level matches
 * first or candidates collide); L4's fixed token set + uniqueness constraint
 * stops multi-candidate completions (e.g. `gemini-3-pro-image-preview`).
 */
export function matchCatalogName(panelId: string, catalogNames: readonly string[]): { name: string, approximate: number } | null {
  const id = String(panelId).trim()
  if (!id) return null
  if (catalogNames.includes(id)) return { name: id, approximate: 0 }

  // L1 — case-folded exact, unique candidate only.
  const folded = id.toLowerCase()
  const foldedHits = catalogNames.filter((name) => name.toLowerCase() === folded)
  if (foldedHits.length === 1) return { name: foldedHits[0]!, approximate: 1 }
  if (foldedHits.length > 1) return null

  const segments = id.split('-')
  const stripped = (levels: number): string | null =>
    segments.length > levels ? segments.slice(0, segments.length - levels).join('-') : null

  // L2 — strip up to two trailing `-variant` segments (verbatim, then folded).
  for (let levels = 1; levels <= 2; levels += 1) {
    const candidate = stripped(levels)
    if (candidate === null) break
    if (catalogNames.includes(candidate)) return { name: candidate, approximate: 2 }
    const foldedCandidate = catalogNames.filter((name) => name.toLowerCase() === candidate.toLowerCase())
    if (foldedCandidate.length === 1) return { name: foldedCandidate[0]!, approximate: 2 }
  }

  // L3 — version-separator swap, then exact / folded-unique on the form.
  for (const form of versionSeparatorForms(id)) {
    if (catalogNames.includes(form)) return { name: form, approximate: 3 }
    const foldedForm = catalogNames.filter((name) => name.toLowerCase() === form.toLowerCase())
    if (foldedForm.length === 1) return { name: foldedForm[0]!, approximate: 3 }
  }

  // L4 — unique variant completion over the id and its stripped forms.
  const bases = [id, stripped(1), stripped(2)].filter((base): base is string => base !== null)
  const completions = new Set<string>()
  for (const base of bases) {
    for (const variant of VARIANT_TOKENS) {
      const candidate = `${base}-${variant}`
      if (catalogNames.includes(candidate)) completions.add(candidate)
    }
  }
  if (completions.size === 1) return { name: [...completions][0]!, approximate: 4 }

  // L5 — curated aliases.
  const aliasTarget = PRESET_ALIASES[id]
  if (aliasTarget !== undefined && catalogNames.includes(aliasTarget)) {
    return { name: aliasTarget, approximate: 5 }
  }
  return null
}

/**
 * Resolve the effective capability config for one panel model id: the
 * panel's override, else a knowledge-base match (user entries first, then the
 * preset layer) over the union of both name sets — any L0-L5 match, user
 * entry winning when both layers carry the matched name.
 */
export function deriveCapabilityFor(panelId: string, knowledge: KnowledgeView): DerivedCapability {
  const override = knowledge.capabilityOverrides[panelId]
  if (override) {
    return {
      ...(override.input !== undefined ? { input: [...override.input] } : {}),
      ...(override.reasoning !== undefined ? { reasoning: override.reasoning } : {}),
      ...(override.contextWindow !== undefined ? { contextWindow: override.contextWindow } : {}),
      ...(override.maxTokens !== undefined ? { maxTokens: override.maxTokens } : {}),
      source: 'override',
    }
  }
  const preset = knowledge.capabilityPreset ?? {}
  const names = [...Object.keys(knowledge.capabilityCatalog), ...Object.keys(preset)]
  const match = matchCatalogName(panelId, names)
  if (match) {
    const userEntry = knowledge.capabilityCatalog[match.name]
    const entry = userEntry ?? preset[match.name]!
    const fromPreset = userEntry === undefined
    const approximate = match.approximate > 0
    return {
      ...(entry.input !== undefined ? { input: [...entry.input] } : {}),
      ...(entry.reasoning !== undefined ? { reasoning: entry.reasoning } : {}),
      ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
      ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
      source: fromPreset
        ? (approximate ? 'preset-approximate' : 'preset')
        : (approximate ? 'catalog-approximate' : 'catalog'),
      catalogName: match.name,
    }
  }
  return { source: null }
}

/**
 * Replay the derivation rules over a route models array. Entries without any
 * plugin configuration pass through verbatim; configured fields overwrite
 * `input` / `reasoningEfforts` / `contextWindow` / `maxTokens` and leave every
 * other field (compat, name, …) untouched. A field the config does not hold
 * stays as-is — clearing the config falls back to the route heuristic. Pure.
 */
export function applyDerivedCapabilities(models: readonly RouteModelEntry[], knowledge: KnowledgeView): RouteModelEntry[] {
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
    if (derived.maxTokens !== undefined) next.maxTokens = derived.maxTokens
    return next
  })
}
