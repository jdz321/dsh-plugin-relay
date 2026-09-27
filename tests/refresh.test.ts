import { describe, expect, it } from 'vitest'

import { normalizeKnowledgeConfig } from '../src/knowledge.js'
import { refreshPresetAndReplay } from '../src/refresh.js'
import type { PanelConfig } from '../src/panels.js'
import type { ModelsDevDocument } from '../src/capabilities.js'
import type { PresetEntry } from '../src/knowledge-preset.js'
import { FakeSettings } from './fake-settings.js'

const PANEL: PanelConfig = {
  id: 'my-relay', baseUrl: 'https://a.example.com', relayKind: 'new-api',
  accessToken: 't', userId: 1, keyRef: 'RELAY_API_KEY_MY_RELAY', selectedKeyName: '',
}

function doc(): ModelsDevDocument {
  return {
    openai: {
      models: {
        'gpt-6.1': { release_date: '2026-08-01', modalities: { input: ['text'] }, reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }], limit: { context: 400000, output: 128000 } },
      },
    },
  }
}

describe('refreshPresetAndReplay (刷新预置 — rebuild + replay into every route)', () => {
  it('rebuilds the preset and replays the derivation into the panel route in one call', async () => {
    const settings = new FakeSettings().register('relay').register('llm-pi-ai')
    await settings.seed('llm-pi-ai', {
      providers: {
        [PANEL.id]: {
          api: 'openai-completions', baseURL: 'https://a.example.com/v1', apiKeyEnv: PANEL.keyRef,
          models: [{ id: 'gpt-6.1', name: 'gpt-6.1', contextWindow: 12345, maxTokens: 8192 }],
        },
      },
    })
    let preset: Record<string, PresetEntry> = {}
    const result = await refreshPresetAndReplay({
      fetchDoc: async () => doc(),
      settings,
      panels: [PANEL],
      onPreset: (entries) => {
        preset = entries
      },
      knowledge: () => ({ ...normalizeKnowledgeConfig(settings.get('relay')), capabilityPreset: preset }),
    })
    expect(result).toMatchObject({ count: 1, replayed: true })
    expect(preset['gpt-6.1']).toMatchObject({ contextWindow: 400000, maxTokens: 128000 })
    // THE v0.5.1 gap this closes: the route entry carries the new derivation
    // immediately, not at the next key switch / sync / save.
    const models = (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers[PANEL.id].models
    expect(models[0]).toMatchObject({ contextWindow: 400000, maxTokens: 128000 })
    expect(models[0]!.reasoningEfforts).toEqual({ off: null, high: 'high' })
  })

  it('replays per panel; one failing route reports without rolling the preset back', async () => {
    const other: PanelConfig = { ...PANEL, id: 'other' }
    const settings = new FakeSettings().register('relay').register('llm-pi-ai')
    await settings.seed('llm-pi-ai', {
      providers: {
        [PANEL.id]: { models: [{ id: 'gpt-6.1', name: 'gpt-6.1' }] },
        [other.id]: { models: [{ id: 'gpt-6.1', name: 'gpt-6.1' }] },
      },
    })
    let preset: Record<string, PresetEntry> = {}
    const knowledge = () => ({ ...normalizeKnowledgeConfig(settings.get('relay')), capabilityPreset: preset })
    // Simulate a conflict exhausting its retries on one route: a registered
    // llm-pi-ai namespace whose descriptor disappears mid-flight is the
    // cleanest way here — the first replay succeeds, then the namespace goes.
    let replays = 0
    const originalDescribe = settings.describe.bind(settings)
    settings.describe = () => {
      if (replays >= 1) return originalDescribe().filter((d) => d.ns !== 'llm-pi-ai')
      return originalDescribe()
    }
    const originalMutate = settings.mutate.bind(settings)
    settings.mutate = async (...args) => {
      replays += 1
      return originalMutate(...args)
    }
    const result = await refreshPresetAndReplay({
      fetchDoc: async () => doc(),
      settings,
      panels: [PANEL, other],
      onPreset: (entries) => {
        preset = entries
      },
      knowledge,
    })
    expect(result.replayed).toBe(false)
    expect(result.replayError).toContain(other.id)
    // the memory layer stays rebuilt despite the replay failure
    expect(preset['gpt-6.1']).toBeDefined()
    // and the route that did replay carries the fresh derivation
    const first = (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers[PANEL.id].models
    expect(first[0]!.contextWindow).toBe(400000)
  })

  it('fetch failures propagate (the handler maps them to a readable 502)', async () => {
    const settings = new FakeSettings().register('relay').register('llm-pi-ai')
    await expect(refreshPresetAndReplay({
      fetchDoc: async () => {
        throw new Error('network down')
      },
      settings,
      panels: [PANEL],
      onPreset: () => {},
      knowledge: () => ({ capabilityCatalog: {}, capabilityOverrides: {} }),
    })).rejects.toThrow('network down')
  })
})
