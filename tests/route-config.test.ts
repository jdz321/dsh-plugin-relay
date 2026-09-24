import { describe, expect, it } from 'vitest'

import { ensureRouteProfile, replayRouteCapabilities, syncRouteCatalog } from '../src/route-config.js'
import type { KnowledgeConfig } from '../src/knowledge.js'
import type { Section } from '../src/plan.js'
import type { RouteModelEntry } from '../src/types.js'
import { FakeSettings } from './fake-settings.js'

const SECTION: Section = {
  baseUrl: 'http://127.0.0.1:3000',
  relayKind: 'new-api',
  accessToken: 'tok',
  userId: 42,
  keyRef: 'RELAY_API_KEY',
  route: 'relay',
  selectedKeyName: '',
}

const NO_KNOWLEDGE: KnowledgeConfig = { capabilityCatalog: {}, capabilityOverrides: {} }

function knowledge(partial: Partial<KnowledgeConfig>): KnowledgeConfig {
  return { ...NO_KNOWLEDGE, ...partial }
}

function settingsWithProfile(models: unknown[] = []): FakeSettings {
  const settings = new FakeSettings().register('llm-pi-ai')
  settings.document['llm-pi-ai'] = {
    providers: {
      relay: {
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:3000/v1',
        apiKeyEnv: 'RELAY_API_KEY',
        models,
      },
    },
  }
  settings.registrations.get('llm-pi-ai')!.revision = 2
  return settings
}

function storedModels(settings: FakeSettings): RouteModelEntry[] {
  return (settings.document['llm-pi-ai'] as { providers: { relay: { models: RouteModelEntry[] } } }).providers.relay.models
}

describe('syncRouteCatalog with knowledge replay', () => {
  it('creates the route with profile fields on first sync', async () => {
    const settings = new FakeSettings().register('llm-pi-ai')
    const { written } = await syncRouteCatalog(settings, SECTION, ['alpha', 'beta'], NO_KNOWLEDGE)
    expect(written).toBe(true)
    const profile = (settings.document['llm-pi-ai'] as { providers: { relay: Record<string, unknown> } }).providers.relay
    expect(profile.api).toBe('openai-completions')
    expect(profile.baseURL).toBe('http://127.0.0.1:3000/v1')
    expect(profile.apiKeyEnv).toBe('RELAY_API_KEY')
    expect((profile.models as Array<{ id: string }>).map((e) => e.id)).toEqual(['alpha', 'beta'])
  })

  it('preserves manual fields across re-syncs; unknown ids keep heuristic capacity', async () => {
    const settings = settingsWithProfile([
      { id: 'alpha', name: 'alpha', contextWindow: 777, compat: { thinkingFormat: 'deepseek' } },
    ])
    const { models } = await syncRouteCatalog(settings, SECTION, ['alpha', 'new-one'], NO_KNOWLEDGE)
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
    const { models } = await syncRouteCatalog(settings, SECTION, ['m1', 'm2', 'm3'], kb)
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
    const { models } = await syncRouteCatalog(settings, SECTION, ['gemini-3.6-flash-tiered', 'qwen3.8-max-0902', 'grok-video'], kb)
    expect(models.find((e) => e.id === 'gemini-3.6-flash-tiered')!.reasoningEfforts).toEqual({ off: null, low: 'low' })
    expect(models.find((e) => e.id === 'qwen3.8-max-0902')!.contextWindow).toBe(262144)
    expect(models.find((e) => e.id === 'grok-video')!.reasoningEfforts).toBeUndefined()
  })

  it('is a no-op (no write) when catalog and knowledge both unchanged', async () => {
    const kb = knowledge({ capabilityCatalog: { alpha: { input: ['text'] } } })
    const settings = new FakeSettings().register('llm-pi-ai')
    await syncRouteCatalog(settings, SECTION, ['alpha'], kb)
    const writesBefore = settings.writes
    await syncRouteCatalog(settings, SECTION, ['alpha'], kb)
    expect(settings.writes).toBe(writesBefore)
  })

  it('retries under a revision conflict and re-reads fresh data', async () => {
    const kb = knowledge({ capabilityOverrides: { alpha: { reasoning: false } } })
    const settings = settingsWithProfile([{ id: 'alpha', name: 'alpha' }])
    settings.conflictOnce = true
    const { models } = await syncRouteCatalog(settings, SECTION, ['alpha'], kb)
    expect(models.find((e) => e.id === 'alpha')!.reasoningEfforts).toBe(false)
    expect(storedModels(settings).find((e) => e.id === 'alpha')!.reasoningEfforts).toBe(false)
  })

  it('key switch regression: config survives when the same ids re-sync with a fresh knowledge store', async () => {
    const kb = knowledge({ capabilityOverrides: { alpha: { input: ['text', 'image'] } } })
    const settings = new FakeSettings().register('llm-pi-ai')
    await syncRouteCatalog(settings, SECTION, ['alpha', 'beta'], kb)
    // a key switch re-syncs with the same ids; plugin config must still land
    await syncRouteCatalog(settings, SECTION, ['alpha'], NO_KNOWLEDGE)
    const { models } = await syncRouteCatalog(settings, SECTION, ['alpha'], kb)
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
    const models = await replayRouteCapabilities(settings, 'relay', kb)
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
    const models = await replayRouteCapabilities(settings, 'relay', kb)
    const a = models.find((e) => e.id === 'a')!
    expect(a.input).toEqual(['text', 'image'])
    expect(storedModels(settings).find((e) => e.id === 'b')!.input).toBeUndefined()
    const raw = JSON.stringify(storedModels(settings))
    expect(raw).not.toContain('"input":[]')
  })

  it('noops without a route and skips the write when nothing derives differently', async () => {
    const empty = new FakeSettings().register('llm-pi-ai')
    await expect(replayRouteCapabilities(empty, 'relay', NO_KNOWLEDGE)).resolves.toEqual([])
    expect(empty.document['llm-pi-ai']).toBeUndefined()

    const settings = settingsWithProfile([{ id: 'a', input: ['text'] }])
    const writesBefore = settings.writes
    await replayRouteCapabilities(settings, 'relay', knowledge({ capabilityOverrides: { a: { input: ['text'] } } }))
    expect(settings.writes).toBe(writesBefore)
  })
})

describe('ensureRouteProfile', () => {
  it('updates baseURL of an existing route when the connection moves', async () => {
    const settings = settingsWithProfile([{ id: 'm' }])
    const moved = { ...SECTION, baseUrl: 'http://panel.example' }
    await expect(ensureRouteProfile(settings, moved)).resolves.toBe(true)
    const profile = (settings.document['llm-pi-ai'] as { providers: { relay: Record<string, unknown> } }).providers.relay
    expect(profile.baseURL).toBe('http://panel.example/v1')
    // models untouched
    expect((profile.models as unknown[]).length).toBe(1)
  })

  it('never creates a route', async () => {
    const settings = new FakeSettings().register('llm-pi-ai')
    await expect(ensureRouteProfile(settings, SECTION)).resolves.toBe(false)
    expect(settings.document['llm-pi-ai']).toBeUndefined()
  })

  it('is idempotent when fields already match', async () => {
    const settings = settingsWithProfile([{ id: 'm' }])
    await expect(ensureRouteProfile(settings, SECTION)).resolves.toBe(false)
  })
})
