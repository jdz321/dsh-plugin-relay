/**
 * Directed capability operations — the POST /api/relay/capabilities handler,
 * extracted so it is unit-testable against FakeSettings.
 *
 * v0.5.1 contract: instead of whole dicts, the client sends targeted ops
 * (`catalogSet` / `catalogDelete` / `overrideSet` / `overrideDelete`). Each
 * entry becomes one `settings.mutate` path op addressing
 * `capabilityCatalog.<name>` / `capabilityOverrides.<id>` — plain-object
 * paths, which is exactly what mutate can address (and what makes deletes
 * real: the v0.5.0 whole-dict `set` could not remove keys through the
 * deep-merging `update`). One queued mutate carries all ops; the derivation
 * replay over the route catalog follows as the single guarded write.
 */

import { NAMESPACE } from './constants.js'
import { normalizeCapabilityEntry, validateCapabilityEntry, type CatalogEntry, type KnowledgeConfig } from './knowledge.js'
import { replayRouteCapabilities } from './route-config.js'
import type { SettingsPathOp, SettingsService } from './types.js'

/** The POST body shape (every member optional; unknown members ignored). */
export interface CapabilityOpsBody {
  catalogSet?: Record<string, unknown>
  catalogDelete?: unknown
  overrideSet?: Record<string, unknown>
  overrideDelete?: unknown
}

/** Validate one submitted dict entry after normalization. */
export function checkedEntry(raw: unknown, label: string): CatalogEntry {
  const entry = normalizeCapabilityEntry(raw)
  if (!entry) throw new Error(`${label}: 至少配置一项能力字段`)
  validateCapabilityEntry(entry, label)
  return entry
}

function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((name) => String(name).trim()).filter(Boolean)
}

/**
 * Apply directed capability ops and replay the derivation over the route.
 * Validation happens before any write; a bad entry aborts the whole batch.
 */
export async function applyCapabilityOps(
  settings: SettingsService,
  routeName: string,
  body: CapabilityOpsBody,
  knowledge: () => KnowledgeConfig,
): Promise<void> {
  const ops: SettingsPathOp[] = []
  for (const [name, raw] of Object.entries(body.catalogSet ?? {})) {
    const key = name.trim()
    if (!key) throw new Error('知识库模型名不能为空')
    ops.push({ op: 'set', path: ['capabilityCatalog', key], value: checkedEntry(raw, `知识库「${key}」`) })
  }
  for (const name of nameList(body.catalogDelete)) {
    ops.push({ op: 'unset', path: ['capabilityCatalog', name] })
  }
  for (const [name, raw] of Object.entries(body.overrideSet ?? {})) {
    const key = name.trim()
    if (!key) throw new Error('覆盖配置的模型 id 不能为空')
    ops.push({ op: 'set', path: ['capabilityOverrides', key], value: checkedEntry(raw, `覆盖「${key}」`) })
  }
  for (const name of nameList(body.overrideDelete)) {
    ops.push({ op: 'unset', path: ['capabilityOverrides', name] })
  }
  if (!ops.length) throw new Error('没有需要执行的操作')
  await settings.mutate(NAMESPACE, ops)
  await replayRouteCapabilities(settings, routeName, knowledge())
}
