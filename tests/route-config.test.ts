import { describe, expect, it } from 'vitest'

import { applyCapabilityUpdates, capabilityOf, ensureRouteProfile, reasoningEffortsFor, saveCapabilities, syncRouteCatalog, type CapabilityUpdate } from '../src/route-config.js'
import type { Section } from '../src/plan.js'
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

describe('reasoningEffortsFor', () => {
  it('pins off to null and writes the level name as the wire value', () => {
    expect(reasoningEffortsFor(['high', 'low'])).toEqual({ off: null, high: 'high', low: 'low' })
    expect(reasoningEffortsFor(['minimal'])).toEqual({ off: null, minimal: 'minimal' })
  })
})

describe('capabilityOf', () => {
  it('normalizes stored entries into UI views', () => {
    expect(capabilityOf({ id: 'a' })).toEqual({ input: null, reasoning: null })
    expect(capabilityOf({ id: 'a', input: [] })).toEqual({ input: null, reasoning: null })
    expect(capabilityOf({ id: 'a', input: ['text'], reasoningEfforts: false })).toEqual({ input: ['text'], reasoning: false })
    expect(capabilityOf({ id: 'a', reasoningEfforts: { off: null, xhigh: 'xhigh' } })).toEqual({ input: null, reasoning: ['xhigh'] })
  })
})

describe('applyCapabilityUpdates', () => {
  const stored = [
    { id: 'm1', name: 'm1', contextWindow: 128000, maxTokens: 16384, compat: { thinkingFormat: 'deepseek' } },
    { id: 'm2', name: 'm2', input: ['text'], reasoningEfforts: { off: null, low: 'low' } },
  ]

  it('merges capability fields without touching other fields', () => {
    const next = applyCapabilityUpdates(stored, [
      { id: 'm1', input: ['text', 'image'], reasoning: { levels: ['high', 'xhigh'] } },
    ])
    const m1 = next.find((e) => e.id === 'm1')!
    expect(m1.contextWindow).toBe(128000)
    expect(m1.maxTokens).toBe(16384)
    expect(m1.compat).toEqual({ thinkingFormat: 'deepseek' })
    expect(m1.input).toEqual(['text', 'image'])
    expect(m1.reasoningEfforts).toEqual({ off: null, high: 'high', xhigh: 'xhigh' })
    // m2 untouched
    expect(next.find((e) => e.id === 'm2')!.reasoningEfforts).toEqual({ off: null, low: 'low' })
  })

  it('writes false for explicit non-reasoning and clears fields for null', () => {
    const next = applyCapabilityUpdates(stored, [
      { id: 'm2', reasoning: false },
      { id: 'm1', reasoning: null, input: [] },
    ])
    expect(next.find((e) => e.id === 'm2')!.reasoningEfforts).toBe(false)
    const m1 = next.find((e) => e.id === 'm1')!
    expect(m1.reasoningEfforts).toBeUndefined()
    expect(m1.input).toBeUndefined()
  })

  it('removeCapability strips only capability fields', () => {
    const next = applyCapabilityUpdates(stored, [{ id: 'm2', removeCapability: true }])
    const m2 = next.find((e) => e.id === 'm2')!
    expect(m2.input).toBeUndefined()
    expect(m2.reasoningEfforts).toBeUndefined()
    expect(m2.id).toBe('m2')
  })

  it('removeModel drops the entry; unknown ids are rejected', () => {
    const next = applyCapabilityUpdates(stored, [{ id: 'm1', removeModel: true }])
    expect(next.find((e) => e.id === 'm1')).toBeUndefined()
    expect(() => applyCapabilityUpdates(stored, [{ id: 'ghost', removeModel: true }])).toThrow(/ghost/)
  })

  it('appends manual models with name = id', () => {
    const next = applyCapabilityUpdates(stored, [{ id: 'my-model', input: ['image'], reasoning: false }])
    const added = next.find((e) => e.id === 'my-model')!
    expect(added.name).toBe('my-model')
    expect(added.input).toEqual(['image'])
    expect(added.reasoningEfforts).toBe(false)
  })

  it('rejects empty level sets and unknown levels', () => {
    expect(() => applyCapabilityUpdates(stored, [{ id: 'm1', reasoning: { levels: [] } }])).toThrow(/至少/)
    expect(() => applyCapabilityUpdates(stored, [{ id: 'm1', reasoning: { levels: ['ultra'] } }])).toThrow(/ultra/)
  })
})

describe('saveCapabilities', () => {
  it('writes the merged models array via one guarded mutate', async () => {
    const settings = settingsWithProfile([{ id: 'm1', name: 'm1' }])
    const result = await saveCapabilities(settings, 'relay', [
      { id: 'm1', reasoning: { levels: ['medium'] } },
    ])
    const stored = settings.document['llm-pi-ai'] as { providers: { relay: { models: Array<Record<string, unknown>> } } }
    expect(stored.providers.relay.models.find((e) => e.id === 'm1')!.reasoningEfforts).toEqual({ off: null, medium: 'medium' })
    expect(capabilityOf(result.find((e) => e.id === 'm1')!).reasoning).toEqual(['medium'])
  })

  it('fails when the route does not exist yet', async () => {
    const settings = new FakeSettings().register('llm-pi-ai')
    await expect(saveCapabilities(settings, 'relay', [{ id: 'm', reasoning: false }])).rejects.toThrow(/路由尚未建立/)
  })

  it('retries after a revision conflict and re-reads fresh data', async () => {
    const settings = settingsWithProfile([{ id: 'm1', name: 'm1' }])
    settings.conflictOnce = true
    const result = await saveCapabilities(settings, 'relay', [{ id: 'm1', reasoning: false }])
    expect(capabilityOf(result.find((e) => e.id === 'm1')!).reasoning).toBe(false)
    const stored = settings.document['llm-pi-ai'] as { providers: { relay: { models: unknown[] } } }
    expect(stored.providers.relay.models).toHaveLength(1)
  })

  it('propagates conflict exhaustion after three attempts', async () => {
    const settings = settingsWithProfile([])
    // Conflict on every attempt: keep flipping the flag in a wrapped mutate.
    const original = settings.mutate.bind(settings)
    let calls = 0
    settings.mutate = async (ns, ops, rev) => {
      calls += 1
      settings.conflictOnce = true
      return original(ns, ops, rev)
    }
    await expect(saveCapabilities(settings, 'relay', [{ id: 'm1', reasoning: false }])).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    expect(calls).toBe(3)
  })
})

describe('syncRouteCatalog', () => {
  it('creates the route with profile fields on first sync', async () => {
    const settings = new FakeSettings().register('llm-pi-ai')
    const { written } = await syncRouteCatalog(settings, SECTION, ['alpha', 'beta'])
    expect(written).toBe(true)
    const profile = (settings.document['llm-pi-ai'] as { providers: { relay: Record<string, unknown> } }).providers.relay
    expect(profile.api).toBe('openai-completions')
    expect(profile.baseURL).toBe('http://127.0.0.1:3000/v1')
    expect(profile.apiKeyEnv).toBe('RELAY_API_KEY')
    expect((profile.models as Array<{ id: string }>).map((e) => e.id)).toEqual(['alpha', 'beta'])
  })

  it('preserves capability config and manual fields across re-syncs', async () => {
    const settings = settingsWithProfile([
      { id: 'alpha', name: 'alpha', contextWindow: 777, input: ['text', 'image'], reasoningEfforts: { off: null, high: 'high' } },
    ])
    const { models } = await syncRouteCatalog(settings, SECTION, ['alpha', 'new-one'])
    const alpha = models.find((e) => e.id === 'alpha')!
    expect(alpha.contextWindow).toBe(777)
    expect(alpha.input).toEqual(['text', 'image'])
    expect(alpha.reasoningEfforts).toEqual({ off: null, high: 'high' })
    expect(models.find((e) => e.id === 'new-one')).toBeTruthy()
  })

  it('is a no-op (no write) when nothing changed', async () => {
    const settings = new FakeSettings().register('llm-pi-ai')
    await syncRouteCatalog(settings, SECTION, ['alpha'])
    const writesBefore = settings.writes
    await syncRouteCatalog(settings, SECTION, ['alpha'])
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

describe('update payload shape', () => {
  it(' CapabilityUpdate rejects non-canonical inputs at the host boundary', () => {
    const updates: CapabilityUpdate[] = [{ id: 'x', input: ['pdf'], reasoning: false }]
    // 'pdf' is not a pi-ai modality; the update filters it out.
    const next = applyCapabilityUpdates([], updates)
    expect(next[0]!.input).toBeUndefined()
  })
})
