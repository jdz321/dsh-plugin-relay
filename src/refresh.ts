/**
 * The runtime preset layer (v0.7.1). The compiled-in baseline is gone: the
 * preset is FETCHED AT RUNTIME from models.dev with the same mainstream rules
 * (buildPresetEntries), held in a process-local MEMORY layer every route
 * handler reads synchronously, persisted through the dsh storage stack
 * (`relay_preset` unit, see preset-store.ts), and refreshed automatically at
 * most once every PRESET_REFRESH_INTERVAL_MS.
 *
 * Three trigger faces share one single-flight chain (concurrent triggers —
 * startup, the hourly staleness ticker, the manual 刷新预置 button — collapse
 * into at most one 取数 → 写缓存 → 重放 pass, which also satisfies the KV
 * unit's "concurrent writes are the caller's problem" contract):
 *
 *  1. startup check — fires once the settings store AND the persistent cache
 *     are both wired (a missing storage stack degrades to memory-only after a
 *     grace period and still runs the check);
 *  2. a periodic staleness check (hourly) — long-running hosts refresh daily
 *     without a restart;
 *  3. the manual route — bypasses the staleness verdict and forces a fetch.
 *
 * Failure paths never roll anything back: a fetch failure keeps the memory
 * layer as-is and records `lastError` for the status line; a persistence
 * failure warns and keeps the (already updated) memory layer; a replay
 * failure is reported readably while the saved cache stays.
 */

import type { ModelsDevDocument } from './capabilities.js'
import { buildPresetEntries, type PresetEntry } from './knowledge-preset.js'
import { knowledgeForPanel, type KnowledgeConfig } from './knowledge.js'
import type { PanelConfig } from './panels.js'
import { normalizePresetCache, type PresetCache, type PresetCacheStore } from './preset-store.js'
import { replayRouteCapabilities } from './route-config.js'
import type { SettingsService } from './types.js'

/** How often the preset refreshes itself (24h; the named single source). */
export const PRESET_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Background staleness checks run at this granularity (also the retry rhythm after a failure). */
export const PRESET_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Startup grace before a missing storage stack degrades to memory-only. */
const STORAGE_GRACE_MS = 10_000

/**
 * Stale verdict: a cache fetched exactly INTERVAL ago counts as stale (the
 * daily boundary is inclusive by spec).
 */
export function isCacheStale(fetchedAt: number, now: number): boolean {
  return now - fetchedAt >= PRESET_REFRESH_INTERVAL_MS
}

/** Order-independent JSON form of one entry (the skip-replay comparison). */
function canonicalEntry(entry: PresetEntry): string {
  return JSON.stringify(entry, Object.keys(entry).sort())
}

/** Deep-equal verdict over two entry dicts (same names, same values). */
function sameEntries(a: Record<string, PresetEntry>, b: Record<string, PresetEntry>): boolean {
  const names = Object.keys(a)
  if (names.length !== Object.keys(b).length) return false
  for (const name of names) {
    const other = b[name]
    if (other === undefined || canonicalEntry(a[name]!) !== canonicalEntry(other)) return false
  }
  return true
}

/** Status metadata for the capabilities view (three states, §5.1). */
export interface PresetMeta {
  count: number
  fetchedAt?: number
  lastError?: string
}

/** What one completed refresh chain reports (the manual route's response body). */
export interface PresetRefreshResult {
  /** Entry count of this fetch. */
  count: number
  /** When this fetch landed (unix ms). */
  fetchedAt: number
  /** True when every configured panel route replayed without error. */
  replayed: boolean
  /** First replay failure, when any. */
  replayError?: string
}

/** Everything the runtime pulls at call time (all lazy — wiring order free). */
export interface PresetRuntimeDeps {
  fetchDoc: () => Promise<ModelsDevDocument>
  /** The settings facade for route replays; null until the settings inject wires it. */
  settings: () => SettingsService | null
  panels: () => readonly PanelConfig[]
  /** Current knowledge view (reads the memory layer through effectivePreset). */
  knowledge: () => KnowledgeConfig
  logger?: { info(message: string, ...args: unknown[]): void, warn(message: string, ...args: unknown[]): void }
  now?: () => number
}

export class PresetRuntime {
  private cache: PresetCache | null = null
  private lastError: string | null = null
  private chain: Promise<PresetRefreshResult> | null = null
  private cacheStore: PresetCacheStore | null = null
  private storageSettled = false
  private settingsSettled = false
  private startupFired = false
  private graceTimer: ReturnType<typeof setTimeout> | null = null
  private tickerStop: (() => void) | null = null

  constructor(private readonly deps: PresetRuntimeDeps) {}

  /** The effective preset layer — synchronous, offline, a pure memory read. */
  effectivePreset(): Record<string, PresetEntry> {
    return this.cache?.entries ?? {}
  }

  /** The capabilities view's status line data (no cache → count 0, no fetchedAt). */
  presetMeta(): PresetMeta {
    const cache = this.cache
    if (cache === null) {
      return { count: 0, ...(this.lastError !== null ? { lastError: this.lastError } : {}) }
    }
    return {
      count: Object.keys(cache.entries).length,
      fetchedAt: cache.fetchedAt,
      ...(this.lastError !== null ? { lastError: this.lastError } : {}),
    }
  }

  /**
   * Wire the persistent store (from the storage inject) and hydrate. A
   * persisted cache newer than whatever memory already holds wins (the
   * startup fetch may have beaten a slow storage inject).
   */
  async attach(cacheStore: PresetCacheStore): Promise<void> {
    this.cacheStore = cacheStore
    const persisted = await cacheStore.load()
    this.storageSettled = true
    if (persisted !== null && (this.cache === null || persisted.fetchedAt > this.cache.fetchedAt)) {
      this.cache = normalizePresetCache(persisted) ?? this.cache
    }
    this.maybeStartupCheck()
  }

  /** Mark the settings side ready and schedule the startup check. */
  noteSettingsReady(): void {
    this.settingsSettled = true
    if (!this.storageSettled && this.graceTimer === null) {
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null
        if (!this.storageSettled) {
          this.deps.logger?.info('relay: 预置缓存存储不可用,仅使用内存层(重启后丢失)')
          this.maybeStartupCheck(true)
        }
      }, STORAGE_GRACE_MS)
    }
    this.maybeStartupCheck()
  }

  /** Start the hourly staleness ticker (once); `register` owns the timer lifecycle. */
  startPeriodicCheck(register: (callback: () => void, delay: number) => () => void): void {
    if (this.tickerStop !== null) return
    this.tickerStop = register(() => {
      void this.backgroundCheck().catch((err) => {
        this.deps.logger?.warn('relay: 预置后台刷新失败(下个周期重试)', err)
      })
    }, PRESET_CHECK_INTERVAL_MS)
  }

  /** One staleness check: fetch when the cache is missing or a day old. */
  async backgroundCheck(): Promise<void> {
    const cache = this.cache
    if (cache === null || isCacheStale(cache.fetchedAt, (this.deps.now ?? Date.now)())) {
      await this.refresh()
    }
  }

  /**
   * The refresh chain, single-flight across every trigger: concurrent callers
   * piggyback the in-flight chain (it is by construction a fresh fetch).
   * Fetching is unconditional here — the staleness gate belongs to the
   * callers (backgroundCheck); the manual route bypasses it by design.
   */
  refresh(): Promise<PresetRefreshResult> {
    if (this.chain) return this.chain
    const run = this.runChain().catch((err) => {
      // Fetch/build failure: the memory layer stays as-is; the next periodic
      // tick retries. Surface the readable cause on the status line.
      this.lastError = err instanceof Error ? err.message : String(err)
      throw err
    })
    this.chain = run
    return run.finally(() => {
      if (this.chain === run) this.chain = null
    })
  }

  private async runChain(): Promise<PresetRefreshResult> {
    const now = this.deps.now ?? Date.now
    const doc = await this.deps.fetchDoc()
    const built = buildPresetEntries(doc, { now: now() })
    const fetchedAt = now()
    const previous = this.cache
    // Memory first: every synchronous consumer (capabilities view, route
    // replays) sees the new layer even when persistence later fails.
    this.cache = { fetchedAt, entries: built.entries }
    this.lastError = null
    if (this.cacheStore !== null) {
      try {
        await this.cacheStore.save(this.cache)
      } catch (err) {
        this.deps.logger?.warn('relay: 预置缓存持久化失败(内存层已更新)', err)
      }
    }
    // Unchanged content still saves (fetchedAt must renew — the daily cadence
    // is the contract), but skips the replay: a byte-identical layer makes
    // the llm-pi-ai revision writes pure waste. Manual refreshes skip it too.
    const changed = previous === null || !sameEntries(previous.entries, built.entries)
    let replayError: string | undefined
    if (changed) {
      const settings = this.deps.settings()
      if (settings !== null) {
        const knowledgeNow = this.deps.knowledge()
        for (const panel of this.deps.panels()) {
          try {
            await replayRouteCapabilities(settings, panel.id, knowledgeForPanel(knowledgeNow, panel.id))
          } catch (err) {
            replayError ??= `模型目录同步失败(面板 ${panel.id}): ${err instanceof Error ? err.message : String(err)}`
          }
        }
      }
    }
    return {
      count: Object.keys(built.entries).length,
      fetchedAt,
      replayed: replayError === undefined,
      ...(replayError !== undefined ? { replayError } : {}),
    }
  }

  /** Fire the startup check once settings AND storage (or the grace fallback) settled. */
  private maybeStartupCheck(allowWithoutStorage = false): void {
    if (this.startupFired || !this.settingsSettled) return
    if (!this.storageSettled && !allowWithoutStorage) return
    this.startupFired = true
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
    void this.backgroundCheck().catch((err) => {
      this.deps.logger?.warn('relay: 启动预置刷新失败(下个周期重试)', err)
    })
  }

  /** Fiber teardown: stop timers and close the storage unit (idempotent). */
  dispose(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
    this.tickerStop?.()
    this.tickerStop = null
    void this.cacheStore?.close().catch(() => {
      /* teardown errors must not crash the unload */
    })
    this.cacheStore = null
  }
}
