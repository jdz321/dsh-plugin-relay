import { describe, expect, it } from 'vitest'

import { AccountCache, ACCOUNT_CACHE_TTL_MS } from '../src/account.js'
import type { PanelConfig } from '../src/panels.js'

const PANEL: PanelConfig = {
  id: 'p1', baseUrl: 'https://x', relayKind: 'new-api', userId: 1, keyRef: 'RELAY_API_KEY_P1', selectedKeyName: '',
}

const OTHER: PanelConfig = { ...PANEL, id: 'p2' }

describe('AccountCache (GET /api/relay/account — 5s TTL, failures included)', () => {
  it('serves the cached success without re-running the loader inside the TTL', async () => {
    let clock = 1_000
    const cache = new AccountCache({ now: () => clock })
    let loads = 0
    const load = async (): Promise<{ username: string, quotaCny: string }> => {
      loads += 1
      return { username: 'u', quotaCny: '12.5' }
    }
    const first = await cache.lookup(PANEL, load)
    const second = await cache.lookup(PANEL, load)
    expect(first).toEqual({ ok: true, account: { username: 'u', quotaCny: '12.5' } })
    expect(second).toEqual(first)
    expect(loads).toBe(1)
    clock += ACCOUNT_CACHE_TTL_MS // exactly the TTL later → expired
    await cache.lookup(PANEL, load)
    expect(loads).toBe(2)
  })

  it('caches FAILURES for the TTL too (an unreachable panel cannot be hammered)', async () => {
    let clock = 1_000
    const cache = new AccountCache({ now: () => clock })
    let attempts = 0
    const load = async (): Promise<{ username: string, quotaCny: string }> => {
      attempts += 1
      throw new Error('unreachable')
    }
    const first = await cache.lookup(PANEL, load)
    const second = await cache.lookup(PANEL, load)
    expect(first).toMatchObject({ ok: false, error: 'unreachable' })
    expect(second).toEqual(first)
    expect(attempts).toBe(1)
  })

  it('caches per panel id', async () => {
    const cache = new AccountCache({ now: () => 1_000 })
    let loads = 0
    const load = async (): Promise<{ username: string, quotaCny: string }> => {
      loads += 1
      return { username: 'u', quotaCny: '0' }
    }
    await cache.lookup(PANEL, load)
    await cache.lookup(OTHER, load)
    expect(loads).toBe(2)
  })

  it('a failed lookup recovers after the TTL expires', async () => {
    let clock = 1_000
    const cache = new AccountCache({ now: () => clock })
    let fail = true
    const load = async (): Promise<{ username: string, quotaCny: string }> => {
      if (fail) throw new Error('down')
      return { username: 'u', quotaCny: '1' }
    }
    expect(await cache.lookup(PANEL, load)).toMatchObject({ ok: false })
    clock += ACCOUNT_CACHE_TTL_MS + 1
    fail = false
    expect(await cache.lookup(PANEL, load)).toMatchObject({ ok: true })
  })
})
