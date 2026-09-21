/**
 * A tiny in-process new-api compatible relay used by the test suite. Covers
 * all three billing dialects, vendor metadata, token+user pairing, and a
 * disabled key.
 */

import http from 'node:http'
import type { AddressInfo, Server } from 'node:net'

const USER_ID = 42
const ACCESS_TOKEN = 'test-access-token/abc='
const API_KEY_1 = 'sk-test-key-one'
const API_KEY_2 = 'sk-test-key-two-disabled'

export const MODELS = ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini', 'claude-sonnet-4-5']

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
}

export async function startMockRelay(opts: MockRelayOptions = {}): Promise<MockRelay> {
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? ''
    const apiUser = req.headers['new-api-user'] ?? ''
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.url === '/api/status') {
      return json(200, { success: true, data: { system_name: 'MockAI-Code', version: 'v0.0-mock' } })
    }
    if (req.url === '/api/user/self') {
      if (auth !== `Bearer ${ACCESS_TOKEN}`) return json(401, { success: false, message: '无权进行此操作，token 无效' })
      if (apiUser !== String(USER_ID)) return json(401, { success: false, message: '无权进行此操作，New-Api-User 与登录用户不匹配' })
      return json(200, {
        success: true,
        message: '',
        data: { id: USER_ID, username: 'tester', display_name: 'Tester', role: 1, group: 'default', quota: 250000, used_quota: 1000 },
      })
    }
    if (req.url?.startsWith('/api/token/')) {
      if (auth !== `Bearer ${ACCESS_TOKEN}` || apiUser !== String(USER_ID)) {
        return json(401, { success: false, message: '无权进行此操作' })
      }
      return json(200, {
        success: true,
        message: '',
        data: {
          items: [
            {
              id: 7, name: '主-key', key: API_KEY_1.slice(3), status: 1, group: 'default',
              models: '', unlimited_quota: false, remain_quota: 240000, used_quota: 10000,
              expired_time: -1, created_time: 1758000000,
            },
            {
              id: 8, name: '备用', key: API_KEY_2.slice(3), status: 2, group: 'vip',
              models: 'deepseek-chat,deepseek-reasoner', unlimited_quota: true, remain_quota: 0, used_quota: 5,
              expired_time: -1, created_time: 1758100000,
            },
          ],
          total: 2,
        },
      })
    }
    if (req.url === '/api/pricing') {
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
    if (req.url === '/v1/models') {
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    userId: USER_ID,
    accessToken: ACCESS_TOKEN,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
