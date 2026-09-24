import { describe, expect, it } from 'vitest'

import {
  entryFromDraft,
  reconcileKbRows,
  reconcileOverrides,
  type CapDictEntry,
  type KbRow,
  type OverrideDraft,
} from '../src/client/capabilities.js'

const SERVER_CATALOG: Record<string, CapDictEntry> = {
  alpha: { input: ['text'], reasoning: ['high'], contextWindow: 131072 },
  beta: { reasoning: false },
}

function row(name: string, dirty: boolean): KbRow {
  return { name, input: [], reasoning: null, levels: [], contextWindow: '', dirty }
}

function draft(dirty: boolean): OverrideDraft {
  return { input: [], reasoning: null, levels: [], contextWindow: '', dirty }
}

describe('reconcileKbRows (browser regression: rebuilds must not wipe drafts)', () => {
  it('builds rows from the server catalog', () => {
    const rows = reconcileKbRows(SERVER_CATALOG, [], [])
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta'])
    const alpha = rows[0]!
    expect(alpha.input).toEqual(['text'])
    expect(alpha.reasoning).toBe('on')
    expect(alpha.levels).toEqual(['high'])
    expect(alpha.contextWindow).toBe('131072')
    expect(alpha.dirty).toBe(false)
    expect(rows[1]!.reasoning).toBe('off')
  })

  it('keeps dirty drafts across a rebuild; clean rows take the server view', () => {
    const previous = [
      { ...row('alpha', true), input: ['image'], contextWindow: '99' },
      row('gamma', true),
    ]
    const rows = reconcileKbRows(SERVER_CATALOG, previous, [])
    const alpha = rows.find((r) => r.name === 'alpha')!
    expect(alpha.dirty).toBe(true)
    expect(alpha.input).toEqual(['image'])
    expect(alpha.contextWindow).toBe('99')
    // mid-add row (not on the server yet) survives
    expect(rows.find((r) => r.name === 'gamma')).toBeTruthy()
    const beta = rows.find((r) => r.name === 'beta')!
    expect(beta.dirty).toBe(false)
  })

  it('deleted rows stay deleted until the next save', () => {
    const rows = reconcileKbRows(SERVER_CATALOG, [], ['beta'])
    expect(rows.map((r) => r.name)).toEqual(['alpha'])
  })
})

describe('reconcileOverrides', () => {
  it('reads the server dict into clean drafts', () => {
    const drafts = reconcileOverrides({ m1: { input: ['text', 'image'] } }, {}, [])
    expect(drafts.m1).toEqual({ input: ['text', 'image'], reasoning: null, levels: [], contextWindow: '', dirty: false })
  })

  it('keeps dirty drafts, refreshes clean ones, and honors cleared ids', () => {
    const previous = {
      m1: { ...draft(true), input: ['text'] },
      m2: draft(false),
      m3: draft(true),
    }
    const drafts = reconcileOverrides(
      { m1: {}, m2: { contextWindow: 10 }, m4: {} },
      previous,
      ['m3'],
    )
    expect(drafts.m1!.dirty).toBe(true)
    expect(drafts.m1!.input).toEqual(['text'])
    expect(drafts.m2!.contextWindow).toBe('10')
    expect(drafts.m3).toBeUndefined()
    expect(drafts.m4).toBeTruthy()
  })
})

describe('entryFromDraft (client-side validation before POST)', () => {
  it('omits empty fields and returns undefined for a blank draft', () => {
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '' })).toBeUndefined()
    const entry = entryFromDraft({ input: ['text'], reasoning: null, levels: [], contextWindow: '' })!
    expect(entry).toEqual({ input: ['text'] })
  })

  it('maps the tri-state reasoning', () => {
    expect(entryFromDraft({ input: [], reasoning: 'off', levels: [], contextWindow: '' })!.reasoning).toBe(false)
    expect(entryFromDraft({ input: [], reasoning: 'on', levels: ['low'], contextWindow: '' })!.reasoning).toEqual(['low'])
  })

  it('rejects empty level sets and non-integer context windows', () => {
    expect(() => entryFromDraft({ input: [], reasoning: 'on', levels: [], contextWindow: '' })).toThrow('levels-required')
    expect(() => entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '12.5' })).toThrow('context-invalid')
    expect(() => entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '0' })).toThrow('context-invalid')
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '4096 ' })!.contextWindow).toBe(4096)
  })
})
