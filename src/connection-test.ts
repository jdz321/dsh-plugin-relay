/**
 * POST /api/relay/connection-test — probe one panel with its saved settings
 * (GET /api/user/self) and classify the failure the way the operator actually
 * experiences it (SPEC-0.6.0 §2.7):
 *
 *  - network-layer exception          → `unreachable` (address / network / proxy)
 *  - HTTP 401 + "New-Api-User"/不匹配 → `user-mismatch` (user ID pairing)
 *  - HTTP 401, anything else          → `token-invalid`
 *  - anything else                    → `error:<detail>`
 *
 * Pure classification lives here; the handler in index.ts wraps it.
 */

import { formatQuota } from './plan.js'
import { relayFromPanel, type PanelConfig } from './panels.js'
import type { Relay } from './relay.js'

export type ConnectionTestFailureReason = 'unreachable' | 'user-mismatch' | 'token-invalid' | 'error'

export interface ConnectionTestSuccess {
  ok: true
  account: { username: string, quotaCny: string }
}

export interface ConnectionTestFailure {
  ok: false
  reason: ConnectionTestFailureReason
  /** Readable detail (panel message or transport error). */
  error: string
}

export type ConnectionTestResult = ConnectionTestSuccess | ConnectionTestFailure

/** Classify one panel-call failure into the four user-facing shapes. */
export function classifyConnectionError(err: unknown): ConnectionTestFailure {
  const status = (err as { status?: number }).status
  const detail = (err as { detail?: string }).detail
    ?? (err instanceof Error ? err.message : String(err))
  if (status === 401) {
    if (/New-Api-User|不匹配/i.test(detail)) {
      return { ok: false, reason: 'user-mismatch', error: detail }
    }
    return { ok: false, reason: 'token-invalid', error: detail }
  }
  if (typeof status === 'number' && status > 0) {
    return { ok: false, reason: 'error', error: detail }
  }
  return { ok: false, reason: 'unreachable', error: detail }
}

/** Run the probe against one panel's saved connection settings. */
export async function testPanelConnection(panel: PanelConfig, relay: Relay = relayFromPanel(panel)): Promise<ConnectionTestResult> {
  try {
    const self = await relay.self()
    return {
      ok: true,
      account: {
        username: String(self?.username ?? self?.id ?? ''),
        quotaCny: formatQuota(self?.quota as number | undefined),
      },
    }
  } catch (err) {
    return classifyConnectionError(err)
  }
}
