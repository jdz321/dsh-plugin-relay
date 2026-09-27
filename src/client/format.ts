/**
 * Pure display helpers of the browser face — no React, fully unit-testable.
 */

import type { Translator } from './locale.js'

export interface PriceView {
  kind: 'token' | 'call' | 'ratio' | null
  vendor?: string | null
  inputPrice?: number
  outputPrice?: number
  cacheReadPrice?: number
  modelPrice?: number
  modelRatio?: number
  completionRatio?: number
  groups?: string[]
}

/** 2 → "2", 0.35 → "0.35": drop float noise without losing precision. */
export function trimNum(n: number): string {
  return String(Number((Number(n) || 0).toFixed(4)))
}

/** One-line price text for a model pricing entry. */
export function priceText(price: PriceView | null | undefined, t: Translator): string {
  if (!price || price.kind === null) return t('priceNone')
  if (price.kind === 'token') {
    let s = `${t('priceIn')} $${trimNum(price.inputPrice ?? 0)} · ${t('priceOut')} $${trimNum(price.outputPrice ?? 0)}`
    if ((price.cacheReadPrice ?? 0) > 0) s += ` · ${t('priceCache')} $${trimNum(price.cacheReadPrice ?? 0)}`
    return `${s} / 1M tokens`
  }
  if (price.kind === 'call') return `${t('pricePerCall')} $${trimNum(price.modelPrice ?? 0)}`
  const out = (price.completionRatio ?? 0) > 0 ? (price.modelRatio ?? 0) * (price.completionRatio ?? 0) : 0
  return out > 0
    ? `${t('priceRatio')} ${trimNum(price.modelRatio ?? 0)}× · ${t('priceCompletion')} ${trimNum(out)}×`
    : `${t('priceRatio')} ${trimNum(price.modelRatio ?? 0)}×`
}

export interface KeyMetaView {
  group?: string
  groupRatio?: number | null
  unlimited?: boolean
  remainCny?: string | null
  usedCny?: string | null
  neverExpires?: boolean
  expiredTime?: number
}

/** Metadata line under each key name: group, ratio, quota, expiry. */
export function keyMetaText(key: KeyMetaView, t: Translator): string {
  const parts: string[] = []
  if (key.group) parts.push(`${t('groupLabel')} ${key.group}`)
  if (typeof key.groupRatio === 'number') parts.push(`${t('ratioLabel')} ${trimNum(key.groupRatio)}×`)
  if (key.unlimited) parts.push(t('unlimitedQuota'))
  else parts.push(`${t('remainLabel')} ¥${key.remainCny ?? '?'} · ${t('usedLabel')} ¥${key.usedCny ?? '?'}`)
  if (key.neverExpires) parts.push(t('neverExpires'))
  else if ((key.expiredTime ?? 0) > 0) parts.push(t('expiresAt')(new Date((key.expiredTime ?? 0) * 1000).toLocaleDateString()))
  return parts.join(' · ')
}

/** "missing:accessToken" / "no-active-key" → localized hint, else null. */
export function setupHintFor(error: string, t: Translator): string | null {
  if (error === 'missing:baseUrl') return t('setupHintBaseUrl')
  if (error === 'missing:accessToken') return t('setupHintToken')
  if (error === 'missing:userId') return t('setupHintUserId')
  if (error === 'no-active-key') return t('noActiveKey')
  return null
}

/** Normalize a user-entered base URL: trim + strip trailing slashes. */
export function normalizeBaseUrlDraft(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/** Upper bound the host also enforces (knowledge.ts CONTEXT_WINDOW_MAX). */
export const CONTEXT_WINDOW_MAX = 10_000_000

const SUFFIX_FACTORS: Record<string, number> = { k: 1024, m: 1024 ** 2, b: 1024 ** 3 }

/**
 * Parse a token-count text input into tokens. Accepts plain digits plus a
 * K/M/B suffix (case-insensitive, 1024-based — `1M` = 1,048,576, matching the
 * `128K = 131072` industry convention); whitespace, commas, and underscores
 * are ignored (`1_048_576` and `1,048,576` both parse). Returns null for
 * anything else — decimals, signs, unknown suffixes, 0, or values past `max`
 * (the host would reject them anyway). The context window caps at 10M, the
 * output limit (maxTokens) at 1,048,576.
 */
export function parseContextWindow(text: string, max: number = CONTEXT_WINDOW_MAX): number | null {
  const cleaned = text.replace(/[\s,_]/g, '')
  const match = /^(\d+)([kKmMbB]?)$/.exec(cleaned)
  if (!match) return null
  const factor = match[2] ? SUFFIX_FACTORS[match[2].toLowerCase()]! : 1
  const value = Number(match[1]) * factor
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) return null
  return value
}

/** `1,048,576`-style grouping for the live conversion hint. */
export function groupedNumber(n: number): string {
  return n.toLocaleString('en-US')
}

/** Quota points → compact CNY estimate (for form hints; 4 decimals trimmed). */
export function pointsToCnyText(points: number): string {
  return trimNum(points / 500000)
}

/**
 * Label of one group option in the key editor's group selector:
 * 「claude-stable 0.65x (高智高缓，稳定)」 — ratio and description pieces drop
 * out when the panel does not report them.
 */
export function groupOptionLabel(name: string, ratio: number | null | undefined, description: string | null | undefined): string {
  let label = name
  if (typeof ratio === 'number' && Number.isFinite(ratio)) label += ` ${trimNum(ratio)}x`
  const desc = (description ?? '').trim()
  if (desc) label += ` (${desc})`
  return label
}

/** Local `MM-DD HH:mm:ss` for a unix-seconds log timestamp. */
export function formatLogTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const d = new Date(seconds * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** `4.2s` style duration; null renders as an em dash. */
export function secondsLabel(seconds: number | null): string {
  return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? `${seconds.toFixed(1)}s` : '—'
}

/** `YYYY-MM-DDTHH:mm` for a datetime-local input from unix seconds. */
export function datetimeLocalValue(seconds: number): string {
  const d = new Date(seconds * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Unix seconds from a datetime-local input value; NaN when empty/invalid. */
export function datetimeLocalSeconds(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? NaN : Math.floor(parsed / 1000)
}

/** Local midnight seconds of the first day of the current month. */
export function startOfMonthSeconds(now = new Date()): number {
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime() / 1000)
}

/** Local 23:59:59 seconds of the last day of the current month. */
export function endOfMonthSeconds(now = new Date()): number {
  return Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 0).getTime() / 1000)
}

/** Unix seconds at 23:59:59 local of the given `YYYY-MM-DD` date value; NaN when empty. */
export function endOfDaySeconds(dateValue: string): number {
  if (!dateValue) return NaN
  const parsed = new Date(`${dateValue}T23:59:59`)
  return Number.isNaN(parsed.getTime()) ? NaN : Math.floor(parsed.getTime() / 1000)
}

/** `YYYY-MM-DD` of a unix-seconds timestamp, local calendar. */
export function dateInputValue(seconds: number): string {
  const d = new Date(seconds * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
