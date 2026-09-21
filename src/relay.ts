/**
 * Client for new-api-family relay panels: management endpoints authenticate
 * with the personal access token (`Authorization: Bearer <token>`) plus the
 * `New-Api-User: <id>` header naming the account the token belongs to;
 * OpenAI-compatible endpoints authenticate with a regular API key (`sk-...`).
 */

import { requestJson, type RequestOptions } from './http.js'
import { normalizePricing, type NormalizedPricing } from './pricing.js'

export const TOKEN_STATUS: Record<number, string> = {
  1: 'enabled',
  2: 'disabled',
  3: 'expired',
  4: 'exhausted',
}

export class RelayAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelayAuthError'
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl || '').replace(/\/+$/, '')
}

/** Management-API token record → plain object with the usable `sk-` key. */
export interface RelayToken {
  id: number | string
  name: string
  key: string
  status: number | undefined
  statusLabel: string
  enabled: boolean
  group: string
  models: string[]
  unlimitedQuota: boolean
  remainQuota: number | undefined
  usedQuota: number | undefined
  expiredTime: number | undefined
  neverExpires: boolean
  createdTime: number | undefined
  accessedTime: number | undefined
}

function isObj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeToken(raw: unknown): RelayToken {
  const record = isObj(raw) ? raw : {}
  const rawKey = String(record.key ?? '')
  const id = record.id as number | string
  const status = typeof record.status === 'number' ? record.status : Number(record.status) || 0
  return {
    id,
    name: typeof record.name === 'string' && record.name ? record.name : `token-${id}`,
    key: rawKey.startsWith('sk-') ? rawKey : `sk-${rawKey}`,
    status,
    statusLabel: TOKEN_STATUS[status] ?? String(record.status ?? 'unknown'),
    enabled: status === 1,
    group: typeof record.group === 'string' ? record.group : '',
    models: typeof record.models === 'string' && record.models.length ? record.models.split(',').filter(Boolean) : [],
    unlimitedQuota: Boolean(record.unlimited_quota),
    remainQuota: record.remain_quota as number | undefined,
    usedQuota: record.used_quota as number | undefined,
    expiredTime: record.expired_time as number | undefined,
    neverExpires: record.expired_time === -1,
    createdTime: record.created_time as number | undefined,
    accessedTime: record.accessed_time as number | undefined,
  }
}

export interface RelayOptions {
  baseUrl: string
  accessToken: string
  /** Account id for the New-Api-User header; omitted → management calls fail. */
  userId?: number | string
  proxy?: string | null
  timeoutMs?: number
}

export class Relay {
  readonly baseUrl: string
  readonly accessToken: string
  readonly userId: number | string | undefined
  readonly proxy: string | null
  readonly timeoutMs: number

  constructor({ baseUrl, accessToken, userId, proxy = null, timeoutMs = 20000 }: RelayOptions) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
    if (!this.baseUrl) throw new Error('relay baseUrl is required')
    this.accessToken = accessToken
    this.userId = userId
    this.proxy = proxy
    this.timeoutMs = timeoutMs
  }

  managementHeaders(): Record<string, string> {
    if (!this.accessToken) throw new RelayAuthError('缺少中转站访问令牌（accessToken）')
    if (this.userId === undefined || this.userId === null || this.userId === '') {
      throw new RelayAuthError(
        '缺少中转站用户 ID（New-Api-User）。请在本插件设置页填写并保存；' +
        'ID 可在中转站控制台「个人中心」查看，或登录后从浏览器控制台读取 localStorage.user.id。',
      )
    }
    return {
      authorization: `Bearer ${this.accessToken}`,
      'new-api-user': String(this.userId),
      accept: 'application/json',
      'user-agent': 'dsh-plugin-relay/0.4',
    }
  }

  async managementGet(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`
    let json: unknown
    try {
      json = await requestJson({ url, headers: this.managementHeaders(), proxy: this.proxy, timeoutMs: this.timeoutMs })
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        throw new RelayAuthError(`中转站鉴权失败（401）: ${(err as { detail?: string }).detail ?? (err as Error).message}`)
      }
      throw err
    }
    if (json && typeof json === 'object' && (json as { success?: unknown }).success === false) {
      throw new RelayAuthError(`中转站返回失败: ${(json as { message?: string }).message ?? 'unknown'}`)
    }
    return (json as { data?: unknown })?.data
  }

  /** Account summary (id, username, quota, group). */
  async self(): Promise<Record<string, unknown> | null> {
    return await this.managementGet('/api/user/self') as Record<string, unknown> | null
  }

  /**
   * All API keys (令牌) of the account. Handles both `{items,total}` and bare
   * array payloads across new-api versions.
   */
  async listTokens(): Promise<RelayToken[]> {
    const data = await this.managementGet('/api/token/?p=1&size=100')
    const items = Array.isArray(data) ? data : ((data as { items?: unknown[] })?.items ?? [])
    return items.map(normalizeToken)
  }

  /** Model ids available to the account's group(s) (management view). */
  async userModels(): Promise<string[]> {
    const data = await this.managementGet('/api/user/models')
    return Array.isArray(data) ? data.map(String) : []
  }

  /**
   * The panel's model pricing table (new-api `GET /api/pricing`). Public on
   * most panels; sent with management headers when those are configured.
   * Resolves null when the panel has no pricing table — callers must treat
   * that as "no price info", never as an error.
   */
  async pricing(): Promise<NormalizedPricing | null> {
    let headers: Record<string, string> = { accept: 'application/json' }
    try {
      headers = this.managementHeaders()
    } catch {
      /* pricing is public on most panels */
    }
    const opts: RequestOptions = {
      url: `${this.baseUrl}/api/pricing`,
      headers,
      proxy: this.proxy,
      timeoutMs: this.timeoutMs,
    }
    let json: unknown
    try {
      json = await requestJson(opts)
    } catch {
      return null
    }
    return normalizePricing(json)
  }

  /**
   * Model ids the key can actually call, from the OpenAI-compatible
   * `GET /v1/models` endpoint (authoritative for the key).
   */
  async keyModels(apiKey: string): Promise<string[]> {
    if (!apiKey) throw new RelayAuthError('缺少 API key')
    const url = `${this.baseUrl}/v1/models`
    let json: unknown
    try {
      json = await requestJson({
        url,
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        proxy: this.proxy,
        timeoutMs: this.timeoutMs,
      })
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        throw new RelayAuthError(`API key 无效（401）: ${(err as { detail?: string }).detail ?? (err as Error).message}`)
      }
      throw err
    }
    const list = Array.isArray((json as { data?: unknown[] })?.data) ? (json as { data: unknown[] }).data : []
    return list.map((m) => String(isObj(m) ? m.id : m)).filter(Boolean)
  }
}
