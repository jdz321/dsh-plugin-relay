import { describe, expect, it } from 'vitest'

import { reconcileCards, type CapEntry } from '../src/client/capabilities.js'

const vendorOf = (id: string): string | null => (id === 'alpha' ? 'VendorX' : null)

const CAPS: CapEntry[] = [
  { id: 'alpha', input: ['text'], reasoning: ['high'] },
  { id: 'beta', input: null, reasoning: false },
]

describe('reconcileCards (browser regression: rebuilds must not wipe drafts)', () => {
  it('builds cards from server data plus the key list', () => {
    const cards = reconcileCards(CAPS, new Set(['beta', 'gamma']), vendorOf, [], [])
    expect(cards.map((c) => c.id)).toEqual(['alpha', 'beta', 'gamma'])
    const alpha = cards.find((c) => c.id === 'alpha')!
    expect(alpha.vendor).toBe('VendorX')
    expect(alpha.input).toEqual(['text'])
    expect(alpha.reasoning).toBe('on')
    expect(alpha.levels).toEqual(['high'])
    expect(alpha.stored).toBe(true)
    const beta = cards.find((c) => c.id === 'beta')!
    expect(beta.reasoning).toBe('off')
    expect(beta.removable).toBe(false)
    const gamma = cards.find((c) => c.id === 'gamma')!
    expect(gamma.stored).toBe(false)
    expect(gamma.dirty).toBe(false)
  })

  it('keeps dirty drafts across a rebuild (mid-edit refresh)', () => {
    const previous = [
      { id: 'beta', input: ['image'], reasoning: 'on' as const, levels: ['low'], vendor: null, removable: false, stored: true, dirty: true },
      { id: 'gamma', input: [], reasoning: null, levels: [], vendor: null, removable: false, stored: false, dirty: false },
    ]
    const cards = reconcileCards(CAPS, new Set(['beta', 'gamma']), vendorOf, previous, [])
    const beta = cards.find((c) => c.id === 'beta')!
    expect(beta.dirty).toBe(true)
    expect(beta.input).toEqual(['image'])
    expect(beta.reasoning).toBe('on')
    // clean cards take the server view
    const gamma = cards.find((c) => c.id === 'gamma')!
    expect(gamma.dirty).toBe(false)
    expect(gamma.reasoning).toBeNull()
  })

  it('keeps manual additions until saved; drops them once stored', () => {
    const withAdded = reconcileCards([], new Set(), vendorOf, [], ['my-model'])
    expect(withAdded.map((c) => c.id)).toEqual(['my-model'])
    expect(withAdded[0]!.dirty).toBe(true)
    expect(withAdded[0]!.removable).toBe(true)
    // After a successful save the component clears the local dirty flags and
    // refreshes; the rebuild then takes the server view for clean cards.
    const saved: CapEntry[] = [{ id: 'my-model', input: null, reasoning: null }]
    const afterSave = reconcileCards(saved, new Set(['my-model']), vendorOf, withAdded.map((c) => ({ ...c, dirty: false })), ['my-model'])
    const card = afterSave.find((c) => c.id === 'my-model')!
    expect(card.dirty).toBe(false)
  })
})
