import { describe, expect, it } from 'vitest'

import { groupRatioOf, normalizePricing, priceEntry } from '../src/pricing.js'
import { keySummary } from '../src/plan.js'

const NEW_API_BODY = {
  success: true,
  data: [
    {
      model_name: 'deepseek-v4-pro', quota_type: 0, model_ratio: 0, model_price: 0,
      input_price: 9, output_price: 27, cache_read_price: 0.9, billing_mode: 'token',
      completion_ratio: 0, enable_groups: ['default', 'budget'], vendor_id: 4,
    },
    {
      model_name: 'gpt-x', quota_type: 0, model_ratio: 0.38, model_price: 0,
      input_price: 0, output_price: 0, completion_ratio: 4, enable_groups: ['default'],
    },
    {
      model_name: 'claude-call', quota_type: 1, model_ratio: 0, model_price: 0.5,
      input_price: 0, output_price: 0, completion_ratio: 0, enable_groups: ['vip'],
    },
  ],
  vendors: [{ id: 4, name: 'DeepSeek' }],
  group_ratio: { default: 1, vip: 0.8, budget: 0.35 },
  usable_group: { default: '默认分组', vip: 'VIP 分组' },
}

describe('normalizePricing', () => {
  it('shapes all three billing dialects, group ratios and vendors', () => {
    const pricing = normalizePricing(NEW_API_BODY)
    expect(pricing!.groupRatio['budget']).toBe(0.35)
    expect(pricing!.usableGroup.vip).toBe('VIP 分组')
    expect(pricing!.byModel.get('deepseek-v4-pro')!.inputPrice).toBe(9)
    expect(pricing!.byModel.get('deepseek-v4-pro')!.billingMode).toBe('token')
    expect(pricing!.byModel.get('gpt-x')!.modelRatio).toBe(0.38)
    expect(pricing!.byModel.get('claude-call')!.quotaType).toBe(1)
    // vendor fork extension: entry vendor_id → vendor name, missing → null
    expect(pricing!.byModel.get('deepseek-v4-pro')!.vendor).toBe('DeepSeek')
    expect(pricing!.byModel.get('gpt-x')!.vendor).toBeNull()
  })

  it('returns null for missing/disabled tables', () => {
    expect(normalizePricing(null)).toBeNull()
    expect(normalizePricing({ success: false, message: '无权' })).toBeNull()
    const empty = normalizePricing({ success: true, data: [] })!
    expect(empty.byModel.size).toBe(0)
    expect(empty.groupRatio).toEqual({})
  })
})

describe('priceEntry', () => {
  it('classifies token / call / ratio / unknown', () => {
    const pricing = normalizePricing(NEW_API_BODY)
    expect(priceEntry('deepseek-v4-pro', pricing).kind).toBe('token')
    expect(priceEntry('claude-call', pricing).kind).toBe('call')
    expect(priceEntry('gpt-x', pricing).kind).toBe('ratio')
    const unknown = priceEntry('never-heard-of', pricing)
    expect(unknown.kind).toBeNull()
    expect(unknown.groups).toEqual([])
    expect(priceEntry('anything', null).groups).toEqual([])
    expect(priceEntry('deepseek-v4-pro', pricing)!.groups.includes('budget')).toBe(true)
  })
})

describe('groupRatioOf', () => {
  it('reads the group map, null when absent', () => {
    const pricing = normalizePricing(NEW_API_BODY)
    expect(groupRatioOf(pricing, 'vip')).toBe(0.8)
    expect(groupRatioOf(pricing, 'nope')).toBeNull()
    expect(groupRatioOf(null, 'default')).toBeNull()
  })
})

describe('keySummary', () => {
  it('exposes metadata only — never key material', () => {
    const summary = keySummary(
      {
        id: 7, name: '主-key', key: 'sk-secret', status: 1, enabled: true, statusLabel: 'enabled',
        group: 'vip', models: [], unlimitedQuota: false, remainQuota: 240000,
        usedQuota: 10000, expiredTime: -1, neverExpires: true, createdTime: undefined, accessedTime: undefined,
      },
      { selectedName: '主-key', groupRatio: 0.8 },
    )
    expect(summary.name).toBe('主-key')
    expect(summary.group).toBe('vip')
    expect(summary.groupRatio).toBe(0.8)
    expect(summary.remainCny).toBe('0.4800')
    expect(summary.usedCny).toBe('0.0200')
    expect(summary.neverExpires).toBe(true)
    expect(summary.selected).toBe(true)
    const text = JSON.stringify(summary)
    expect(text).not.toMatch(/sk-/)
    expect('key' in summary).toBe(false)
  })
})
