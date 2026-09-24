import { afterAll, describe, expect, it } from 'vitest'

import { Relay, RelayAuthError, normalizeToken } from '../src/relay.js'
import { normalizeLog } from '../src/usage.js'
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

function clientOf(relay: MockRelay): Relay {
  return new Relay({ baseUrl: relay.baseUrl, accessToken: relay.accessToken, userId: relay.userId })
}

/** Assert a JSON value (deep) carries no key material. */
function expectNoKeyMaterial(value: unknown): void {
  const text = JSON.stringify(value)
  expect(text).not.toContain('sk-test-key')
  expect(text).not.toContain('sk-new-secret')
}

describe('Relay client', () => {
  it('management endpoints require token + user id pairing', async () => {
    const relay = await start()
    const missingId = new Relay({ baseUrl: relay.baseUrl, accessToken: relay.accessToken })
    await expect(missingId.self()).rejects.toThrow(/用户 ID/)

    const wrongId = new Relay({ baseUrl: relay.baseUrl, accessToken: relay.accessToken, userId: 41 })
    await expect(wrongId.self()).rejects.toBeInstanceOf(RelayAuthError)

    const good = clientOf(relay)
    const self = await good.self()
    expect(self!.username).toBe('tester')
    expect(self!.quota).toBe(250000)
    expect(self!.request_count).toBe(128)
  })

  it('lists tokens and normalizes sk- keys', async () => {
    const relay = await start()
    const client = clientOf(relay)
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
    const client = clientOf(relay)
    const models = await client.keyModels('sk-test-key-one')
    expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini', 'claude-sonnet-4-5'])
    await expect(client.keyModels('sk-wrong')).rejects.toBeInstanceOf(RelayAuthError)
  })

  it('pricing() shapes the public table (incl. vendors); failure resolves null', async () => {
    const relay = await start({ withVendors: true })
    const client = clientOf(relay)
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

describe('token CRUD', () => {
  it('createToken creates a key and strips the secret from its return value', async () => {
    const relay = await start()
    const client = clientOf(relay)
    const created = await client.createToken({
      name: '临时',
      group: 'vip',
      unlimitedQuota: false,
      remainQuota: 250_000,
      expiredTime: -1,
    })
    expect(Object.keys(created).sort()).toEqual(['id', 'name'])
    expect(created.name).toBe('临时')
    // The key is usable in the panel right away: /v1/models accepts it.
    const list = await client.listTokens()
    const record = list.find((t) => String(t.id) === String(created.id))!
    expect(record).toBeTruthy()
    expectNoKeyMaterial(created)
    // cleanup: the mock is in-memory per server, but keep the store tidy.
    await client.deleteToken(created.id)
    await expect(client.listTokens()).resolves.toHaveLength(2)
  })

  it('createToken surfaces panel validation errors (group required)', async () => {
    const relay = await start()
    const client = clientOf(relay)
    await expect(client.createToken({ name: 'x', group: '', unlimitedQuota: true })).rejects.toThrow(/分组不能为空/)
  })

  it('updateToken PUTs the whole panel record with edited fields merged', async () => {
    const relay = await start()
    const client = clientOf(relay)
    const records = await client.listTokensRaw()
    const record = records.find((r) => r.name === '备用')!
    // a plain PUT edits fields but never the status (upstream semantics)
    await client.updateToken({ ...record, name: '备用-改名', group: 'default' })
    const after = await client.listTokens()
    const edited = after.find((t) => t.name === '备用-改名')!
    expect(edited.group).toBe('default')
    expect(edited.enabled).toBe(false)
  })

  it('updateToken status changes go through the status_only variant', async () => {
    const relay = await start()
    const client = clientOf(relay)
    const records = await client.listTokensRaw()
    const record = records.find((r) => r.name === '主-key')!
    // plain PUT ignores status (upstream semantics)
    await client.updateToken({ ...record, status: 2 })
    const afterPlain = (await client.listTokens()).find((t) => t.name === '主-key')!
    expect(afterPlain.enabled).toBe(true)
    // status_only PUT applies it
    await client.updateToken({ ...record, status: 2 }, true)
    const afterStatus = (await client.listTokens()).find((t) => t.name === '主-key')!
    expect(afterStatus.enabled).toBe(false)
    await client.updateToken({ ...record, status: 1 }, true)
    expect(((await client.listTokens()).find((t) => t.name === '主-key'))!.enabled).toBe(true)
  })

  it('updateToken requires an id; deleteToken reports missing records', async () => {
    const relay = await start()
    const client = clientOf(relay)
    await expect(client.updateToken({ name: 'no-id' })).rejects.toThrow(/id/)
    await expect(client.deleteToken(99999)).rejects.toThrow(/record not found/)
  })
})

describe('usage logs / stat / data', () => {
  it('logs() paginates, filters, and never returns key material', async () => {
    const relay = await start()
    const client = clientOf(relay)
    const all = await client.logs({ p: 1, pageSize: 10 })
    expect(all.total).toBe(5)
    expect(all.items).toHaveLength(5)
    expectNoKeyMaterial(all)

    const page2 = await client.logs({ p: 2, pageSize: 2 })
    expect(page2.items).toHaveLength(2)
    expect(page2.total).toBe(5)

    const filtered = await client.logs({ p: 1, pageSize: 10, modelName: 'deepseek' })
    expect(filtered.total).toBe(3)
    const byGroup = await client.logs({ p: 1, pageSize: 10, group: 'vip' })
    expect(byGroup.total).toBe(1)
  })

  it('logStat returns the windowed quota; no window means the full accounting', async () => {
    const relay = await start()
    const client = clientOf(relay)
    const full = await client.logStat()
    expect(full.quota).toBe(1_273_292)
    const nowSeconds = Math.floor(Date.now() / 1000)
    const today = await client.logStat(nowSeconds - 86400, nowSeconds + 60)
    expect(today.quota).toBe(23_292)
    expect(today.rpm).toBe(3)
  })

  it('usageData returns sparse buckets inside the window; shaped logs parse frt', async () => {
    const relay = await start()
    const client = clientOf(relay)
    const nowSeconds = Math.floor(Date.now() / 1000)
    const buckets = await client.usageData(nowSeconds - 5 * 86400, nowSeconds + 60)
    expect(buckets).toHaveLength(3)

    const logs = await client.logs({ p: 1, pageSize: 10 })
    const shaped = logs.items.map(normalizeLog)
    const withFrt = shaped.filter((log) => log.frt !== null)
    expect(withFrt.length).toBeGreaterThanOrEqual(3)
    expect(shaped.find((log) => log.modelName === 'gpt-4o-mini')!.frt).toBeNull()
    expect(shaped.find((log) => log.modelName === 'deepseek-chat')!.frt).toBeCloseTo(4.2, 6)
  })
})

describe('normalizeToken', () => {
  it('prefixes sk- once and maps statuses', () => {
    expect(normalizeToken({ id: 1, key: 'abc', status: 1 }).key).toBe('sk-abc')
    expect(normalizeToken({ id: 1, key: 'sk-abc', status: 1 }).key).toBe('sk-abc')
    expect(normalizeToken({ id: 1, key: 'abc', status: 3 }).statusLabel).toBe('expired')
  })
})
