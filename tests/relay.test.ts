import { afterAll, describe, expect, it } from 'vitest'

import { Relay, RelayAuthError, normalizeToken } from '../src/relay.js'
import { startMockRelay, type MockRelay } from './mock-relay.js'

const open: MockRelay[] = []
async function start(opts?: Parameters<typeof startMockRelay>[0]): Promise<MockRelay> {
  const relay = await startMockRelay(opts)
  open.push(relay)
  return relay
}
afterAll(async () => {
  await Promise.all(open.map((relay) => relay.close()))
})

describe('Relay client', () => {
  it('management endpoints require token + user id pairing', async () => {
    const relay = await start()
    const missingId = new Relay({ baseUrl: relay.baseUrl, accessToken: relay.accessToken })
    await expect(missingId.self()).rejects.toThrow(/用户 ID/)

    const wrongId = new Relay({ baseUrl: relay.baseUrl, accessToken: relay.accessToken, userId: 41 })
    await expect(wrongId.self()).rejects.toBeInstanceOf(RelayAuthError)

    const good = new Relay({ baseUrl: relay.baseUrl, accessToken: relay.accessToken, userId: relay.userId })
    const self = await good.self()
    expect(self!.username).toBe('tester')
    expect(self!.quota).toBe(250000)
  })

  it('lists tokens and normalizes sk- keys', async () => {
    const relay = await start()
    const client = new Relay({ baseUrl: relay.baseUrl, accessToken: relay.accessToken, userId: relay.userId })
    const tokens = await client.listTokens()
    expect(tokens).toHaveLength(2)
    expect(tokens[0]!.key).toBe('sk-test-key-one')
    expect(tokens[0]!.enabled).toBe(true)
    expect(tokens[1]!.enabled).toBe(false)
    expect(tokens[1]!.models).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(tokens[1]!.neverExpires).toBe(true)
  })

  it('keyModels reads the OpenAI-compatible catalog; bad key raises', async () => {
    const relay = await start()
    const client = new Relay({ baseUrl: relay.baseUrl, accessToken: relay.accessToken, userId: relay.userId })
    const models = await client.keyModels('sk-test-key-one')
    expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini', 'claude-sonnet-4-5'])
    await expect(client.keyModels('sk-wrong')).rejects.toBeInstanceOf(RelayAuthError)
  })

  it('pricing() shapes the public table (incl. vendors); failure resolves null', async () => {
    const relay = await start({ withVendors: true })
    const client = new Relay({ baseUrl: relay.baseUrl, accessToken: relay.accessToken, userId: relay.userId })
    const pricing = await client.pricing()
    expect(pricing!.groupRatio.default).toBe(1)
    expect(pricing!.groupRatio.vip).toBe(0.8)
    const chat = pricing!.byModel.get('deepseek-chat')!
    expect(chat.inputPrice).toBe(2)
    expect(chat.outputPrice).toBe(8)
    expect(chat.cacheReadPrice).toBe(0.4)
    expect(chat.groups).toEqual(['default', 'vip'])
    expect(chat.vendor).toBe('DeepSeek')
    const claude = pricing!.byModel.get('claude-sonnet-4-5')!
    expect(claude.vendor).toBeNull()
    // unavailable pricing table must degrade to null, never throw
    const down = new Relay({ baseUrl: 'http://127.0.0.1:9', accessToken: 'x', userId: 1, timeoutMs: 500 })
    await expect(down.pricing()).resolves.toBeNull()
  })
})

describe('normalizeToken', () => {
  it('prefixes sk- once and maps statuses', () => {
    expect(normalizeToken({ id: 1, key: 'abc', status: 1 }).key).toBe('sk-abc')
    expect(normalizeToken({ id: 1, key: 'sk-abc', status: 1 }).key).toBe('sk-abc')
    expect(normalizeToken({ id: 1, key: 'abc', status: 3 }).statusLabel).toBe('expired')
  })
})
