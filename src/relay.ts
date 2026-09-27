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
  /** HTTP status the panel answered with, when the failure was an HTTP 401. */
  status?: number
  /** The panel's own message (HttpError.detail), kept for error classification. */
  detail?: string

  constructor(message: string) {
    super(message)
    this.name = 'RelayAuthError'
  }
}

/** Non-auth panel-side failure (validation errors etc.); message is panel-provided. */
export class RelayApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelayApiError'
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
      'user-agent': 'dsh-plugin-relay/0.6',
    }
  }

  async managementGet(path: string): Promise<unknown> {
    return await this.managementSend('GET', path)
  }

  /** Management call with an explicit method and optional JSON body. */
  async managementSend(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<unknown> {
    const url = `${this.baseUrl}${path}`
    let json: unknown
    try {
      json = await requestJson({
        url,
        method,
        headers: {
          ...this.managementHeaders(),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        proxy: this.proxy,
        timeoutMs: this.timeoutMs,
      })
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        const detail = (err as { detail?: string }).detail ?? (err as Error).message
        const authError = new RelayAuthError(`中转站鉴权失败（401）: ${detail}`)
        authError.status = 401
        authError.detail = detail
        throw authError
      }
      throw err
    }
    if (json && typeof json === 'object' && (json as { success?: unknown }).success === false) {
      throw new RelayApiError(`中转站返回失败: ${(json as { message?: string }).message ?? 'unknown'}`)
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
    return (await this.listTokensRaw()).map(normalizeToken)
  }

  /** Raw token records (fork fields included) — the update base for PUT. */
  async listTokensRaw(): Promise<Record<string, unknown>[]> {
    const data = await this.managementGet('/api/token/?p=1&size=100')
    const items = Array.isArray(data) ? data : ((data as { items?: unknown[] })?.items ?? [])
    return items.filter(isObj)
  }

  /**
   * Create a key. The panel generates the secret; it is stripped here —
   * callers only see `{id, name}` and never the key material.
   */
  async createToken(input: {
    name: string
    group: string
    unlimitedQuota: boolean
    remainQuota?: number
    expiredTime?: number
  }): Promise<{ id: number | string, name: string }> {
    const data = await this.managementSend('POST', '/api/token/', {
      name: input.name,
      group: input.group,
      expired_time: input.expiredTime ?? -1,
      remain_quota: input.unlimitedQuota ? 0 : Math.max(0, Math.floor(input.remainQuota ?? 0)),
      unlimited_quota: input.unlimitedQuota,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
    }) as Record<string, unknown> | undefined
    const id = data?.id
    if (id === undefined) throw new RelayApiError('创建成功但面板未返回 key id')
    return { id: id as number | string, name: typeof data?.name === 'string' && data.name ? data.name : input.name }
  }

  /**
   * Update one key. `record` MUST be the panel's own list record with the
   * edited fields merged in — the endpoint is a whole-object update. Panel
   * semantics (new-api UpdateToken): the status field is only applied on the
   * `?status_only=true` variant, so enable/disable goes through that one.
   */
  async updateToken(record: Record<string, unknown>, statusOnly = false): Promise<void> {
    if (record.id === undefined) throw new RelayApiError('更新 key 需要 id')
    await this.managementSend('PUT', statusOnly ? '/api/token/?status_only=true' : '/api/token/', record)
  }

  async deleteToken(id: number | string): Promise<void> {
    await this.managementSend('DELETE', `/api/token/${id}`)
  }

  /** Model ids available to the account's group(s) (management view). */
  async userModels(): Promise<string[]> {
    const data = await this.managementGet('/api/user/models')
    return Array.isArray(data) ? data.map(String) : []
  }

  /** One page of the account's usage logs (`GET /api/log/self`), raw items. */
  async logs(params: {
    p: number
    pageSize: number
    startTimestamp?: number
    endTimestamp?: number
    tokenName?: string
    modelName?: string
    group?: string
  }): Promise<{ page: number, pageSize: number, total: number, items: Record<string, unknown>[] }> {
    const query = new URLSearchParams({
      p: String(Math.max(1, params.p)),
      page_size: String(Math.max(1, params.pageSize)),
      type: '0',
    })
    if (params.startTimestamp !== undefined) query.set('start_timestamp', String(params.startTimestamp))
    if (params.endTimestamp !== undefined) query.set('end_timestamp', String(params.endTimestamp))
    if (params.tokenName) query.set('token_name', params.tokenName)
    if (params.modelName) query.set('model_name', params.modelName)
    if (params.group) query.set('group', params.group)
    const data = await this.managementGet(`/api/log/self?${query.toString()}`) as Record<string, unknown> | undefined
    const items = Array.isArray(data) ? data : ((data as { items?: unknown[] })?.items ?? [])
    return {
      page: typeof data?.page === 'number' ? data.page : params.p,
      pageSize: typeof (data as { page_size?: unknown })?.page_size === 'number' ? (data as { page_size: number }).page_size : params.pageSize,
      total: typeof data?.total === 'number' ? data.total : items.length,
      items: items.filter(isObj),
    }
  }

  /** Usage statistics over an optional time window (`GET /api/log/self/stat`). */
  async logStat(startTimestamp?: number, endTimestamp?: number): Promise<{ quota: number, rpm: number, tpm: number }> {
    let path = '/api/log/self/stat'
    if (startTimestamp !== undefined || endTimestamp !== undefined) {
      const query = new URLSearchParams()
      if (startTimestamp !== undefined) query.set('start_timestamp', String(startTimestamp))
      if (endTimestamp !== undefined) query.set('end_timestamp', String(endTimestamp))
      path += `?${query.toString()}`
    }
    const data = await this.managementGet(path) as Record<string, unknown> | undefined
    return {
      quota: typeof data?.quota === 'number' ? data.quota : 0,
      rpm: typeof data?.rpm === 'number' ? data.rpm : 0,
      tpm: typeof data?.tpm === 'number' ? data.tpm : 0,
    }
  }

  /**
   * Per-model usage buckets (`GET /api/data/self`). Panels keep only recent
   * buckets, so the result may be sparse or empty by design. Hour buckets are
   * requested explicitly — day semantics differ across forks, the client
   * aggregates to days itself.
   */
  async usageData(startTimestamp: number, endTimestamp: number): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams({
      start_timestamp: String(startTimestamp),
      end_timestamp: String(endTimestamp),
      default_time: 'hour',
    })
    const data = await this.managementGet(`/api/data/self?${query.toString()}`)
    return Array.isArray(data) ? data.filter(isObj) : []
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
