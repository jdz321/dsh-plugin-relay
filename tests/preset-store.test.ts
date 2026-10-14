import { describe, expect, it, vi } from 'vitest'

import {
  normalizePresetCache,
  PRESET_UNIT_DESCRIPTOR,
  StoragePresetCacheStore,
  STORAGE_JSON_SERVICE_KEY,
  type PresetCache,
} from '../src/preset-store.js'
import type { KvFacet, KvUnit } from '@deepseek-ai/dsh-storage'

const CACHE: PresetCache = {
  fetchedAt: 1_700_000_000_000,
  entries: { 'gpt-6.1': { contextWindow: 400000, maxTokens: 128000 } },
}

describe('normalizePresetCache (bad mediums read as no cache)', () => {
  it('accepts a full cache verbatim', () => {
    expect(normalizePresetCache(CACHE)).toEqual(CACHE)
  })

  it('rejects undefined / null / non-objects / arrays', () => {
    expect(normalizePresetCache(undefined)).toBeNull()
    expect(normalizePresetCache(null)).toBeNull()
    expect(normalizePresetCache('junk')).toBeNull()
    expect(normalizePresetCache(42)).toBeNull()
    expect(normalizePresetCache([CACHE])).toBeNull()
  })

  it('rejects a missing or non-object entries dict', () => {
    expect(normalizePresetCache({ fetchedAt: 1 })).toBeNull()
    expect(normalizePresetCache({ fetchedAt: 1, entries: 'junk' })).toBeNull()
    expect(normalizePresetCache({ fetchedAt: 1, entries: [] })).toBeNull()
    expect(normalizePresetCache({ fetchedAt: 1, entries: null })).toBeNull()
  })

  it('rejects an invalid fetchedAt', () => {
    expect(normalizePresetCache({ entries: {} })).toBeNull()
    expect(normalizePresetCache({ fetchedAt: 0, entries: {} })).toBeNull()
    expect(normalizePresetCache({ fetchedAt: -1, entries: {} })).toBeNull()
    expect(normalizePresetCache({ fetchedAt: 'yesterday', entries: {} })).toBeNull()
  })
})

/** StorageError-shaped rejection (the json backend's medium verdicts). */
function storageError(code: string): Error {
  const err = new Error(code)
  ;(err as Error & { code: string }).code = code
  return err
}

/** In-memory KV unit standing in for the json backend's handle. */
class FakeKvUnit implements KvUnit {
  global: unknown = null
  closedCount = 0
  loadAllCalls = 0
  setGlobalCalls: unknown[] = []

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>, global: unknown }> {
    this.loadAllCalls += 1
    if (this.closedCount > 0) throw storageError('closed')
    return { tables: {}, global: this.global }
  }

  async putRecord(): Promise<void> {
    throw new Error('unused')
  }

  async deleteRecord(): Promise<void> {
    throw new Error('unused')
  }

  async setGlobal(value: unknown): Promise<void> {
    this.setGlobalCalls.push(value)
    this.global = value
  }

  async close(): Promise<void> {
    this.closedCount += 1
  }
}

function fakeKv(unit: FakeKvUnit, opts: { openError?: Error, openDelayMs?: number } = {}): KvFacet {
  return {
    open: async () => {
      if (opts.openError) throw opts.openError
      if (opts.openDelayMs) await new Promise((resolve) => setTimeout(resolve, opts.openDelayMs))
      return unit
    },
  }
}

describe('StoragePresetCacheStore (production store over a fake KvUnit)', () => {
  it('descriptor: unit relay_preset, version 1, global slot, single layout', () => {
    // `single` reads match versions STRICTLY — version stays fixed at 1 so an
    // upgraded plugin never bricks the medium (version-mismatch = human reset).
    expect(PRESET_UNIT_DESCRIPTOR).toMatchObject({ name: 'relay_preset', version: 1, tables: [], hasGlobal: true, layout: 'single' })
    expect(PRESET_UNIT_DESCRIPTOR.name).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('service key is the json backend lifecycle key', () => {
    expect(STORAGE_JSON_SERVICE_KEY).toBe('storage.backend.json')
  })

  it('load returns the normalized global slot', async () => {
    const unit = new FakeKvUnit()
    unit.global = CACHE
    const store = new StoragePresetCacheStore(fakeKv(unit))
    expect(await store.load()).toEqual(CACHE)
  })

  it('load reads a never-written or invalid medium as null', async () => {
    const empty = new StoragePresetCacheStore(fakeKv(new FakeKvUnit()))
    expect(await empty.load()).toBeNull()
    const junk = new FakeKvUnit()
    junk.global = { fetchedAt: 'nope' }
    expect(await new StoragePresetCacheStore(fakeKv(junk)).load()).toBeNull()
  })

  it('load swallows version-mismatch and malformed-medium rejections (warn, null)', async () => {
    for (const code of ['version-mismatch', 'malformed-medium']) {
      const logger = { info: vi.fn(), warn: vi.fn() }
      const store = new StoragePresetCacheStore(fakeKv(new FakeKvUnit(), { openError: storageError(code) }), logger)
      expect(await store.load()).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(String(logger.warn.mock.calls[0]![0])).toContain('relay_preset.json')
    }
  })

  it('save passes the cache straight through setGlobal; the unit opens once', async () => {
    const unit = new FakeKvUnit()
    let opens = 0
    const kv: KvFacet = {
      open: async () => {
        opens += 1
        return unit
      },
    }
    const store = new StoragePresetCacheStore(kv)
    await store.save(CACHE)
    await store.save({ ...CACHE, fetchedAt: CACHE.fetchedAt + 1 })
    expect(opens).toBe(1)
    expect(unit.setGlobalCalls).toEqual([CACHE, { ...CACHE, fetchedAt: CACHE.fetchedAt + 1 }])
  })

  it('a load followed by a save reuses the same serialized open (concurrent open rejected by the backend)', async () => {
    const unit = new FakeKvUnit()
    let opens = 0
    const kv: KvFacet = {
      open: async () => {
        opens += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return unit
      },
    }
    const store = new StoragePresetCacheStore(kv)
    const [loaded] = await Promise.all([store.load(), store.save(CACHE)])
    expect(loaded).toBeNull() // empty medium
    expect(opens).toBe(1)
    expect(unit.setGlobalCalls).toEqual([CACHE])
  })

  it('save propagates open failures to the caller (the runtime warns and keeps memory)', async () => {
    const store = new StoragePresetCacheStore(fakeKv(new FakeKvUnit(), { openError: storageError('malformed-medium') }))
    await expect(store.save(CACHE)).rejects.toThrow('malformed-medium')
  })

  it('close is idempotent and closes the unit exactly once per handle', async () => {
    const unit = new FakeKvUnit()
    const store = new StoragePresetCacheStore(fakeKv(unit))
    await store.save(CACHE)
    await store.close()
    await store.close()
    expect(unit.closedCount).toBe(1)
  })
})
