import { describe, expect, it } from 'vitest'

import { buildCatalog, cleanModelEntry, mergeCatalog, modelEntry } from '../src/catalog.js'

describe('modelEntry / buildCatalog (identity is the id)', () => {
  it('writes name = id — no generated display names', () => {
    const entry = modelEntry('deepseek-chat')
    expect(entry.name).toBe('deepseek-chat')
    expect(entry.contextWindow).toBe(131072)
    expect(entry.maxTokens).toBe(8192)
    expect(entry.compat).toEqual({ thinkingFormat: 'deepseek' })
  })

  it('applies capacity heuristics with a fallback', () => {
    expect(modelEntry('claude-sonnet-4-5')!.contextWindow).toBe(200000)
    expect(modelEntry('totally-unknown-model').contextWindow).toBe(131072)
    expect(modelEntry('totally-unknown-model').maxTokens).toBe(8192)
  })

  it('surfaces preferred ids first, then alphabetical', () => {
    const ids = buildCatalog(['zeta', 'alpha', 'deepseek-chat'], undefined, ['deepseek-chat'])
    expect(ids.map((e) => e.id)).toEqual(['deepseek-chat', 'alpha', 'zeta'])
  })
})

describe('cleanModelEntry', () => {
  it('strips materialized no-value fields', () => {
    const cleaned = cleanModelEntry({ id: 'm', name: 'm', input: [], compat: {}, reasoningEfforts: false })
    expect(cleaned.input).toBeUndefined()
    expect(cleaned.compat).toBeUndefined()
    expect(cleaned.reasoningEfforts).toBe(false)
  })
})

describe('mergeCatalog (catalog sync must not clobber stored fields)', () => {
  const stored = [
    { id: 'alpha', name: 'alpha', contextWindow: 999999, maxTokens: 12345, input: ['text', 'image'], reasoningEfforts: { off: null, high: 'high' } },
    { id: 'manual-only', name: 'manual-only', contextWindow: 4096 },
    { id: 'gone', name: 'gone' },
  ]

  it('keeps capability config and manual capacities of surviving ids', () => {
    const merged = mergeCatalog(['alpha', 'beta', 'gone-extra-not-in-stored'], stored)
    const alpha = merged.find((e) => e.id === 'alpha')!
    expect(alpha.contextWindow).toBe(999999)
    expect(alpha.maxTokens).toBe(12345)
    expect(alpha.input).toEqual(['text', 'image'])
    expect(alpha.reasoningEfforts).toEqual({ off: null, high: 'high' })
    // new id gets a fresh heuristic entry
    const beta = merged.find((e) => e.id === 'beta')!
    expect(beta.name).toBe('beta')
    expect(beta.contextWindow).toBe(131072)
    // ids the key lost are dropped
    expect(merged.find((e) => e.id === 'gone')).toBeUndefined()
  })

  it('keeps manual-only entries the key list does not know about when still selected', () => {
    // manual-only is NOT in the ids → dropped (route = key's callable set)
    const merged = mergeCatalog(['alpha'], stored)
    expect(merged.find((e) => e.id === 'manual-only')).toBeUndefined()
    // but when present in the ids it survives verbatim
    const kept = mergeCatalog(['alpha', 'manual-only'], stored)
    expect(kept.find((e) => e.id === 'manual-only')!.contextWindow).toBe(4096)
  })

  it('handles an empty stored catalog', () => {
    const merged = mergeCatalog(['b', 'a'], [])
    expect(merged.map((e) => e.id)).toEqual(['a', 'b'])
  })
})
