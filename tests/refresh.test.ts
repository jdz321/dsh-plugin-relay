import { describe, expect, it } from 'vitest'

import { resolvePreset } from '../src/knowledge.js'
import { refreshPresetAndReplay, restorePresetBaseline } from '../src/refresh.js'
import type { PanelConfig } from '../src/panels.js'
import type { ModelsDevDocument } from '../src/capabilities.js'
import type { SettingsService } from '../src/types.js'
import { FakeSettings } from './fake-settings.js'

const PANEL: PanelConfig = {
  id: 'my-relay', baseUrl: 'https://a.example.com', relayKind: 'new-api',
  accessToken: 't', userId: 1, keyRef: 'RELAY_API_KEY_MY_RELAY', selectedKeyName: '',
}

/** The compiled baseline the delta is taken against (mirrors the real shape). */
const BASELINE = {
  'gpt-5.5': { contextWindow: 300000 },
  'old-model': { contextWindow: 64000 },
} as const

function doc(): ModelsDevDocument {
  return {
    openai: {
      models: {
        'gpt-6.1': { release_date: '2026-08-01', modalities: { input: ['text'] }, reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }], limit: { context: 400000, output: 128000 } },
      },
    },
  }
}

/** The effective preset layer as the host resolves it (baseline + stored delta). */
function effectiveOf(settings: SettingsService) {
  const section = settings.get('relay') as { capabilityPresetDelta?: unknown }
  return resolvePreset({ ...BASELINE }, (section.capabilityPresetDelta ?? undefined) as never)
}

describe('refreshPresetAndReplay (刷新预置 — persist delta + replay into every route)', () => {
  it('persists the delta, resolves it into the knowledge view, and replays the route in one call', async () => {
    const settings = new FakeSettings().register('relay').register('llm-pi-ai')
    await settings.seed('llm-pi-ai', {
      providers: {
        [PANEL.id]: {
          api: 'openai-completions', baseURL: 'https://a.example.com/v1', apiKeyEnv: PANEL.keyRef,
          models: [{ id: 'gpt-6.1', name: 'gpt-6.1', contextWindow: 12345, maxTokens: 8192 }],
        },
      },
    })
    const result = await refreshPresetAndReplay({
      fetchDoc: async () => doc(),
      settings,
      panels: [PANEL],
      baseline: { ...BASELINE },
      knowledge: () => ({ capabilityCatalog: {}, capabilityOverrides: {}, capabilityPreset: effectiveOf(settings) }),
      builtAt: () => 1_700_000_000_000,
    })
    expect(result).toMatchObject({
      count: 1,
      replayed: true,
      // gpt-6.1 added; both baseline models vanished from the doc → removed
      delta: { added: 1, updated: 0, removed: 2 },
    })
    // The delta is ON DISK (FakeSettings document) — the v0.6.1 contract.
    const delta = (settings.section('relay') as { capabilityPresetDelta?: Record<string, unknown> }).capabilityPresetDelta
    expect(delta).toMatchObject({ builtAt: 1_700_000_000_000, removed: ['gpt-5.5', 'old-model'] })
    expect(delta!.changed).toMatchObject({ 'gpt-6.1': { contextWindow: 400000, maxTokens: 128000 } })
    // THE v0.5.1 gap this closes: the route entry carries the new derivation
    // immediately, not at the next key switch / sync / save.
    const models = (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers[PANEL.id].models
    expect(models[0]).toMatchObject({ contextWindow: 400000, maxTokens: 128000 })
    expect(models[0]!.reasoningEfforts).toEqual({ off: null, high: 'high' })
  })

  it('an unchanged refresh persists an empty delta (records builtAt)', async () => {
    const settings = new FakeSettings().register('relay').register('llm-pi-ai')
    // baseline == exactly what the fixture doc builds → empty diff
    const sameAsDoc = { 'gpt-6.1': { input: ['text'], reasoning: ['high'], contextWindow: 400000, maxTokens: 128000 } }
    const result = await refreshPresetAndReplay({
      fetchDoc: async () => doc(),
      settings,
      panels: [],
      baseline: sameAsDoc,
      knowledge: () => ({ capabilityCatalog: {}, capabilityOverrides: {} }),
      builtAt: () => 42,
    })
    // baseline == the refresh output → empty diff, but builtAt still records
    expect(result.delta).toEqual({ added: 0, updated: 0, removed: 0 })
    expect((settings.section('relay') as { capabilityPresetDelta?: { builtAt?: number } }).capabilityPresetDelta).toEqual({ builtAt: 42, removed: [], changed: {} })
  })

  it('replays per panel; one failing route reports without rolling the delta back', async () => {
    const other: PanelConfig = { ...PANEL, id: 'other' }
    const settings = new FakeSettings().register('relay').register('llm-pi-ai')
    await settings.seed('llm-pi-ai', {
      providers: {
        [PANEL.id]: { models: [{ id: 'gpt-6.1', name: 'gpt-6.1' }] },
        [other.id]: { models: [{ id: 'gpt-6.1', name: 'gpt-6.1' }] },
      },
    })
    const knowledge = () => ({ capabilityCatalog: {}, capabilityOverrides: {}, capabilityPreset: effectiveOf(settings) })
    // Simulate a conflict exhausting its retries on one route: a registered
    // llm-pi-ai namespace whose descriptor disappears mid-flight is the
    // cleanest way here — the delta write lands, the first replay succeeds,
    // then the namespace goes.
    let llmWrites = 0
    const originalDescribe = settings.describe.bind(settings)
    settings.describe = () => {
      if (llmWrites >= 1) return originalDescribe().filter((d) => d.ns !== 'llm-pi-ai')
      return originalDescribe()
    }
    const originalMutate = settings.mutate.bind(settings)
    settings.mutate = async (...args: Parameters<typeof originalMutate>) => {
      if (args[0] === 'llm-pi-ai') llmWrites += 1
      return originalMutate(...args)
    }
    const result = await refreshPresetAndReplay({
      fetchDoc: async () => doc(),
      settings,
      panels: [PANEL, other],
      baseline: { ...BASELINE },
      knowledge,
    })
    expect(result.replayed).toBe(false)
    expect(result.replayError).toContain(other.id)
    // the persisted delta stays despite the replay failure
    expect((settings.section('relay') as { capabilityPresetDelta?: { changed?: Record<string, unknown> } }).capabilityPresetDelta!.changed).toHaveProperty('gpt-6.1')
    // and the route that did replay carries the fresh derivation
    const first = (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers[PANEL.id].models
    expect(first[0]!.contextWindow).toBe(400000)
  })

  it('fetch failures propagate BEFORE any write (the handler maps them to a readable 502)', async () => {
    const settings = new FakeSettings().register('relay').register('llm-pi-ai')
    await expect(refreshPresetAndReplay({
      fetchDoc: async () => {
        throw new Error('network down')
      },
      settings,
      panels: [PANEL],
      baseline: { ...BASELINE },
      knowledge: () => ({ capabilityCatalog: {}, capabilityOverrides: {} }),
    })).rejects.toThrow('network down')
    expect(settings.section('relay')).toBeUndefined()
  })
})

describe('restorePresetBaseline (恢复基线 — unset delta + replay)', () => {
  it('unsets the persisted delta and replays the derivation from the bare baseline', async () => {
    const settings = new FakeSettings().register('relay').register('llm-pi-ai')
    await settings.seed('relay', {
      capabilityPresetDelta: { builtAt: 1, removed: [], changed: { 'gpt-6.1': { contextWindow: 400000 } } },
    })
    await settings.seed('llm-pi-ai', {
      providers: {
        [PANEL.id]: { models: [{ id: 'gpt-6.1', name: 'gpt-6.1', contextWindow: 400000 }] },
      },
    })
    const result = await restorePresetBaseline({
      settings,
      panels: [PANEL],
      knowledge: () => ({ capabilityCatalog: {}, capabilityOverrides: {}, capabilityPreset: effectiveOf(settings) }),
    })
    expect(result.replayed).toBe(true)
    // the delta is gone from the stored section
    expect((settings.section('relay') as Record<string, unknown>).capabilityPresetDelta).toBeUndefined()
    // the route entry fell back to the bare baseline derivation (unconfigured
    // fields stay untouched — only plugin-held config would revert)
    const models = (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers[PANEL.id].models
    expect(models[0]).toMatchObject({ id: 'gpt-6.1' })
    expect(models[0]!.contextWindow).toBe(400000)
  })
})
