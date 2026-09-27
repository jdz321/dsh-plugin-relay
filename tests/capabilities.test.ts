import { describe, expect, it } from 'vitest'

import { ModelsDevClient, mapModelsDevEntry, mergeSuggestions } from '../src/capabilities.js'

describe('mapModelsDevEntry (models.dev → capability suggestion)', () => {
  it('maps effort options onto pi-ai levels, intersecting with the supported set', () => {
    const entry = {
      modalities: { input: ['text', 'image', 'pdf'] },
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['minimal', 'low', 'medium', 'high', 'unheard'] }],
    }
    expect(mapModelsDevEntry(entry)).toEqual({
      input: ['text', 'image'],
      reasoning: { levels: ['minimal', 'low', 'medium', 'high'] },
    })
  })

  it('maps reasoning false to an explicit non-reasoning suggestion', () => {
    expect(mapModelsDevEntry({ modalities: { input: ['text'] }, reasoning: false })).toEqual({
      input: ['text'],
      reasoning: false,
    })
  })

  it('maps toggle reasoning to the middle level as a starting point', () => {
    expect(mapModelsDevEntry({ modalities: { input: ['text'] }, reasoning: true, reasoning_options: [{ type: 'toggle' }] })).toEqual({
      input: ['text'],
      reasoning: { levels: ['medium'] },
    })
  })

  it('maps budget_tokens reasoning (anthropic style) like a toggle', () => {
    expect(mapModelsDevEntry({ modalities: { input: ['text', 'image', 'pdf'] }, reasoning: true, reasoning_options: [{ type: 'budget_tokens', min: 1024 }] })).toEqual({
      input: ['text', 'image'],
      reasoning: { levels: ['medium'] },
    })
  })

  it('returns null when the entry carries nothing usable', () => {
    expect(mapModelsDevEntry(undefined)).toBeNull()
    expect(mapModelsDevEntry({})).toBeNull()
    expect(mapModelsDevEntry({ modalities: { input: ['pdf', 'video'] } })).toBeNull()
  })
})

describe('mergeSuggestions (same id under several providers)', () => {
  it('unions modalities; a concrete effort ladder wins over toggle and false', () => {
    const merged = mergeSuggestions([
      { input: ['text'], reasoning: false },
      { input: ['text', 'image'], reasoning: { levels: ['low'] } },
      { input: ['text'], reasoning: { levels: ['medium'] } },
    ])
    expect(merged).toEqual({ input: ['text', 'image'], reasoning: { levels: ['low'] } })
  })

  it('keeps false when no provider declares a ladder', () => {
    expect(mergeSuggestions([{ input: ['text'], reasoning: false }, { input: [], reasoning: null }])).toEqual({
      input: ['text'],
      reasoning: false,
    })
  })

  it('returns null when nothing is usable', () => {
    expect(mergeSuggestions([null, null])).toBeNull()
  })
})

describe('mapModelsDevEntry context window (limit.context)', () => {
  it('extracts the context window for the knowledge base default', () => {
    const entry = {
      modalities: { input: ['text'] },
      reasoning: false,
      limit: { context: 131072, output: 8192 },
    }
    expect(mapModelsDevEntry(entry)).toEqual({ input: ['text'], reasoning: false, contextWindow: 131072, maxTokens: 8192 })
  })

  it('extracts limit.output as maxTokens when it is a positive integer; merges the largest', () => {
    expect(mapModelsDevEntry({ modalities: { input: ['text'] }, limit: { context: 1000, output: 0 } })?.maxTokens).toBeUndefined()
    expect(mapModelsDevEntry({ modalities: { input: ['text'] }, limit: { context: 1000, output: 1.5 } })?.maxTokens).toBeUndefined()
    const merged = mergeSuggestions([
      mapModelsDevEntry({ modalities: { input: ['text'] }, limit: { context: 1000, output: 8192 } }),
      mapModelsDevEntry({ modalities: { input: ['text'] }, limit: { context: 1000, output: 65536 } }),
    ])
    expect(merged?.maxTokens).toBe(65536)
    expect(merged?.contextWindow).toBe(1000)
    expect(mergeSuggestions([mapModelsDevEntry({ modalities: { input: ['text'] } })])?.maxTokens).toBeUndefined()
  })

  it('ignores missing or non-positive limits; keeps entries with data otherwise', () => {
    expect(mapModelsDevEntry({ modalities: { input: ['text'] }, limit: {} })).toEqual({ input: ['text'], reasoning: null })
    expect(mapModelsDevEntry({ limit: { context: 0 } })).toBeNull()
    expect(mapModelsDevEntry({ limit: { context: Number.NaN } })).toBeNull()
  })

  it('merges context windows across providers, preferring the largest known', () => {
    const merged = mergeSuggestions([
      { input: ['text'], reasoning: false, contextWindow: 131072 },
      { input: ['text'], reasoning: false, contextWindow: 1_048_576 },
    ])
    expect(merged).toEqual({ input: ['text'], reasoning: false, contextWindow: 1_048_576 })
  })
})

describe('ModelsDevClient', () => {
  it('looks up a model across providers and merges', async () => {
    const client = new ModelsDevClient({
      fetchDoc: async () => ({
        'provider-a': { models: { 'm-1': { modalities: { input: ['text'] }, reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }] } } },
        'provider-b': { models: { 'm-1': { modalities: { input: ['text', 'image'] } } } },
      }),
    })
    await expect(client.suggest('m-1')).resolves.toEqual({ input: ['text', 'image'], reasoning: { levels: ['high'] } })
  })

  it('resolves {miss:true} for unknown ids and fetch failures — never throws', async () => {
    const failing = new ModelsDevClient({ fetchDoc: async () => { throw new Error('offline') } })
    await expect(failing.suggest('anything')).resolves.toEqual({ miss: true })

    const empty = new ModelsDevClient({ fetchDoc: async () => ({ 'p': { models: {} } }) })
    await expect(empty.suggest('nope')).resolves.toEqual({ miss: true })
  })

  it('serves repeated lookups from cache and refreshes after the TTL', async () => {
    let fetches = 0
    let now = 1_000_000
    const client = new ModelsDevClient({
      ttlMs: 1000,
      now: () => now,
      fetchDoc: async () => {
        fetches += 1
        return { p: { models: { m: { modalities: { input: ['text'] }, reasoning: false } } } }
      },
    })
    await client.suggest('m')
    await client.suggest('m')
    await client.suggest('m')
    expect(fetches).toBe(1)
    now += 2000
    await client.suggest('m')
    expect(fetches).toBe(2)
  })

  it('keeps serving a stale document when a refresh fails', async () => {
    let fetches = 0
    let now = 1_000_000
    const client = new ModelsDevClient({
      ttlMs: 1000,
      now: () => now,
      fetchDoc: async () => {
        fetches += 1
        if (fetches === 1) return { p: { models: { m: { modalities: { input: ['text'] }, reasoning: false } } } }
        throw new Error('offline')
      },
    })
    await expect(client.suggest('m')).resolves.not.toEqual({ miss: true })
    now += 2000
    await expect(client.suggest('m')).resolves.toEqual({ input: ['text'], reasoning: false })
  })
})

describe('ModelsDevClient.refresh (刷新预置: bypass TTL, fail hard, single-flight)', () => {
  it('forces a fetch even inside the TTL window', async () => {
    let fetches = 0
    const client = new ModelsDevClient({
      ttlMs: 60_000,
      fetchDoc: async () => {
        fetches += 1
        return { p: { models: { m: { modalities: { input: ['text'] }, reasoning: false, limit: { context: fetches * 1000 } } } } }
      },
    })
    await client.suggest('m')
    expect(fetches).toBe(1)
    const doc = await client.refresh()
    expect(fetches).toBe(2)
    expect(doc.p!.models!.m!.limit!.context).toBe(2000)
    // the fresh document now also serves the regular cache
    await expect(client.suggest('m')).resolves.toMatchObject({ contextWindow: 2000 })
  })

  it('throws on failure so the caller can show a retryable error, and keeps the stale cache for suggest()', async () => {
    let fetches = 0
    const client = new ModelsDevClient({
      ttlMs: 60_000,
      fetchDoc: async () => {
        fetches += 1
        if (fetches === 1) return { p: { models: { m: { modalities: { input: ['text'] }, reasoning: false } } } }
        throw new Error('offline')
      },
    })
    await client.suggest('m')
    await expect(client.refresh()).rejects.toThrow('offline')
    await expect(client.suggest('m')).resolves.toEqual({ input: ['text'], reasoning: false })
  })

  it('shares one in-flight fetch across concurrent refresh calls', async () => {
    let fetches = 0
    const client = new ModelsDevClient({
      ttlMs: 60_000,
      fetchDoc: async () => {
        fetches += 1
        await new Promise((resolve) => { setTimeout(resolve, 5) })
        return { p: { models: {} } }
      },
    })
    await client.refresh()
    await Promise.all([client.refresh(), client.refresh(), client.refresh()])
    expect(fetches).toBe(2)
  })
})
