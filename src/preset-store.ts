/**
 * The persistent home of the runtime preset cache (v0.7.1): dsh's storage
 * stack — the json backend dsh-base mounts for every base-backed profile,
 * keeping one human-readable, atomically published `<unit>.json` document per
 * unit under `<DSH_HOME>/storages/`. The cache lives in unit `relay_preset`'s
 * GLOBAL slot; values are opaque JSON to the storage layer, so validation is
 * ours (normalizePresetCache).
 *
 * The `single` layout matches unit versions STRICTLY (no compatibleVersions
 * path), so the descriptor version is fixed at 1 and never migrates: a
 * `version-mismatch` (foreign stamp) or `malformed-medium` (unparseable file)
 * rejection means a human resets the medium by hand — surfaced as a warn with
 * the file name; deleting the file makes the next open materialize an empty
 * unit (self-healing). The backend allows exactly one live handle per unit
 * name, so the handle opens once and is reused; a failed open leaves nothing
 * behind and the next load/save retries it.
 */

import {
  storageBackendServiceKey,
  type KvFacet,
  type KvUnit,
  type KvUnitDescriptor,
} from '@deepseek-ai/dsh-storage'

import type { PresetEntry } from './knowledge-preset.js'

/** The cached preset document: one models.dev fetch, ready for reuse. */
export interface PresetCache {
  fetchedAt: number
  entries: Record<string, PresetEntry>
}

/** The unit the cache persists in (global slot; one JSON file on disk). */
export const PRESET_UNIT_DESCRIPTOR: KvUnitDescriptor = {
  name: 'relay_preset',
  version: 1,
  tables: [],
  hasGlobal: true,
  layout: 'single',
}

/**
 * Lifecycle service key of the json backend (`storage.backend.json`). The
 * backend plugin provides it on registration, so injecting it alongside the
 * hub gates our open on backend readiness without racing it.
 */
export const STORAGE_JSON_SERVICE_KEY = storageBackendServiceKey('json')

/**
 * Validate a raw stored cache; null for anything unusable (absent, non-object,
 * bad fetchedAt, non-object entries). The entries were built by
 * buildPresetEntries before persisting, so their inner shape is trusted.
 */
export function normalizePresetCache(raw: unknown): PresetCache | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const fetchedAt = Number(record.fetchedAt)
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null
  const entries = record.entries
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return null
  return { fetchedAt, entries: entries as Record<string, PresetEntry> }
}

/** The persistence seam the refresh runtime consumes (tests fake this). */
export interface PresetCacheStore {
  /** Hydrate: cache missing / invalid / medium rejected / stack gone → null (tolerated inside). */
  load(): Promise<PresetCache | null>
  /** Persist; any failure THROWS — callers warn and carry on (the memory layer is already updated). */
  save(cache: PresetCache): Promise<void>
  /** Close the unit with the fiber teardown (idempotent). */
  close(): Promise<void>
}

/** Minimal logger surface open failures report through. */
export interface StoreLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

/** One-line readable error text for logs. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Production store over the storage stack's KV facet. `kv.open` rejects a
 * unit name that is already open (or opening), so opens are serialized and
 * the winning handle is cached for the store's lifetime.
 */
export class StoragePresetCacheStore implements PresetCacheStore {
  private unit: KvUnit | null = null
  private opening: Promise<KvUnit> | null = null

  constructor(
    private readonly kv: KvFacet,
    private readonly logger?: StoreLogger,
  ) {}

  /** The unit handle, opened at most once at a time (reused afterwards). */
  private handle(): Promise<KvUnit> {
    if (this.unit) return Promise.resolve(this.unit)
    if (!this.opening) {
      this.opening = this.kv.open(PRESET_UNIT_DESCRIPTOR)
        .then((unit) => {
          this.unit = unit
          return unit
        })
        .finally(() => {
          this.opening = null
        })
    }
    return this.opening
  }

  async load(): Promise<PresetCache | null> {
    let unit: KvUnit
    try {
      unit = await this.handle()
    } catch (err) {
      // malformed-medium / version-mismatch / already-open races: this round
      // runs memory-only; the medium resets by deleting the file by hand.
      this.logger?.warn(
        `relay: 打开预置缓存失败(${errorText(err)})——可手工删除 dsh storages 目录下的 relay_preset.json 重置`,
        err,
      )
      return null
    }
    try {
      const snapshot = await unit.loadAll()
      return normalizePresetCache(snapshot.global)
    } catch (err) {
      this.logger?.warn(`relay: 读取预置缓存失败(${errorText(err)})`, err)
      return null
    }
  }

  async save(cache: PresetCache): Promise<void> {
    // Open failures propagate: the caller warns and keeps the memory layer.
    const unit = await this.handle()
    await unit.setGlobal(cache)
  }

  async close(): Promise<void> {
    const handle = this.unit ?? await this.opening?.catch(() => null) ?? null
    this.unit = null
    if (handle) await handle.close()
  }
}
