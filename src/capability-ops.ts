/**
 * Directed capability operations — the POST /api/relay/capabilities handler,
 * extracted so it is unit-testable against FakeSettings.
 *
 * Contract (v0.6.0): the client sends targeted ops — `catalogSet` /
 * `catalogDelete` address the GLOBAL knowledge base by canonical name;
 * `overrideSet` / `overrideDelete` address `capabilityOverrides.<panel>.<id>`
 * and carry the owning `panel` id at body level. Each entry becomes one
 * `settings.mutate` path op — plain-object paths, which is exactly what
 * mutate can address (and what makes deletes real: a whole-dict `set` could
 * not remove keys through the deep-merging `update`). One queued mutate
 * carries all ops; the derivation replay over every configured panel route
 * follows as one guarded write each.
 */

import { NAMESPACE } from './constants.js'
import { knowledgeForPanel, normalizeCapabilityEntry, validateCapabilityEntry, type CatalogEntry, type KnowledgeConfig } from './knowledge.js'
import type { PanelConfig } from './panels.js'
import { replayRouteCapabilities } from './route-config.js'
import type { SettingsPathOp, SettingsService } from './types.js'

/** The POST body shape (every member optional; unknown members ignored). */
export interface CapabilityOpsBody {
  catalogSet?: Record<string, unknown>
  catalogDelete?: unknown
  /** Owning panel id for the override ops below (required with them). */
  panel?: unknown
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
 * Apply directed capability ops and replay the derivation over every
 * configured panel route (the knowledge base is global; overrides are
 * per-panel but the replay is cheap and idempotent). Validation happens
 * before any write; a bad entry aborts the whole batch.
 */
export async function applyCapabilityOps(
  settings: SettingsService,
  body: CapabilityOpsBody,
  knowledge: () => KnowledgeConfig,
  panels: readonly PanelConfig[],
): Promise<void> {
  const ops: SettingsPathOp[] = []
  let overridePanel: string | null = null
  for (const [name, raw] of Object.entries(body.catalogSet ?? {})) {
    const key = name.trim()
    if (!key) throw new Error('知识库模型名不能为空')
    ops.push({ op: 'set', path: ['capabilityCatalog', key], value: checkedEntry(raw, `知识库「${key}」`) })
  }
  for (const name of nameList(body.catalogDelete)) {
    ops.push({ op: 'unset', path: ['capabilityCatalog', name] })
  }
  const hasOverrideOps = body.overrideSet !== undefined || body.overrideDelete !== undefined
  if (hasOverrideOps) {
    if (typeof body.panel !== 'string' || !body.panel.trim()) {
      throw new Error('覆盖配置缺少面板 id')
    }
    overridePanel = body.panel.trim()
    if (!panels.some((panel) => panel.id === overridePanel)) {
      throw new Error(`未知面板「${overridePanel}」`)
    }
  }
  for (const [name, raw] of Object.entries(body.overrideSet ?? {})) {
    const key = name.trim()
    if (!key) throw new Error('覆盖配置的模型 id 不能为空')
    ops.push({ op: 'set', path: ['capabilityOverrides', overridePanel!, key], value: checkedEntry(raw, `覆盖「${key}」`) })
  }
  for (const name of nameList(body.overrideDelete)) {
    ops.push({ op: 'unset', path: ['capabilityOverrides', overridePanel!, name] })
  }
  if (!ops.length) throw new Error('没有需要执行的操作')
  await settings.mutate(NAMESPACE, ops)
  // Unsetting the last override of a panel group leaves an empty `{}` shell
  // behind (unset cannot see its parent); drop that shell so settings.yaml
  // carries no noise.
  if (overridePanel !== null && nameList(body.overrideDelete).length) {
    const rawGroup = (settings.section(NAMESPACE)?.capabilityOverrides as Record<string, unknown> | undefined)?.[overridePanel]
    if (rawGroup !== undefined && rawGroup !== null && typeof rawGroup === 'object' && !Array.isArray(rawGroup) && Object.keys(rawGroup).length === 0) {
      await settings.mutate(NAMESPACE, [{ op: 'unset', path: ['capabilityOverrides', overridePanel] }])
    }
  }
  const knowledgeNow = knowledge()
  const replayPanels = panels.filter((panel) => overridePanel === null || panel.id === overridePanel)
  for (const panel of replayPanels) {
    await replayRouteCapabilities(settings, panel.id, knowledgeForPanel(knowledgeNow, panel.id))
  }
}
