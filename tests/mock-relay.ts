/**
 * A tiny in-process new-api compatible relay used by the test suite. Covers
 * all three billing dialects, vendor metadata, token+user pairing, a
 * disabled key, in-memory token CRUD (with the fork's 「分组不能为空」
 * validation), usage logs with the fork's `other.frt` field, windowed usage
 * statistics, and sparse per-model usage buckets anchored to "now" so
 * dashboard day-aggregation sees fresh data.
 */

import http from 'node:http'
import type { AddressInfo, Server } from 'node:net'

const USER_ID = 42
const ACCESS_TOKEN = 'test-access-token/abc='
const API_KEY_1 = 'sk-test-key-one'
const API_KEY_2 = 'sk-test-key-two-disabled'

export const MODELS = ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini', 'claude-sonnet-4-5']

/** Local unix seconds `daysBack` days ago at hour:00 (only for daysBack >= 1). */
function daysAgoAt(daysBack: number, hour: number): number {
  const date = new Date()
  date.setDate(date.getDate() - daysBack)
  date.setHours(hour, 0, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

/** Local unix seconds `hoursBack` hours before now — safe for "today" fixtures at any test time. */
function hoursAgo(hoursBack: number): number {
  return Math.floor((Date.now() - hoursBack * 3_600_000) / 1000)
}

/** One raw usage-log fixture row. */
function logFixture(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    created_at: hoursAgo(1),
    type: 2,
    token_name: '主-key',
    group: 'default',
    model_name: 'deepseek-chat',
    quota: 9664,
    prompt_tokens: 2,
    completion_tokens: 348,
    use_time: 9,
    is_stream: true,
    reasoning_tokens: 0,
    reasoning_effort: '',
    cache_read_tokens: 134000,
    cache_creation_tokens: 267,
    other: JSON.stringify({ frt: 4200 }),
    ...overrides,
  }
}

const LOGS: Record<string, unknown>[] = [
  logFixture({}),
  logFixture({
    created_at: hoursAgo(2),
    quota: 8628,
    completion_tokens: 43,
    use_time: 8,
    other: JSON.stringify({ frt: 4100 }),
    cache_read_tokens: 134000,
    cache_creation_tokens: 174,
  }),
  logFixture({
    created_at: hoursAgo(3),
    token_name: '备用',
    group: 'vip',
    model_name: 'gpt-4o-mini',
    quota: 5000,
    completion_tokens: 64,
    use_time: 8,
    is_stream: false,
    other: 'not-json-on-purpose',
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    reasoning_tokens: 512,
    reasoning_effort: 'high',
  }),
  logFixture({
    created_at: daysAgoAt(2, 12),
    model_name: 'claude-sonnet-4-5',
    quota: 250000,
    completion_tokens: 1200,
    use_time: 40,
    other: JSON.stringify({ frt: 5300 }),
  }),
  logFixture({
    created_at: daysAgoAt(20, 12),
    model_name: 'deepseek-reasoner',
    quota: 1_000_000,
    other: JSON.stringify({ frt: 900 }),
  }),
]

/** Sparse hour buckets: two today, one 3 days back, one out of any 7-day window. */
const DATA_BUCKETS: Record<string, unknown>[] = [
  { model_name: 'deepseek-chat', created_at: hoursAgo(2), token_used: 350, count: 2, quota: 9664 },
  { model_name: 'gpt-4o-mini', created_at: hoursAgo(3), token_used: 64, count: 1, quota: 5000 },
  { model_name: 'claude-sonnet-4-5', created_at: daysAgoAt(3, 12), token_used: 1500, count: 1, quota: 250000 },
  { model_name: 'deepseek-reasoner', created_at: daysAgoAt(12, 6), token_used: 40_000, count: 4, quota: 1_000_000 },
]

/** In-memory token store; CRUD mutates it so tests and browser walks see effects. */
const tokens: Record<string, unknown>[] = [
  {
    id: 7, name: '主-key', key: API_KEY_1.slice(3), status: 1, group: 'default',
    models: '', unlimited_quota: false, remain_quota: 240000, used_quota: 10000,
    expired_time: -1, created_time: 1758000000, accessed_time: 1758100000,
  },
  {
    id: 8, name: '备用', key: API_KEY_2.slice(3), status: 2, group: 'vip',
    models: 'deepseek-chat,deepseek-reasoner', unlimited_quota: true, remain_quota: 0, used_quota: 5,
    expired_time: -1, created_time: 1758100000,
  },
]
let nextTokenId = 100

export interface MockRelay {
  server: Server
  baseUrl: string
  userId: number
  accessToken: string
  close: () => Promise<void>
}

export interface MockRelayOptions {
  /** Override the /v1/models payload for key 1. */
  modelsForKey1?: string[]
  /** Serve /api/pricing with a vendors list (panel fork extension). */
  withVendors?: boolean
  /** Extra /api/data/self buckets (Top-N fold walkthroughs need >7 models). */
  extraBuckets?: Record<string, unknown>[]
  /** Fixed listen port (default: random) — for the standalone browser-walkthrough runner. */
  port?: number
}

function withinWindow(created: number, query: URLSearchParams): boolean {
  const start = query.get('start_timestamp')
  const end = query.get('end_timestamp')
  if (start !== null && created < Number(start)) return false
  if (end !== null && created > Number(end)) return false
  return true
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

export async function startMockRelay(opts: MockRelayOptions = {}): Promise<MockRelay> {
  const server = http.createServer(async (req, res) => {
    const auth = req.headers.authorization ?? ''
    const apiUser = req.headers['new-api-user'] ?? ''
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const authorized = auth === `Bearer ${ACCESS_TOKEN}` && apiUser === String(USER_ID)
    const url = req.url ?? ''
    const [path, rawQuery] = url.split('?')
    const query = new URLSearchParams(rawQuery ?? '')

    if (url === '/api/status') {
      return json(200, { success: true, data: { system_name: 'MockAI-Code', version: 'v0.0-mock' } })
    }
    if (url === '/api/user/self') {
      if (auth !== `Bearer ${ACCESS_TOKEN}`) return json(401, { success: false, message: '无权进行此操作，token 无效' })
      if (apiUser !== String(USER_ID)) return json(401, { success: false, message: '无权进行此操作，New-Api-User 与登录用户不匹配' })
      return json(200, {
        success: true,
        message: '',
        data: { id: USER_ID, username: 'tester', display_name: 'Tester', role: 1, group: 'default', quota: 250000, used_quota: 1000, request_count: 128 },
      })
    }
    if (url === '/api/user/models') {
      if (!authorized) return json(401, { success: false, message: '无权进行此操作' })
      return json(200, { success: true, message: '', data: MODELS })
    }
    if (path === '/api/token/' || path === '/api/token') {
      if (!authorized) return json(401, { success: false, message: '无权进行此操作' })
      if (req.method === 'GET') {
        return json(200, { success: true, message: '', data: { items: [...tokens], total: tokens.length } })
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
        if (!body.group || typeof body.group !== 'string') {
          return json(400, { success: false, message: '分组不能为空' })
        }
        if (!body.name || typeof body.name !== 'string') {
          return json(400, { success: false, message: '名称不能为空' })
        }
        const id = nextTokenId
        nextTokenId += 1
        const secret = `new-secret-${id}`
        const record: Record<string, unknown> = {
          created_time: Math.floor(Date.now() / 1000),
          accessed_time: Math.floor(Date.now() / 1000),
          used_quota: 0,
          status: 1,
          ...body,
          id,
          key: secret,
        }
        tokens.push(record)
        // The creation response is the only chance to see the plain secret.
        return json(200, { success: true, message: '', data: { ...record, key: secret } })
      }
      if (req.method === 'PUT') {
        const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
        if (body.id === undefined || body.id === null) {
          return json(400, { success: false, message: 'id 或 userId 为空！' })
        }
        const record = tokens.find((t) => String(t.id) === String(body.id))
        if (!record) return json(400, { success: false, message: 'record not found' })
        // Upstream UpdateToken: status changes only apply on ?status_only=true.
        if (query.get('status_only')) {
          record.status = body.status
        } else {
          const { status: _ignored, ...rest } = body
          Object.assign(record, rest)
        }
        return json(200, { success: true, message: '', data: record })
      }
      return json(400, { success: false, message: 'unsupported method' })
    }
    const deleteMatch = path?.match(/^\/api\/token\/(\d+)$/)
    if (deleteMatch) {
      if (!authorized) return json(401, { success: false, message: '无权进行此操作' })
      const id = deleteMatch[1]
      const index = tokens.findIndex((t) => String(t.id) === id)
      if (index === -1) return json(404, { success: false, message: 'record not found' })
      tokens.splice(index, 1)
      return json(200, { success: true, message: '', data: null })
    }
    if (url.startsWith('/api/log/self/stat')) {
      if (!authorized) return json(401, { success: false, message: '无权进行此操作' })
      const quota = LOGS.filter((log) => withinWindow(Number(log.created_at), query)).reduce((sum, log) => sum + Number(log.quota), 0)
      return json(200, { success: true, message: '', data: { quota, rpm: 3, tpm: 45_000 } })
    }
    if (url.startsWith('/api/log/self')) {
      if (!authorized) return json(401, { success: false, message: '无权进行此操作' })
      const page = Math.max(1, Number(query.get('p') ?? 1))
      const pageSize = Math.max(1, Number(query.get('page_size') ?? 10))
      const tokenName = query.get('token_name') ?? ''
      const modelName = query.get('model_name') ?? ''
      const group = query.get('group') ?? ''
      const filtered = LOGS
        .filter((log) => withinWindow(Number(log.created_at), query))
        .filter((log) => (tokenName ? String(log.token_name).includes(tokenName) : true))
        .filter((log) => (modelName ? String(log.model_name).includes(modelName) : true))
        .filter((log) => (group ? log.group === group : true))
        .sort((a, b) => Number(b.created_at) - Number(a.created_at))
      const start = (page - 1) * pageSize
      return json(200, {
        success: true,
        message: '',
        data: { page, page_size: pageSize, total: filtered.length, items: filtered.slice(start, start + pageSize) },
      })
    }
    if (url.startsWith('/api/data/self')) {
      if (!authorized) return json(401, { success: false, message: '无权进行此操作' })
      const allBuckets = opts.extraBuckets ? [...DATA_BUCKETS, ...opts.extraBuckets] : DATA_BUCKETS
      const buckets = allBuckets.filter((bucket) => withinWindow(Number(bucket.created_at), query))
      return json(200, { success: true, message: '', data: buckets })
    }
    if (url === '/api/pricing') {
      // Public on most panels; covers all three billing dialects plus the
      // vendor fork extension the capability cards source their badges from.
      return json(200, {
        success: true,
        data: [
          {
            model_name: 'deepseek-chat', quota_type: 0, model_ratio: 0, model_price: 0,
            input_price: 2, output_price: 8, cache_read_price: 0.4, billing_mode: 'token',
            completion_ratio: 0, enable_groups: ['default', 'vip'], ...(opts.withVendors ? { vendor_id: 4 } : {}),
          },
          {
            model_name: 'deepseek-reasoner', quota_type: 0, model_ratio: 0, model_price: 0,
            input_price: 4, output_price: 16, cache_read_price: 0.8, billing_mode: 'token',
            completion_ratio: 0, enable_groups: ['default', 'vip'], ...(opts.withVendors ? { vendor_id: 4 } : {}),
          },
          {
            model_name: 'gpt-4o-mini', quota_type: 0, model_ratio: 0.38, model_price: 0,
            input_price: 0, output_price: 0, cache_read_price: 0, completion_ratio: 4,
            enable_groups: ['default'], ...(opts.withVendors ? { vendor_id: 1 } : {}),
          },
          {
            model_name: 'claude-sonnet-4-5', quota_type: 1, model_ratio: 0, model_price: 0.5,
            input_price: 0, output_price: 0, cache_read_price: 0, completion_ratio: 0,
            enable_groups: ['vip'],
          },
        ],
        ...(opts.withVendors ? { vendors: [{ id: 1, name: 'OpenAI' }, { id: 4, name: 'DeepSeek' }] } : {}),
        group_ratio: { default: 1, vip: 0.8 },
        usable_group: { default: '默认分组', vip: 'VIP 分组' },
      })
    }
    if (url === '/v1/models') {
      if (auth === `Bearer ${API_KEY_1}`) {
        return json(200, {
          object: 'list',
          data: (opts.modelsForKey1 ?? MODELS).map((id) => ({ id, object: 'model', owned_by: 'mock' })),
        })
      }
      if (auth === `Bearer ${API_KEY_2}`) {
        return json(200, { object: 'list', data: [{ id: 'deepseek-chat', object: 'model', owned_by: 'mock' }] })
      }
      return json(401, { error: { message: '无效的令牌', type: 'new_api_error' } })
    }
    json(404, { success: false, message: 'not found' })
  })
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    userId: USER_ID,
    accessToken: ACCESS_TOKEN,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
