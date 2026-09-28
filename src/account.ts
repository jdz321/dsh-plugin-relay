/**
 * Lazy account lookups behind GET /api/relay/account (v0.6.1). The connection
 * list no longer blocks on the panels' `/api/user/self` — the client fills the
 * account line per panel after the list renders. This host-side cache keeps a
 * client retry storm (or a settings revision bump re-render) from hammering an
 * unreachable panel: SUCCESS AND FAILURE results both cache for the TTL.
 */

import type { PanelConfig } from './panels.js'

/** The account facts one panel row shows. */
export interface AccountView {
  username: string
  quotaCny: string
}

export type AccountLookupResult =
  | { ok: true, account: AccountView }
  | { ok: false, error: string }

/** How long one lookup result (success or failure) is served without I/O. */
export const ACCOUNT_CACHE_TTL_MS = 5_000

export class AccountCache {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly entries = new Map<string, { at: number, result: AccountLookupResult }>()

  constructor(options: { ttlMs?: number, now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? ACCOUNT_CACHE_TTL_MS
    this.now = options.now ?? Date.now
  }

  /**
   * Serve the cached result for the panel when fresh; else run `load` once and
   * cache whatever it settles to (rejections become `{ok:false}` results).
   */
  async lookup(panel: PanelConfig, load: (panel: PanelConfig) => Promise<AccountView>): Promise<AccountLookupResult> {
    const cached = this.entries.get(panel.id)
    if (cached && this.now() - cached.at < this.ttlMs) return cached.result
    let result: AccountLookupResult
    try {
      result = { ok: true, account: await load(panel) }
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    this.entries.set(panel.id, { at: this.now(), result })
    return result
  }
}
