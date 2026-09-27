import { describe, expect, it } from 'vitest'

import { knowledgeForPanel, type KnowledgeConfig, type KnowledgeView } from '../src/knowledge.js'
import type { PanelConfig } from '../src/panels.js'
import { ensureRouteProfile, replayRouteCapabilities, syncRouteCatalog, unsetRoute } from '../src/route-config.js'
import type { RouteModelEntry } from '../src/types.js'
import { FakeSettings } from './fake-settings.js'

const PANEL: PanelConfig = {
  id: 'my-relay',
  baseUrl: 'http://127.0.0.1:3000',
  relayKind: 'new-api',
  accessToken: 'tok',
  userId: 42,
  keyRef: 'RELAY_API_KEY_MY_RELAY',
  selectedKeyName: '',
}

/** A flat per-panel view (what the derivation functions consume). */
const NO_KNOWLEDGE: KnowledgeView = { capabilityCatalog: {}, capabilityOverrides: {} }

function knowledge(partial: Partial<KnowledgeView>): KnowledgeView {
  return { ...NO_KNOWLEDGE, ...partial }
}

function settingsWithProfile(models: unknown[] = []): FakeSettings {
  const settings = new FakeSettings().register('llm-pi-ai')
  settings.document['llm-pi-ai'] = {
    providers: {
      [PANEL.id]: {
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:3000/v1',
        apiKeyEnv: PANEL.keyRef,
        models,
      },
    },
  }
  settings.registrations.get('llm-pi-ai')!.revision = 2
  return settings
}

function storedModels(settings: FakeSettings): RouteModelEntry[] {
  return (settings.document['llm-pi-ai'] as { providers: Record<string, { models: RouteModelEntry[] }> }).providers[PANEL.id].models
}

describe('syncRouteCatalog with knowledge replay', () => {
  it('creates the route with profile fields on first sync (route key = panel id)', async () => {
    const settings = new FakeSettings().register('llm-pi-ai')
    const { written } = await syncRouteCatalog(settings, PANEL, ['alpha', 'beta'], NO_KNOWLEDGE)
    expect(written).toBe(true)
    const profile = (settings.document['llm-pi-ai'] as { providers: Record<string, Record<string, unknown>> }).providers[PANEL.id]
    expect(profile.api).toBe('openai-completions')
    expect(profile.baseURL).toBe('http://127.0.0.1:3000/v1')
    expect(profile.apiKeyEnv).toBe('RELAY_API_KEY_MY_RELAY')
    expect(profile.displayName).toBe('my-relay')
    expect((profile.models as Array<{ id: string }>).map((e) => e.id)).toEqual(['alpha', 'beta'])
  })

  it('preserves manual fields across re-syncs; unknown ids keep heuristic capacity', async () => {
    const settings = settingsWithProfile([
      { id: 'alpha', name: 'alpha', contextWindow: 777, compat: { thinkingFormat: 'deepseek' } },
    ])
    const { models } = await syncRouteCatalog(settings, PANEL, ['alpha', 'new-one'], NO_KNOWLEDGE)
    const alpha = models.find((e) => e.id === 'alpha')!
    expect(alpha.contextWindow).toBe(777)
    expect(alpha.compat).toEqual({ thinkingFormat: 'deepseek' })
    expect(models.find((e) => e.id === 'new-one')).toBeTruthy()
  })

  it('applies override first, then knowledge base, and contextWindow replaces the heuristic', async () => {
    const settings = settingsWithProfile([{ id: 'm1', name: 'm1', contextWindow: 12345 }, { id: 'm2', name: 'm2' }, { id: 'm3', name: 'm3' }])
    const kb = knowledge({
      capabilityCatalog: {
        m1: { input: ['text', 'image'], reasoning: ['high'], contextWindow: 999999 },
        m3: { input: ['text'] },
      },
      capabilityOverrides: {
        m1: { input: ['text'], contextWindow: 42 },
      },
    })
    const { models } = await syncRouteCatalog(settings, PANEL, ['m1', 'm2', 'm3'], kb)
    const m1 = models.find((e) => e.id === 'm1')!
    // the override replaces the knowledge base entirely: only its defined
    // fields are written, the rest is left untouched
    expect(m1.input).toEqual(['text'])
    expect(m1.reasoningEfforts).toBeUndefined()
    expect(m1.contextWindow).toBe(42)
    const m2 = models.find((e) => e.id === 'm2')!
    // no config → untouched heuristic entry
    expect(m2.input).toBeUndefined()
    expect(m2.reasoningEfforts).toBeUndefined()
    expect(m2.contextWindow).toBeGreaterThan(0)
    const m3 = models.find((e) => e.id === 'm3')!
    // knowledge base exact hit
    expect(m3.input).toEqual(['text'])
    expect(m3.reasoningEfforts).toBeUndefined()
  })

  it('matches stripped variant suffixes (one level, approximate) and leaves panel-only ids alone', async () => {
    const settings = settingsWithProfile([{ id: 'gemini-3.6-flash-tiered' }, { id: 'qwen3.8-max-0902' }, { id: 'grok-video' }])
    const kb = knowledge({
      capabilityCatalog: {
        'gemini-3.6-flash': { reasoning: ['low'] },
        'qwen3.8-max': { contextWindow: 262144 },
      },
    })
    const { models } = await syncRouteCatalog(settings, PANEL, ['gemini-3.6-flash-tiered', 'qwen3.8-max-0902', 'grok-video'], kb)
    expect(models.find((e) => e.id === 'gemini-3.6-flash-tiered')!.reasoningEfforts).toEqual({ off: null, low: 'low' })
    expect(models.find((e) => e.id === 'qwen3.8-max-0902')!.contextWindow).toBe(262144)
    expect(models.find((e) => e.id === 'grok-video')!.reasoningEfforts).toBeUndefined()
  })

  it('maxTokens: configured values overwrite the heuristic; unconfigured ids keep theirs', async () => {
    const settings = settingsWithProfile([{ id: 'm1', maxTokens: 8192 }, { id: 'm2', maxTokens: 8192 }])
    const kb = knowledge({
      capabilityCatalog: {
        m1: { contextWindow: 131072, maxTokens: 65536 },
      },
    })
    const { models } = await syncRouteCatalog(settings, PANEL, ['m1', 'm2'], kb)
    expect(models.find((e) => e.id === 'm1')!.maxTokens).toBe(65536)
    // m2 has no config: the heuristic maxTokens stays
    expect(models.find((e) => e.id === 'm2')!.maxTokens).toBe(8192)
  })

  it('is a no-op (no write) when catalog and knowledge both unchanged', async () => {
    const kb = knowledge({ capabilityCatalog: { alpha: { input: ['text'] } } })
    const settings = new FakeSettings().register('llm-pi-ai')
    await syncRouteCatalog(settings, PANEL, ['alpha'], kb)
    const writesBefore = settings.writes
    await syncRouteCatalog(settings, PANEL, ['alpha'], kb)
    expect(settings.writes).toBe(writesBefore)
  })

  it('retries under a revision conflict and re-reads fresh data', async () => {
    const kb = knowledge({ capabilityOverrides: { alpha: { reasoning: false } } })
    const settings = settingsWithProfile([{ id: 'alpha', name: 'alpha' }])
    settings.conflictOnce = true
    const { models } = await syncRouteCatalog(settings, PANEL, ['alpha'], kb)
    expect(models.find((e) => e.id === 'alpha')!.reasoningEfforts).toBe(false)
    expect(storedModels(settings).find((e) => e.id === 'alpha')!.reasoningEfforts).toBe(false)
  })

  it('key switch regression: config survives when the same ids re-sync with a fresh knowledge store', async () => {
    const kb = knowledge({ capabilityOverrides: { alpha: { input: ['text', 'image'] } } })
    const settings = new FakeSettings().register('llm-pi-ai')
    await syncRouteCatalog(settings, PANEL, ['alpha', 'beta'], kb)
    // a key switch re-syncs with the same ids; plugin config must still land
    await syncRouteCatalog(settings, PANEL, ['alpha'], NO_KNOWLEDGE)
    const { models } = await syncRouteCatalog(settings, PANEL, ['alpha'], kb)
    expect(models.find((e) => e.id === 'alpha')!.input).toEqual(['text', 'image'])
  })
})

describe('replayRouteCapabilities', () => {
  it('rewrites only configured fields and leaves unconfigured ids untouched', async () => {
    const settings = settingsWithProfile([
      { id: 'a', name: 'a', input: ['text'], reasoningEfforts: { off: null, low: 'low' }, maxTokens: 16384 },
      { id: 'b', name: 'b', input: ['image'], contextWindow: 555 },
    ])
    const kb = knowledge({ capabilityOverrides: { a: { input: ['text', 'image'], reasoning: false } } })
    const models = await replayRouteCapabilities(settings, PANEL.id, kb)
    const a = models.find((e) => e.id === 'a')!
    expect(a.input).toEqual(['text', 'image'])
    expect(a.reasoningEfforts).toBe(false)
    expect(a.maxTokens).toBe(16384)
    // b has no plugin config → nothing touched
    const b = models.find((e) => e.id === 'b')!
    expect(b.input).toEqual(['image'])
    expect(b.contextWindow).toBe(555)
    expect(storedModels(settings).find((e) => e.id === 'b')!.input).toEqual(['image'])
  })

  it('strips resolved-value shells (input: []) before writing back', async () => {
    // settings.get() returns the RESOLVED value: schemastery materializes
    // `input: []` on entries; a replay must not persist those shells.
    const settings = settingsWithProfile([
      { id: 'a', name: 'a', input: [], reasoningEfforts: { off: null, low: 'low' } },
      { id: 'b', name: 'b', input: [] },
    ])
    const kb = knowledge({ capabilityOverrides: { a: { input: ['text', 'image'] } } })
    const models = await replayRouteCapabilities(settings, PANEL.id, kb)
    const a = models.find((e) => e.id === 'a')!
    expect(a.input).toEqual(['text', 'image'])
    expect(storedModels(settings).find((e) => e.id === 'b')!.input).toBeUndefined()
    const raw = JSON.stringify(storedModels(settings))
    expect(raw).not.toContain('"input":[]')
  })

  it('noops without a route and skips the write when nothing derives differently', async () => {
    const empty = new FakeSettings().register('llm-pi-ai')
    await expect(replayRouteCapabilities(empty, PANEL.id, NO_KNOWLEDGE)).resolves.toEqual([])
    expect(empty.document['llm-pi-ai']).toBeUndefined()

    const settings = settingsWithProfile([{ id: 'a', input: ['text'] }])
    const writesBefore = settings.writes
    await replayRouteCapabilities(settings, PANEL.id, knowledge({ capabilityOverrides: { a: { input: ['text'] } } }))
    expect(settings.writes).toBe(writesBefore)
  })
})

describe('ensureRouteProfile', () => {
  it('updates baseURL of an existing route when the panel connection moves', async () => {
    const settings = settingsWithProfile([{ id: 'm' }])
    const moved = { ...PANEL, baseUrl: 'http://panel.example' }
    await expect(ensureRouteProfile(settings, moved)).resolves.toBe(true)
    const profile = (settings.document['llm-pi-ai'] as { providers: Record<string, Record<string, unknown>> }).providers[PANEL.id]
    expect(profile.baseURL).toBe('http://panel.example/v1')
    // models untouched
    expect((profile.models as unknown[]).length).toBe(1)
  })

  it('never creates a route', async () => {
    const settings = new FakeSettings().register('llm-pi-ai')
    await expect(ensureRouteProfile(settings, PANEL)).resolves.toBe(false)
    expect(settings.document['llm-pi-ai']).toBeUndefined()
  })

  it('is idempotent when fields already match', async () => {
    const settings = settingsWithProfile([{ id: 'm' }])
    await expect(ensureRouteProfile(settings, PANEL)).resolves.toBe(false)
  })
})

describe('unsetRoute (panel deletion)', () => {
  it('removes the route wholesale; a second call is a no-op', async () => {
    const settings = settingsWithProfile([{ id: 'm' }])
    await expect(unsetRoute(settings, PANEL.id)).resolves.toBe(true)
    expect((settings.document['llm-pi-ai'] as { providers: Record<string, unknown> }).providers[PANEL.id]).toBeUndefined()
    await expect(unsetRoute(settings, PANEL.id)).resolves.toBe(false)
  })

  it('noops on a namespace without that route', async () => {
    const settings = new FakeSettings().register('llm-pi-ai')
    await expect(unsetRoute(settings, PANEL.id)).resolves.toBe(false)
    expect(settings.writes).toBe(0)
  })
})

describe('knowledgeForPanel (grouped overrides → flat view)', () => {
  it('exposes only the panel\'s override group; other panels\' entries are invisible', () => {
    const stored: KnowledgeConfig = {
      capabilityCatalog: { base: { reasoning: false } },
      capabilityOverrides: {
        'my-relay': { 'm1': { contextWindow: 42 } },
        other: { 'm1': { contextWindow: 99 } },
      },
    }
    const view = knowledgeForPanel(stored, 'my-relay')
    expect(view.capabilityOverrides).toEqual({ m1: { contextWindow: 42 } })
    expect(view.capabilityCatalog).toBe(stored.capabilityCatalog)
    const otherView = knowledgeForPanel(stored, 'other')
    expect(otherView.capabilityOverrides).toEqual({ m1: { contextWindow: 99 } })
  })

  it('yields an empty group for an unknown panel', () => {
    const stored: KnowledgeConfig = { capabilityCatalog: {}, capabilityOverrides: {} }
    expect(knowledgeForPanel(stored, 'nope').capabilityOverrides).toEqual({})
  })
})
