import { describe, expect, it } from 'vitest'

import {
  aggregateDailyBuckets,
  buildDashboardView,
  dayKeyFromSeconds,
  firstResponseSeconds,
  normalizeLog,
  startOfDaysAgo,
  startOfToday,
} from '../src/usage.js'

describe('firstResponseSeconds (the fork hides frt in the `other` JSON blob)', () => {
  it('parses milliseconds into seconds', () => {
    expect(firstResponseSeconds(JSON.stringify({ frt: 4200 }))).toBe(4.2)
    expect(firstResponseSeconds(JSON.stringify({ frt: 900 }))).toBe(0.9)
  })

  it('tolerates missing, malformed, and reshaped payloads', () => {
    expect(firstResponseSeconds(undefined)).toBeNull()
    expect(firstResponseSeconds('')).toBeNull()
    expect(firstResponseSeconds('not-json-on-purpose')).toBeNull()
    expect(firstResponseSeconds(JSON.stringify({ frt: 'whoops' }))).toBeNull()
    expect(firstResponseSeconds(JSON.stringify({ frt: 0 }))).toBeNull()
    expect(firstResponseSeconds(JSON.stringify([1, 2]))).toBeNull()
    expect(firstResponseSeconds('null')).toBeNull()
  })
})

describe('normalizeLog', () => {
  it('shapes a full consume row', () => {
    const view = normalizeLog({
      created_at: 1758000000,
      token_name: 'k1',
      group: 'default',
      model_name: 'deepseek-chat',
      quota: 9664,
      prompt_tokens: 2,
      completion_tokens: 348,
      cache_creation_tokens: 267,
      cache_read_tokens: 134000,
      reasoning_tokens: 512,
      reasoning_effort: 'high',
      use_time: 9,
      is_stream: 1,
      other: JSON.stringify({ frt: 4200 }),
    })
    expect(view).toMatchObject({
      createdAt: 1758000000,
      tokenName: 'k1',
      group: 'default',
      modelName: 'deepseek-chat',
      quota: 9664,
      promptTokens: 2,
      completionTokens: 348,
      cacheCreationTokens: 267,
      cacheReadTokens: 134000,
      reasoningTokens: 512,
      reasoningEffort: 'high',
      useTime: 9,
      isStream: true,
      frt: 4.2,
    })
  })

  it('degrades missing fields without throwing', () => {
    const view = normalizeLog({})
    expect(view.frt).toBeNull()
    expect(view.isStream).toBe(false)
    expect(view.modelName).toBe('')
    expect(view.quota).toBe(0)
  })
})

describe('day bucketing', () => {
  it('produces local-calendar keys and midnight boundaries', () => {
    const now = new Date(2026, 8, 24, 15, 30, 0)
    const nowSeconds = Math.floor(now.getTime() / 1000)
    expect(dayKeyFromSeconds(nowSeconds)).toBe('2026-09-24')
    expect(dayKeyFromSeconds(startOfToday(nowSeconds))).toBe('2026-09-24')
    const sixDaysBack = startOfDaysAgo(nowSeconds, 6)
    expect(dayKeyFromSeconds(sixDaysBack)).toBe('2026-09-18')
    const boundary = new Date(sixDaysBack * 1000)
    expect(boundary.getHours()).toBe(0)
    expect(boundary.getMinutes()).toBe(0)
    expect(boundary.getSeconds()).toBe(0)
  })
})

describe('aggregateDailyBuckets (panel hour buckets → per-day per-model cells)', () => {
  const now = new Date(2026, 8, 24, 20, 0, 0)
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const hourOf = (daysBack: number, hour: number): number => {
    const date = new Date(now)
    date.setDate(date.getDate() - daysBack)
    date.setHours(hour, 0, 0, 0)
    return Math.floor(date.getTime() / 1000)
  }

  it('aggregates, converts quota to CNY, and drops buckets outside the window', () => {
    const cells = aggregateDailyBuckets([
      { model_name: 'deepseek-chat', created_at: hourOf(0, 9), token_used: 350, count: 2, quota: 2_500_000 },
      { model_name: 'deepseek-chat', created_at: hourOf(0, 10), token_used: 150, count: 1, quota: 500_000 },
      { model_name: 'gpt-4o', created_at: hourOf(2, 8), token_used: 64, count: 1, quota: 250_000 },
      { model_name: 'old', created_at: hourOf(9, 8), token_used: 99, count: 1, quota: 999 },
    ], 7, nowSeconds)
    expect(cells).toHaveLength(2)
    const today = cells.find((c) => c.date === '2026-09-24' && c.model === 'deepseek-chat')!
    expect(today.quota).toBeCloseTo(6, 6)
    expect(today.tokens).toBe(500)
    expect(cells.find((c) => c.model === 'old')).toBeUndefined()
  })

  it('keeps unknown model names and handles empty input as a normal path', () => {
    expect(aggregateDailyBuckets([], 7, nowSeconds)).toEqual([])
    const cells = aggregateDailyBuckets([{ created_at: hourOf(1, 3), token_used: 1, quota: 0 }], 7, nowSeconds)
    expect(cells[0]!.model).toBe('unknown')
  })
})

describe('buildDashboardView', () => {
  const nowSeconds = Math.floor(new Date(2026, 8, 24, 20, 0, 0).getTime() / 1000)
  const today = dayKeyFromSeconds(nowSeconds)

  it('assembles cards from self and today stat, tokens counted from today buckets', () => {
    const view = buildDashboardView({
      self: { quota: 25_500_000, used_quota: 300_145_000, request_count: 128 },
      todayStatQuota: 9_664,
      buckets: [
        { date: today, model: 'deepseek-chat', quota: 0.02, tokens: 350 },
        { date: '2026-09-20', model: 'gpt-4o', quota: 0.5, tokens: 64 },
      ],
      days: 7,
      nowSeconds,
    })
    expect(view.balanceCny).toBe('51.0000')
    expect(view.todayUsedCny).toBe('0.0193')
    expect(view.todayTokens).toBe(350)
    expect(view.totalUsedCny).toBe('600.2900')
    expect(view.totalRequests).toBe(128)
    expect(view.days).toBe(7)
  })

  it('degrades to nulls when the account context is missing', () => {
    const view = buildDashboardView({ self: null, todayStatQuota: 0, buckets: [], days: 7, nowSeconds })
    expect(view.balanceCny).toBeNull()
    expect(view.totalUsedCny).toBeNull()
    expect(view.totalRequests).toBeNull()
    expect(view.todayTokens).toBe(0)
  })
})
