import { describe, expect, it, vi } from 'vitest'

import {
  isCacheStale,
  PRESET_CHECK_INTERVAL_MS,
  PRESET_REFRESH_INTERVAL_MS,
  PresetRuntime,
} from '../src/refresh.js'
import type { PanelConfig } from '../src/panels.js'
import type { ModelsDevDocument } from '../src/capabilities.js'
import type { PresetCache, PresetCacheStore } from '../src/preset-store.js'
import type { KnowledgeConfig } from '../src/knowledge.js'
import type { SettingsService } from '../src/types.js'
import { FakeSettings } from './fake-settings.js'

const PANEL: PanelConfig = {
  id: 'my-relay', baseUrl: 'https://a.example.com', relayKind: 'new-api',
  accessToken: 't', userId: 1, keyRef: 'RELAY_API_KEY_MY_RELAY', selectedKeyName: '',
}

/** Fixed "now" so staleness verdicts are deterministic. */
const NOW = Date.parse('2026-10-14T12:00:00.000Z')

function doc(): ModelsDevDocument {
  return {
    openai: {
      models: {
        'gpt-6.1': { release_date: '2026-08-01', modalities: { input: ['text'] }, reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }], limit: { context: 400000, output: 128000 } },
      },
    },
  }
}

/** The doc above builds exactly this entry set. */
const DOC_ENTRIES = { 'gpt-6.1': { input: ['text'], reasoning: ['high'], contextWindow: 400000, maxTokens: 128000 } }

interface FakeStore extends PresetCacheStore {
  saved: PresetCache[]
  failSave: boolean
}

/** In-memory PresetCacheStore with injectable save failures. */
function fakeStore(persisted: PresetCache | null): FakeStore {
  const store: FakeStore = {
    saved: [],
    failSave: false,
    load: async () => persisted,
    save: async (cache) => {
      if (store.failSave) throw new Error('disk full')
      store.saved.push(cache)
    },
    close: async () => {},
  }
  return store
}

interface Harness {
  runtime: PresetRuntime
  settings: FakeSettings
  store: FakeStore
  fetchDoc: ReturnType<typeof vi.fn>
  logger: { info: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn> }
}

/** A PresetRuntime wired like index.ts does, with fakes everywhere. */
async function harness(opts: { persisted?: PresetCache | null, seedRoute?: boolean, fetchDoc?: () => Promise<ModelsDevDocument> } = {}): Promise<Harness> {
  const settings = new FakeSettings().register('relay').register('llm-pi-ai')
  if (opts.seedRoute !== false) {
    void settings.seed('llm-pi-ai', {
      providers: {
        [PANEL.id]: {
          api: 'openai-completions', baseURL: 'https://a.example.com/v1', apiKeyEnv: PANEL.keyRef,
          models: [{ id: 'gpt-6.1', name: 'gpt-6.1', contextWindow: 12345, maxTokens: 8192 }],
        },
      },
    })
  }
  const store = fakeStore(opts.persisted ?? null)
  const fetchDoc = vi.fn(opts.fetchDoc ?? (async () => doc()))
  const logger = { info: vi.fn(), warn: vi.fn() }
  let runtime!: PresetRuntime
  runtime = new PresetRuntime({
    fetchDoc: fetchDoc as () => Promise<ModelsDevDocument>,
    settings: () => settings,
    panels: () => [PANEL],
    knowledge: (): KnowledgeConfig => ({
      capabilityCatalog: {},
      capabilityOverrides: {},
      capabilityPreset: runtime.effectivePreset(),
    }),
    logger,
    now: () => NOW,
  })
  // Wire the persistence seam like the storage inject does.
  await runtime.attach(store)
  return { runtime, settings, store, fetchDoc, logger }
}

function routeModels(settings: SettingsService): Array<Record<string, unknown>> {
  return (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers[PANEL.id]!.models
}

describe('isCacheStale (the daily boundary is inclusive)', () => {
  it('a cache exactly INTERVAL old is stale; one ms newer is not', () => {
    expect(isCacheStale(NOW - PRESET_REFRESH_INTERVAL_MS, NOW)).toBe(true)
    expect(isCacheStale(NOW - PRESET_REFRESH_INTERVAL_MS + 1, NOW)).toBe(false)
  })

  it('missing (epoch 0) stamps read as stale', () => {
    expect(isCacheStale(0, NOW)).toBe(true)
  })
})

describe('PresetRuntime.refresh — the single-flight chain', () => {
  it('first fetch: memory layer visible at once, cache persisted, route replayed', async () => {
    const h = await harness()
    const result = await h.runtime.refresh()
    expect(result).toMatchObject({ count: 1, fetchedAt: NOW, replayed: true })
    // the response carries no delta concept anymore (count/fetchedAt/replayed)
    expect(Object.keys(result).sort()).toEqual(['count', 'fetchedAt', 'replayed'])
    // persisted as the whole cache (fetchedAt + entries) — not a delta
    expect(h.store.saved).toEqual([{ fetchedAt: NOW, entries: DOC_ENTRIES }])
    // the memory layer feeds derivations immediately
    expect(h.runtime.effectivePreset()).toEqual(DOC_ENTRIES)
    // THE v0.5.1 gap stays closed: the route entry carries the new derivation
    const models = routeModels(h.settings)
    expect(models[0]).toMatchObject({ contextWindow: 400000, maxTokens: 128000 })
    expect(models[0]!.reasoningEfforts).toEqual({ off: null, high: 'high' })
  })

  it('unchanged entries still save (fetchedAt renews) but skip the replay', async () => {
    const h = await harness({ persisted: { fetchedAt: NOW - 2 * PRESET_REFRESH_INTERVAL_MS, entries: DOC_ENTRIES } })
    expect(h.runtime.effectivePreset()).toEqual(DOC_ENTRIES)
    const writesBefore = h.settings.writes
    const result = await h.runtime.refresh()
    expect(result.count).toBe(1)
    expect(h.store.saved).toEqual([{ fetchedAt: NOW, entries: DOC_ENTRIES }])
    expect(h.settings.writes).toBe(writesBefore) // zero llm-pi-ai revisions spent
  })

  it('a fetch failure keeps the memory layer, records lastError, and does not save', async () => {
    const h = await harness({
      persisted: { fetchedAt: NOW - 1000, entries: { 'gpt-6.1': { contextWindow: 111000 } } },
      fetchDoc: async () => {
        throw new Error('network down')
      },
    })
    await expect(h.runtime.refresh()).rejects.toThrow('network down')
    expect(h.runtime.effectivePreset()).toEqual({ 'gpt-6.1': { contextWindow: 111000 } })
    expect(h.runtime.presetMeta()).toMatchObject({ count: 1, lastError: 'network down' })
    expect(h.store.saved).toEqual([])
  })

  it('a save failure warns but keeps the new memory layer and still reports ok', async () => {
    const h = await harness()
    h.store.failSave = true
    const result = await h.runtime.refresh()
    expect(result.replayed).toBe(true)
    expect(h.runtime.effectivePreset()).toEqual(DOC_ENTRIES)
    expect(h.runtime.presetMeta().lastError).toBeUndefined()
    expect(h.logger.warn).toHaveBeenCalledWith('relay: 预置缓存持久化失败(内存层已更新)', expect.any(Error))
  })

  it('a replay failure reports readably without rolling the saved cache back', async () => {
    const other: PanelConfig = { ...PANEL, id: 'other' }
    const settings = new FakeSettings().register('relay').register('llm-pi-ai')
    void settings.seed('llm-pi-ai', {
      providers: {
        [PANEL.id]: { models: [{ id: 'gpt-6.1', name: 'gpt-6.1' }] },
        [other.id]: { models: [{ id: 'gpt-6.1', name: 'gpt-6.1' }] },
      },
    })
    const store = fakeStore(null)
    const fetchDoc = vi.fn(async () => doc())
    let runtime!: PresetRuntime
    runtime = new PresetRuntime({
      fetchDoc: fetchDoc as () => Promise<ModelsDevDocument>,
      settings: () => settings,
      panels: () => [PANEL, other],
      knowledge: (): KnowledgeConfig => ({
        capabilityCatalog: {},
        capabilityOverrides: {},
        capabilityPreset: runtime.effectivePreset(),
      }),
      now: () => NOW,
    })
    await runtime.attach(store)
    // A conflict exhausting its retries on one route: the llm-pi-ai namespace
    // disappears from describe after its first successful replay write — the
    // second panel's replay then fails its descriptor lookup.
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
    const result = await runtime.refresh()
    expect(result.replayed).toBe(false)
    expect(result.replayError).toContain(other.id)
    // the cache stays persisted and in memory despite the replay failure
    expect(store.saved.length).toBe(1)
    expect(runtime.effectivePreset()).toEqual(DOC_ENTRIES)
    // and the route that did replay carries the fresh derivation
    const first = (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers[PANEL.id].models
    expect(first[0]!.contextWindow).toBe(400000)
  })

  it('concurrent triggers collapse into one chain; a later trigger starts a new one', async () => {
    let release!: (value: ModelsDevDocument) => void
    const gate = new Promise<ModelsDevDocument>((resolve) => {
      release = resolve
    })
    const h = await harness({ fetchDoc: () => gate })
    // manual + startup + timer shapes all funnel into the same chain
    const manual = h.runtime.refresh()
    const tick = h.runtime.backgroundCheck()
    const manualAgain = h.runtime.refresh()
    release(doc())
    const results = await Promise.all([manual, manualAgain])
    await tick
    expect(h.fetchDoc).toHaveBeenCalledTimes(1)
    expect(h.store.saved.length).toBe(1)
    expect(new Set(results.map((r) => r.fetchedAt)).size).toBe(1)
    // after the chain settles, a new trigger starts a fresh chain
    await h.runtime.refresh()
    expect(h.fetchDoc).toHaveBeenCalledTimes(2)
  })
})

describe('PresetRuntime — triggers and lifecycle', () => {
  it('backgroundCheck fetches only when the cache is missing or a day old', async () => {
    const fresh = await harness({ persisted: { fetchedAt: NOW - 1000, entries: DOC_ENTRIES } })
    await fresh.runtime.backgroundCheck()
    expect(fresh.fetchDoc).not.toHaveBeenCalled()
    // exactly a day old → stale (inclusive boundary)
    const stale = await harness({ seedRoute: false, persisted: { fetchedAt: NOW - PRESET_REFRESH_INTERVAL_MS, entries: DOC_ENTRIES } })
    await stale.runtime.backgroundCheck()
    expect(stale.fetchDoc).toHaveBeenCalledTimes(1)
  })

  it('the startup check fires once settings and storage both settled', async () => {
    // harness() attached the store (storage settled); settings not ready yet
    const h = await harness()
    expect(h.fetchDoc).not.toHaveBeenCalled()
    h.runtime.noteSettingsReady()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.fetchDoc).toHaveBeenCalledTimes(1) // no cache → immediate fetch
  })

  it('attach adopts the persisted cache only when it is newer than memory', async () => {
    const h = await harness()
    // memory holds a fresh manual fetch; an older persisted cache must not win
    await h.runtime.refresh()
    const older = { fetchedAt: NOW - PRESET_REFRESH_INTERVAL_MS, entries: { stale: { contextWindow: 1 } } }
    await h.runtime.attach(fakeStore(older))
    expect(h.runtime.effectivePreset()).toEqual(DOC_ENTRIES)
    // a persisted cache newer than memory does win
    const newer = { fetchedAt: NOW + 1000, entries: { fresh: { contextWindow: 2 } } }
    await h.runtime.attach(fakeStore(newer))
    expect(h.runtime.effectivePreset()).toEqual({ fresh: { contextWindow: 2 } })
  })

  it('presetMeta walks its three states', async () => {
    const h = await harness()
    expect(h.runtime.presetMeta()).toEqual({ count: 0 }) // no cache
    await h.runtime.refresh()
    expect(h.runtime.presetMeta()).toEqual({ count: 1, fetchedAt: NOW }) // cached
    const failing = await harness({ fetchDoc: async () => {
      throw new Error('boom')
    } })
    await failing.runtime.refresh().catch(() => {})
    expect(failing.runtime.presetMeta()).toEqual({ count: 0, lastError: 'boom' }) // no cache + error
  })

  it('a success after a failure clears lastError', async () => {
    let fail = true
    const h = await harness({ fetchDoc: async () => {
      if (fail) throw new Error('flaky')
      return doc()
    } })
    await h.runtime.refresh().catch(() => {})
    expect(h.runtime.presetMeta().lastError).toBe('flaky')
    fail = false
    await h.runtime.refresh()
    expect(h.runtime.presetMeta().lastError).toBeUndefined()
  })

  it('dispose stops the ticker and closes the store unit', async () => {
    const h = await harness()
    let tickerStopped = false
    h.runtime.startPeriodicCheck(() => () => {
      tickerStopped = true
    })
    const closed = vi.fn(async () => {})
    await h.runtime.attach({ load: async () => null, save: async () => {}, close: closed })
    h.runtime.dispose()
    expect(tickerStopped).toBe(true)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(PRESET_CHECK_INTERVAL_MS).toBe(60 * 60 * 1000) // hourly granularity
  })
})
