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
    expect(draft).toEqual({ input: ['text'], reasoning: 'on', levels: ['high'], contextWindow: '1048576', maxTokens: '' })
    expect(draftFromEntry({ reasoning: false }).reasoning).toBe('off')
    expect(draftFromEntry({}).reasoning).toBeNull()
  })

  it('seeds maxTokens as raw text', () => {
    expect(draftFromEntry({ maxTokens: 65536 }).maxTokens).toBe('65536')
    expect(draftFromEntry({}).maxTokens).toBe('')
    expect(draftFromView({ maxTokens: null }).maxTokens).toBe('')
    expect(draftFromView({ maxTokens: 32768 }).maxTokens).toBe('32768')
  })

  it('seeds from a nullable server view (null → undeclared)', () => {
    const draft = draftFromView({ input: ['text', 'image'], reasoning: null, contextWindow: null })
    expect(draft).toEqual({ input: ['text', 'image'], reasoning: null, levels: [], contextWindow: '', maxTokens: '' })
    expect(draftFromView({ reasoning: false }).reasoning).toBe('off')
  })
})

describe('entryFromDraft (client-side validation before POST)', () => {
  it('omits empty fields and returns undefined for a blank draft', () => {
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '', maxTokens: '' })).toBeUndefined()
    expect(entryFromDraft({ input: ['text'], reasoning: null, levels: [], contextWindow: '', maxTokens: '' })).toEqual({ input: ['text'] })
  })

  it('maps the tri-state reasoning', () => {
    expect(entryFromDraft({ input: [], reasoning: 'off', levels: [], contextWindow: '', maxTokens: '' })!.reasoning).toBe(false)
    expect(entryFromDraft({ input: [], reasoning: 'on', levels: ['low'], contextWindow: '', maxTokens: '' })!.reasoning).toEqual(['low'])
  })

  it('rejects empty level sets and non-integer context windows', () => {
    expect(() => entryFromDraft({ input: [], reasoning: 'on', levels: [], contextWindow: '', maxTokens: '' })).toThrow('levels-required')
    expect(() => entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '12.5', maxTokens: '' })).toThrow('context-invalid')
    expect(() => entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '0', maxTokens: '' })).toThrow('context-invalid')
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '4096 ', maxTokens: '' })!.contextWindow).toBe(4096)
  })

  it('converts suffix shorthand into numeric token counts', () => {
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '1M', maxTokens: '' })!.contextWindow).toBe(1_048_576)
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '256k', maxTokens: '' })!.contextWindow).toBe(262_144)
    expect(() => entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '10M', maxTokens: '' })).toThrow('context-invalid')
  })

  it('maxTokens parses with the 1,048,576 cap and reports its own error', () => {
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '', maxTokens: '64K' })!.maxTokens).toBe(65536)
    expect(entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '', maxTokens: '1M' })!.maxTokens).toBe(1_048_576)
    expect(() => entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '', maxTokens: '2M' })).toThrow('max-tokens-invalid')
    expect(() => entryFromDraft({ input: [], reasoning: null, levels: [], contextWindow: '', maxTokens: '-5' })).toThrow('max-tokens-invalid')
  })
})

describe('entrySummary (one-line row text)', () => {
  it('joins raw modality ids, reasoning, and window with placeholders', () => {
    const summary = entrySummary({ input: ['text', 'image'], reasoning: ['low', 'high'], contextWindow: 1048576 }, t)
    expect(summary).toBe('text / image · low / high · 1M')
    expect(entrySummary(undefined, t)).toBe(`— · 未声明 · —`)
    expect(entrySummary({ reasoning: false }, t)).toContain('非推理')
  })

  it('1M-compacts the context window and appends the output segment only when set', () => {
    expect(entrySummary({ contextWindow: 131072 }, t)).toBe('— · 未声明 · 128k')
    expect(entrySummary({ contextWindow: 131072, maxTokens: 65536 }, t)).toBe('— · 未声明 · 128k · 出 64k')
    expect(entrySummary({ maxTokens: 1_048_576 }, t)).toContain('出 1M')
  })
})
