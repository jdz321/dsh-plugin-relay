import { describe, expect, it } from 'vitest'

import {
  contextWindowHint,
  draftFromEntry,
  draftFromView,
  entryFromDraft,
  entrySummary,
  type CapabilityDraft,
} from '../src/client/capability-draft.js'
import { dictionaries, type Dictionary, type Translator } from '../src/client/locale.js'
import { parseContextWindow } from '../src/client/format.js'

/** A bound-style translator over the zh dictionary (property lookup). */
const t = ((key: keyof Dictionary) => dictionaries.zh[key]) as unknown as Translator

describe('parseContextWindow (K=1024 industry convention)', () => {
  it('parses plain digits, grouping separators, and underscores', () => {
    expect(parseContextWindow('131072')).toBe(131072)
    expect(parseContextWindow('1,048,576')).toBe(1_048_576)
    expect(parseContextWindow('1_048_576')).toBe(1_048_576)
    expect(parseContextWindow(' 4096 ')).toBe(4096)
  })

  it('applies K/M/B suffixes case-insensitively at 1024-based factors', () => {
    expect(parseContextWindow('128K')).toBe(131072)
    expect(parseContextWindow('256k')).toBe(262144)
    expect(parseContextWindow('1M')).toBe(1_048_576)
    expect(parseContextWindow('2m')).toBe(2_097_152)
    // 1B parses arithmetically but sits past the 10,000,000 ceiling
    expect(parseContextWindow('1B')).toBeNull()
  })

  it('rejects decimals, signs, unknown suffixes, zero, and out-of-range values', () => {
    expect(parseContextWindow('1.5M')).toBeNull()
    expect(parseContextWindow('-5')).toBeNull()
    expect(parseContextWindow('128G')).toBeNull()
    expect(parseContextWindow('0')).toBeNull()
    expect(parseContextWindow('0K')).toBeNull()
    expect(parseContextWindow('10000001')).toBeNull()
    expect(parseContextWindow('')).toBeNull()
    expect(parseContextWindow('abc')).toBeNull()
    expect(parseContextWindow('999999999B')).toBeNull()
  })
})

describe('contextWindowHint (live conversion display)', () => {
  it('shows the token count for suffix inputs', () => {
    expect(contextWindowHint('1M')).toBe('1M = 1,048,576')
    expect(contextWindowHint('256K')).toBe('256K = 262,144')
  })

  it('stays quiet for blank and invalid text', () => {
    expect(contextWindowHint('')).toBeNull()
    expect(contextWindowHint('128G')).toBeNull()
  })
})

describe('draftFromEntry / draftFromView (tri-state seeding)', () => {
  it('seeds from a stored entry', () => {
    const draft = draftFromEntry({ input: ['text'], reasoning: ['high'], contextWindow: 1048576 })
    expect(draft).toEqual({ input: ['text'], reasoning: 'on', levels: ['high'], contextWindow: '1048576' })
    expect(draftFromEntry({ reasoning: false }).reasoning).toBe('off')
    expect(draftFromEntry({}).reasoning).toBeNull()
  })

  it('seeds from a nullable server view (null → undeclared)', () => {
    const draft = draftFromView({ input: ['text', 'image'], reasoning: null, contextWindow: null })
    expect(draft).toEqual({ input: ['text', 'image'], reasoning: null, levels: [], contextWindow: '' })
    expect(draftFromView({ reasoning: false }).reasoning).toBe('off')
  })
})

describe('entryFromDraft (client-side validation before POST)', () => {
  it('omits empty fields and returns undefined for a blank draft', () => {
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '' })).toBeUndefined()
    expect(entryFromDraft({ input: ['text'], reasoning: null, levels: [], contextWindow: '' })).toEqual({ input: ['text'] })
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

  it('converts suffix shorthand into numeric token counts', () => {
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '1M' })!.contextWindow).toBe(1_048_576)
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '256k' })!.contextWindow).toBe(262_144)
    expect(() => entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '10M' })).toThrow('context-invalid')
  })
})

describe('entrySummary (one-line row text)', () => {
  it('joins raw modality ids, reasoning, and window with placeholders', () => {
    const summary = entrySummary({ input: ['text', 'image'], reasoning: ['low', 'high'], contextWindow: 1048576 }, t)
    expect(summary).toBe('text / image · low / high · 1048576')
    expect(entrySummary(undefined, t)).toBe(`— · 未声明 · —`)
    expect(entrySummary({ reasoning: false }, t)).toContain('非推理')
  })
})
