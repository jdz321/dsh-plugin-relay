/**
 * 「刷新预置」behind POST /api/relay/knowledge-refresh: force-fetch
 * models.dev, rebuild the preset layer with the same mainstream rules as
 * `npm run preset:fetch` (v0.6.0: models.dev only — the panel is never a
 * baseline source), hold it in host memory until restart, and — the v0.5.1
 * gap this closes — replay the derivation over EVERY configured panel route
 * so the request-affecting `llm-pi-ai.providers.<id>.models` fields follow
 * immediately instead of waiting for the next key switch / sync / save.
 *
 * A replay failure (e.g. a settings conflict exhausting its retries) is
 * reported readably but does NOT roll the freshly built memory layer back.
 */

import type { ModelsDevDocument } from './capabilities.js'
import { buildPresetEntries, type PresetEntry } from './knowledge-preset.js'
import { knowledgeForPanel, type KnowledgeConfig } from './knowledge.js'
import type { PanelConfig } from './panels.js'
import { replayRouteCapabilities } from './route-config.js'
import type { SettingsService } from './types.js'

export interface PresetRefreshResult {
  /** Preset entries after the rebuild. */
  count: number
  /** True when every configured panel route replayed without error. */
  replayed: boolean
  /** First replay failure, when any. */
  replayError?: string
}

export async function refreshPresetAndReplay(opts: {
  fetchDoc: () => Promise<ModelsDevDocument>
  settings: SettingsService
  panels: readonly PanelConfig[]
  /** Receives the rebuilt preset layer; the host stores it in memory. */
  onPreset: (entries: Record<string, PresetEntry>) => void
  /** Current knowledge view (called AFTER onPreset, so it sees the new layer). */
  knowledge: () => KnowledgeConfig
}): Promise<PresetRefreshResult> {
  const doc = await opts.fetchDoc()
  const built = buildPresetEntries(doc)
  opts.onPreset(built.entries)
  const knowledgeNow = opts.knowledge()
  let replayError: string | undefined
  for (const panel of opts.panels) {
    try {
      await replayRouteCapabilities(opts.settings, panel.id, knowledgeForPanel(knowledgeNow, panel.id))
    } catch (err) {
      replayError ??= `模型目录同步失败（面板 ${panel.id}）: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return {
    count: Object.keys(built.entries).length,
    replayed: replayError === undefined,
    ...(replayError !== undefined ? { replayError } : {}),
  }
}
