/**
 * 「刷新预置」behind POST /api/relay/knowledge-refresh, and 「恢复基线」behind
 * POST /api/relay/preset-restore.
 *
 * v0.6.1 semantics — the refresh result PERSISTS as a delta: force-fetch
 * models.dev, rebuild the preset with the same mainstream rules as
 * `npm run preset:fetch` (the panel is never a baseline source), write the
 * difference against the compiled baseline into the namespace
 * (`capabilityPresetDelta`, one awaited `mutate` before anything else happens),
 * and replay the derivation over EVERY configured panel route so the
 * request-affecting `llm-pi-ai.providers.<id>.models` fields follow
 * immediately. Restart no longer falls back — the delta re-applies over the
 * compiled baseline on every load; the only way back is 恢复基线 (or deleting
 * the settings key by hand).
 *
 * A replay failure (e.g. a settings conflict exhausting its retries) is
 * reported readably but does NOT roll the persisted delta back.
 */

import type { ModelsDevDocument } from './capabilities.js'
import { buildPresetEntries } from './knowledge-preset.js'
import { diffPreset, knowledgeForPanel, type CatalogEntry, type KnowledgeConfig } from './knowledge.js'
import { NAMESPACE } from './constants.js'
import type { PanelConfig } from './panels.js'
import { replayRouteCapabilities } from './route-config.js'
import type { SettingsPathOp, SettingsService } from './types.js'

export interface PresetRefreshResult {
  /** Effective preset entries after the rebuild (baseline + delta). */
  count: number
  /** True when every configured panel route replayed without error. */
  replayed: boolean
  /** First replay failure, when any. */
  replayError?: string
  /** Delta persisted relative to the compiled baseline. */
  delta: { added: number, updated: number, removed: number }
}

export async function refreshPresetAndReplay(opts: {
  fetchDoc: () => Promise<ModelsDevDocument>
  settings: SettingsService
  panels: readonly PanelConfig[]
  /** The compiled-in baseline the delta is taken against. */
  baseline: Record<string, CatalogEntry>
  /** Current knowledge view (called AFTER the delta landed, so it sees it). */
  knowledge: () => KnowledgeConfig
  builtAt?: () => number
}): Promise<PresetRefreshResult> {
  const doc = await opts.fetchDoc()
  const built = buildPresetEntries(doc)
  const diff = diffPreset(opts.baseline, built.entries)
  // Persist FIRST and await it fully: everything after (and the client that
  // refetches when this response lands) must see the delta.
  const ops: SettingsPathOp[] = [{
    op: 'set',
    path: ['capabilityPresetDelta'],
    value: {
      builtAt: (opts.builtAt ?? Date.now)(),
      removed: diff.removed,
      changed: diff.changed,
    },
  }]
  await opts.settings.mutate(NAMESPACE, ops)
  const knowledgeNow = opts.knowledge()
  let replayError: string | undefined
  for (const panel of opts.panels) {
    try {
      await replayRouteCapabilities(opts.settings, panel.id, knowledgeForPanel(knowledgeNow, panel.id))
    } catch (err) {
      replayError ??= `模型目录同步失败（面板 ${panel.id}）: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  let added = 0
  for (const name of Object.keys(diff.changed)) {
    if (opts.baseline[name] === undefined) added += 1
  }
  const changedCount = Object.keys(diff.changed).length
  return {
    count: Object.keys(built.entries).length,
    replayed: replayError === undefined,
    delta: { added, updated: changedCount - added, removed: diff.removed.length },
    ...(replayError !== undefined ? { replayError } : {}),
  }
}

export interface PresetRestoreResult {
  replayed: boolean
  replayError?: string
}

/** 恢复基线: drop the persisted delta and replay over every panel route. */
export async function restorePresetBaseline(opts: {
  settings: SettingsService
  panels: readonly PanelConfig[]
  /** Current knowledge view (called AFTER the unset landed). */
  knowledge: () => KnowledgeConfig
}): Promise<PresetRestoreResult> {
  await opts.settings.mutate(NAMESPACE, [{ op: 'unset', path: ['capabilityPresetDelta'] }])
  const knowledgeNow = opts.knowledge()
  let replayError: string | undefined
  for (const panel of opts.panels) {
    try {
      await replayRouteCapabilities(opts.settings, panel.id, knowledgeForPanel(knowledgeNow, panel.id))
    } catch (err) {
      replayError ??= `模型目录同步失败（面板 ${panel.id}）: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return { replayed: replayError === undefined, ...(replayError !== undefined ? { replayError } : {}) }
}
