/**
 * Core relay operations behind the fetch routes: key picking, model
 * discovery, switch planning, and key metadata shaping. Pure logic — the
 * host entry applies plans through ctx.settings / ctx.credentials.
 *
 * Since v0.5.0 the plugin does NOT manage a "default model": dsh picks the
 * model per conversation/session on its own (its `agent-default-model`
 * namespace stays the user's business). A switch only writes the credential,
 * the route profile, and the synced catalog.
 */

import { Relay, type RelayToken } from './relay.js'

/** Quota points → CNY estimate (one-api family: 500000 points ≈ $1). */
export function formatQuota(quota: number | undefined | null): string {
  if (quota === undefined || quota === null) return '?'
  return (quota / 500000).toFixed(4)
}

/**
 * Pick a token by numeric id, exact name, case-insensitive name, or unique
 * case-insensitive prefix.
 */
export function pickToken(tokens: readonly RelayToken[], idOrName: string): RelayToken | null {
  const needle = String(idOrName)
  if (/^\d+$/.test(needle)) {
    const byId = tokens.find((t) => String(t.id) === needle)
    if (byId) return byId
  }
  const exact = tokens.find((t) => t.name === needle)
  if (exact) return exact
  const ci = tokens.filter((t) => t.name.toLowerCase() === needle.toLowerCase())
  if (ci.length === 1) return ci[0]!
  const prefix = tokens.filter((t) => t.name.toLowerCase().startsWith(needle.toLowerCase()))
  if (prefix.length === 1) return prefix[0]!
  return null
}

/** Metadata for one key row; key material is never included. */
export function keySummary(token: RelayToken, { selectedName = '', groupRatio = null }: { selectedName?: string, groupRatio?: number | null } = {}) {
  return {
    id: token.id,
    name: token.name,
    enabled: token.enabled,
    statusLabel: token.statusLabel,
    group: token.group || '',
    groupRatio,
    remainCny: token.unlimitedQuota ? null : formatQuota(token.remainQuota),
    /** Raw quota points for the edit form (CNY display is derived from it). */
    remainPoints: token.remainQuota ?? 0,
    unlimited: token.unlimitedQuota,
    usedCny: formatQuota(token.usedQuota),
    neverExpires: token.neverExpires,
    expiredTime: token.expiredTime,
    selected: token.name === selectedName,
  }
}

/**
 * Discover the model ids a key can actually call. Order of preference:
 * `GET /v1/models` with the key (authoritative), the token's `models`
 * restriction field, the account group's models.
 */
export async function fetchCatalog({ relay, token }: { relay: Relay, token: RelayToken }): Promise<{ ids: string[], source: string }> {
  let ids: string[] = []
  let source = ''
  try {
    ids = await relay.keyModels(token.key)
    source = '/v1/models'
  } catch (keyErr) {
    if (token.models.length) {
      ids = token.models
      source = 'token-models'
    } else {
      try {
        ids = await relay.userModels()
        source = 'user-models'
      } catch {
        throw keyErr
      }
    }
  }
  if (!ids.length) throw new Error('该 key 没有任何可用模型（未启用或分组为空）')
  return { ids: [...new Set(ids)], source }
}

export interface SwitchPlan {
  token: RelayToken
  /** Model ids the key can call, null when catalog discovery was skipped. */
  ids: string[] | null
}

/** Thrown by planSwitch when no key matches the selector. */
export class KeyNotFoundError extends Error {
  readonly code = 'KEY_NOT_FOUND'

  constructor(idOrName: string) {
    super(`找不到名为/编号为「${idOrName}」的 key`)
    this.name = 'KeyNotFoundError'
  }
}

/**
 * Plan a key switch without side effects. The caller applies the plan —
 * the host plugin goes through ctx.settings / ctx.credentials.
 */
export async function planSwitch(opts: {
  relay: Relay
  idOrName: string
  noModels?: boolean
}): Promise<SwitchPlan> {
  const { relay, idOrName, noModels } = opts
  const tokens = await relay.listTokens()
  const token = pickToken(tokens, idOrName)
  if (!token) throw new KeyNotFoundError(idOrName)
  const catalog = noModels ? null : await fetchCatalog({ relay, token })
  return {
    token,
    ids: catalog?.ids ?? null,
  }
}
