import { describe, expect, it } from 'vitest'

import { groupOptionLabel } from '../src/client/format.js'

describe('groupOptionLabel (key editor group selector)', () => {
  it('joins name, ratio and description exactly as specified', () => {
    expect(groupOptionLabel('claude-stable', 0.65, '高智高缓，稳定')).toBe('claude-stable 0.65x (高智高缓，稳定)')
  })

  it('trims float noise; ratio 1 renders as 1x', () => {
    expect(groupOptionLabel('default', 1, '默认分组')).toBe('default 1x (默认分组)')
    expect(groupOptionLabel('vip', 0.8, 'VIP 分组')).toBe('vip 0.8x (VIP 分组)')
    expect(groupOptionLabel('ratio-ish', 1.00000001, null)).toBe('ratio-ish 1x')
  })

  it('drops pieces the panel does not report', () => {
    expect(groupOptionLabel('solo', null, null)).toBe('solo')
    expect(groupOptionLabel('solo', undefined, '')).toBe('solo')
    expect(groupOptionLabel('solo', null, ' 描述 ')).toBe('solo (描述)')
    expect(groupOptionLabel('solo', Number.NaN, '描述')).toBe('solo (描述)')
  })
})
