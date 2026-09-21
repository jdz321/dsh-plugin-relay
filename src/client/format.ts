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
