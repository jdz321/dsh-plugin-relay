/**
 * Shaping for the usage logs page and the data dashboard. Pure logic over
 * panel payloads: log rows (with the `other` JSON blob relaxed into a
 * first-response-time field) and hour buckets aggregated into per-day,
 * per-model series the chart consumes. Panels keep only recent buckets, so
 * sparse and empty inputs are normal paths, never errors.
 */

import { formatQuota } from './plan.js'

/** One usage-log row as the logs table renders it. */
export interface LogEntryView {
  createdAt: number
  tokenName: string
  group: string
  modelName: string
  /** Quota points of this request; CNY via formatQuota. */
  quota: number
  promptTokens: number
  completionTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  reasoningEffort: string
  /** Total request duration in seconds. */
  useTime: number
  isStream: boolean
  /** First-response time in seconds (panel stores milliseconds in `other`). */
  frt: number | null
}

function numOf(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Parse the fork's `other` JSON string for `frt` (first response time, ms).
 * Tolerates missing/non-JSON/renamed fields — a broken `other` must never
 * take the logs page down.
 */
export function firstResponseSeconds(other: unknown): number | null {
  if (typeof other !== 'string' || !other) return null
  try {
    const parsed = JSON.parse(other) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const ms = numOf((parsed as Record<string, unknown>).frt)
    return ms > 0 ? ms / 1000 : null
  } catch {
    return null
  }
}

export function normalizeLog(raw: Record<string, unknown>): LogEntryView {
  return {
    createdAt: numOf(raw.created_at),
    tokenName: typeof raw.token_name === 'string' ? raw.token_name : '',
    group: typeof raw.group === 'string' ? raw.group : '',
    modelName: typeof raw.model_name === 'string' ? raw.model_name : '',
    quota: numOf(raw.quota),
    promptTokens: numOf(raw.prompt_tokens),
    completionTokens: numOf(raw.completion_tokens),
    cacheCreationTokens: numOf(raw.cache_creation_tokens),
    cacheReadTokens: numOf(raw.cache_read_tokens),
    reasoningTokens: numOf(raw.reasoning_tokens),
    reasoningEffort: typeof raw.reasoning_effort === 'string' ? raw.reasoning_effort : '',
    useTime: numOf(raw.use_time),
    isStream: raw.is_stream === true || raw.is_stream === 1,
    frt: firstResponseSeconds(raw.other),
  }
}

/** One aggregated chart cell: a calendar day × model with ¥ and tokens. */
export interface UsageBucket {
  date: string
  model: string
  quota: number
  tokens: number
}

/** Local-calendar `YYYY-MM-DD` for a unix-seconds timestamp. */
export function dayKeyFromSeconds(seconds: number): string {
  const date = new Date(seconds * 1000)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Local midnight (unix seconds) N days before `nowSeconds`'s day. */
export function startOfDaysAgo(nowSeconds: number, daysBack: number): number {
  const date = new Date(nowSeconds * 1000)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysBack)
  return Math.floor(date.getTime() / 1000)
}

/** Local midnight (unix seconds) of `nowSeconds`'s day. */
export function startOfToday(nowSeconds: number): number {
  return startOfDaysAgo(nowSeconds, 0)
}

/**
 * Aggregate panel hour buckets into per-day per-model cells over the last
 * `days` calendar days (today included). `quota` is converted to CNY. Sparse
 * panel data simply yields fewer cells; unknown models are kept as-is.
 */
export function aggregateDailyBuckets(raw: readonly Record<string, unknown>[], days: number, nowSeconds: number): UsageBucket[] {
  const oldest = startOfDaysAgo(nowSeconds, days - 1)
  const byDayModel = new Map<string, UsageBucket>()
  for (const bucket of raw) {
    const createdAt = numOf(bucket.created_at)
    if (createdAt < oldest) continue
    const date = dayKeyFromSeconds(createdAt)
    const model = typeof bucket.model_name === 'string' && bucket.model_name ? bucket.model_name : 'unknown'
    const key = `${date}\u0000${model}`
    const cell = byDayModel.get(key) ?? { date, model, quota: 0, tokens: 0 }
    cell.quota += numOf(bucket.quota) / 500000
    cell.tokens += numOf(bucket.token_used)
    byDayModel.set(key, cell)
  }
  return [...byDayModel.values()].sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model))
}

/** The dashboard payload shape served to the client. */
export interface DashboardView {
  balanceCny: string | null
  todayUsedCny: string
  todayTokens: number
  totalUsedCny: string | null
  totalRequests: number | null
  days: number
  buckets: UsageBucket[]
}

/** Assemble the dashboard view from the three panel payloads. Pure. */
export function buildDashboardView(input: {
  self: Record<string, unknown> | null
  todayStatQuota: number
  buckets: UsageBucket[]
  days: number
  nowSeconds: number
}): DashboardView {
  const today = dayKeyFromSeconds(input.nowSeconds)
  return {
    balanceCny: input.self ? formatQuota(input.self.quota as number | undefined) : null,
    todayUsedCny: formatQuota(input.todayStatQuota),
    todayTokens: input.buckets.filter((cell) => cell.date === today).reduce((sum, cell) => sum + cell.tokens, 0),
    totalUsedCny: input.self ? formatQuota(input.self.used_quota as number | undefined) : null,
    totalRequests: input.self && typeof input.self.request_count === 'number' ? input.self.request_count : null,
    days: input.days,
    buckets: input.buckets,
  }
}
