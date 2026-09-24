import { describe, expect, it } from 'vitest'

import {
  applyDerivedCapabilities,
  deriveCapabilityFor,
  matchCatalogName,
  normalizeCapabilityEntry,
  normalizeKnowledgeConfig,
  validateCapabilityEntry,
  type KnowledgeConfig,
} from '../src/knowledge.js'
import type { RouteModelEntry } from '../src/types.js'

const EMPTY: KnowledgeConfig = { capabilityCatalog: {}, capabilityOverrides: {} }

describe('matchCatalogName (exact → strip variant suffix → give up)', () => {
  const names = ['qwen3.8-max', 'gemini-3.6-flash', 'deepseek-chat']

  it('matches exact ids first (case sensitive)', () => {
    expect(matchCatalogName('deepseek-chat', names)).toEqual({ name: 'deepseek-chat', approximate: 0 })
    expect(matchCatalogName('Deepseek-Chat', names)).toBeNull()
  })

  it('strips one trailing segment and marks the hit approximate', () => {
    expect(matchCatalogName('qwen3.8-max-0902', names)).toEqual({ name: 'qwen3.8-max', approximate: 1 })
    expect(matchCatalogName('gemini-3.6-flash-tiered', names)).toEqual({ name: 'gemini-3.6-flash', approximate: 1 })
  })

  it('strips at most two levels', () => {
    expect(matchCatalogName('deepseek-chat-a-b', names)).toEqual({ name: 'deepseek-chat', approximate: 2 })
    expect(matchCatalogName('deepseek-chat-a-b-c', names)).toBeNull()
  })

  it('never matches a bare prefix without the dash boundary', () => {
    // "deepseek-chatbot" stripped to "deepseek" does not hit "deepseek-chat"
    expect(matchCatalogName('deepseek-chatbot', names)).toBeNull()
  })

  it('gives up on panel-only models', () => {
    expect(matchCatalogName('grok-video', names)).toBeNull()
    expect(matchCatalogName('gpt-image-2.5-flare', names)).toBeNull()
  })
})

describe('normalizeKnowledgeConfig / normalizeCapabilityEntry', () => {
  it('collapses schema-materialized empty arrays and drops empty entries', () => {
    expect(normalizeCapabilityEntry({ input: [], reasoning: [], contextWindow: '' })).toBeUndefined()
    expect(normalizeCapabilityEntry({ input: ['text'], reasoning: false, contextWindow: 128000 })).toEqual({
      input: ['text'],
      reasoning: false,
      contextWindow: 128000,
    })
  })

  it('filters unknown modalities and keeps known levels verbatim', () => {
    expect(normalizeCapabilityEntry({ input: ['text', 'pdf', 'image'] })?.input).toEqual(['text', 'image'])
    expect(normalizeCapabilityEntry({ reasoning: ['high', 'ultra'] })?.reasoning).toEqual(['high', 'ultra'])
  })

  it('reads both dicts and skips blank names', () => {
    const config = normalizeKnowledgeConfig({
      capabilityCatalog: { ' a ': { input: ['text'] }, '': { input: ['text'] }, bad: {} },
      capabilityOverrides: 'garbage',
    })
    expect(config.capabilityCatalog).toEqual({ a: { input: ['text'] } })
    expect(config.capabilityOverrides).toEqual({})
  })
})

describe('validateCapabilityEntry (save-boundary validation)', () => {
  it('rejects non-positive-integer context windows', () => {
    expect(() => validateCapabilityEntry({ contextWindow: 0 }, 'x')).toThrow(/正整数/)
    expect(() => validateCapabilityEntry({ contextWindow: 1.5 }, 'x')).toThrow(/正整数/)
    expect(() => validateCapabilityEntry({ contextWindow: -5 }, 'x')).toThrow(/正整数/)
    expect(() => validateCapabilityEntry({ contextWindow: 4096 }, 'x')).not.toThrow()
  })

  it('rejects empty reasoning level lists and unknown modalities', () => {
    expect(() => validateCapabilityEntry({ reasoning: [] }, 'x')).toThrow(/档位/)
    expect(() => validateCapabilityEntry({ input: ['video'] }, 'x')).toThrow(/模态/)
  })

  it('rejects entries without any configuration', () => {
    expect(() => validateCapabilityEntry({}, 'x')).toThrow(/至少/)
  })
})

describe('deriveCapabilityFor (override > catalog > none)', () => {
  const kb: KnowledgeConfig = {
    capabilityCatalog: {
      'gemini-3.6-flash': { input: ['text', 'image'], reasoning: ['low'], contextWindow: 1048576 },
    },
    capabilityOverrides: {
      'gemini-3.6-flash-tiered': { reasoning: ['high'] },
    },
  }

  it('prefers the override and reports its source', () => {
    const derived = deriveCapabilityFor('gemini-3.6-flash-tiered', kb)
    expect(derived.source).toBe('override')
    expect(derived.reasoning).toEqual(['high'])
    expect(derived.input).toBeUndefined()
    expect(derived.contextWindow).toBeUndefined()
  })

  it('falls back to the knowledge base with the matched name', () => {
    const derived = deriveCapabilityFor('gemini-3.6-flash', kb)
    expect(derived.source).toBe('catalog')
    expect(derived.catalogName).toBe('gemini-3.6-flash')
    expect(derived.contextWindow).toBe(1048576)
  })

  it('marks suffix-stripped hits approximate', () => {
    const derived = deriveCapabilityFor('gemini-3.6-flash-latest', kb)
    expect(derived.source).toBe('catalog-approximate')
    expect(derived.catalogName).toBe('gemini-3.6-flash')
  })

  it('returns source null for unknown ids', () => {
    expect(deriveCapabilityFor('grok-video', kb).source).toBeNull()
    expect(deriveCapabilityFor('anything', EMPTY)).toEqual({ source: null })
  })
})

describe('deriveCapabilityFor with the preset layer (user ∪ preset name sets)', () => {
  const kb: KnowledgeConfig = {
    capabilityCatalog: { 'deepseek-chat': { reasoning: ['low'] } },
    capabilityOverrides: {},
    capabilityPreset: { 'deepseek-chat': { reasoning: false }, 'gpt-6.1': { contextWindow: 400000 } },
  }

  it('a same-named user entry overrides the preset and reports catalog source', () => {
    const derived = deriveCapabilityFor('deepseek-chat', kb)
    expect(derived.source).toBe('catalog')
    expect(derived.reasoning).toEqual(['low'])
  })

  it('preset-only names match with preset / preset-approximate sources', () => {
    expect(deriveCapabilityFor('gpt-6.1', kb)).toMatchObject({ source: 'preset', contextWindow: 400000, catalogName: 'gpt-6.1' })
    expect(deriveCapabilityFor('gpt-6.1-preview', kb)).toMatchObject({ source: 'preset-approximate', catalogName: 'gpt-6.1' })
  })

  it('the union name set matches; a nearer user name beats a farther preset name', () => {
    const mixed: KnowledgeConfig = {
      capabilityCatalog: { 'foo-bar': { reasoning: false } },
      capabilityOverrides: {},
      capabilityPreset: { foo: { reasoning: ['high'] } },
    }
    // strip 1 hits user 'foo-bar' before strip 2 would reach preset 'foo'
    expect(deriveCapabilityFor('foo-bar-x', mixed)).toMatchObject({ source: 'catalog-approximate', catalogName: 'foo-bar' })
    // exact hits always win over stripped ones, user or preset
    expect(deriveCapabilityFor('foo', mixed)).toMatchObject({ source: 'preset' })
  })

  it('overrides still beat the preset layer', () => {
    const withOverride: KnowledgeConfig = {
      ...kb,
      capabilityOverrides: { 'gpt-6.1': { reasoning: false } },
    }
    expect(deriveCapabilityFor('gpt-6.1', withOverride)).toMatchObject({ source: 'override', reasoning: false })
  })
})

describe('applyDerivedCapabilities (route entry rewrite rules)', () => {
  const kb: KnowledgeConfig = {
    capabilityCatalog: { base: { input: ['text'], reasoning: false, contextWindow: 131072 } },
    capabilityOverrides: { special: { contextWindow: 2000000 } },
  }

  it('rewrites configured fields and keeps every other field', () => {
    const models: RouteModelEntry[] = [
      { id: 'base', name: 'base', contextWindow: 777, maxTokens: 8192, input: ['image'], reasoningEfforts: { off: null, xhigh: 'xhigh' }, compat: { thinkingFormat: 'deepseek' } },
      { id: 'special', name: 'special', contextWindow: 1 },
      { id: 'unconfigured', name: 'unconfigured', input: ['text'], contextWindow: 3 },
    ]
    const next = applyDerivedCapabilities(models, kb)
    const base = next.find((e) => e.id === 'base')!
    expect(base.input).toEqual(['text'])
    expect(base.reasoningEfforts).toBe(false)
    expect(base.contextWindow).toBe(131072)
    expect(base.maxTokens).toBe(8192)
    expect(base.compat).toEqual({ thinkingFormat: 'deepseek' })
    const special = next.find((e) => e.id === 'special')!
    expect(special.contextWindow).toBe(2000000)
    expect(special.input).toBeUndefined()
    expect(special.reasoningEfforts).toBeUndefined()
    // untouched entry is the same object
    expect(next.find((e) => e.id === 'unconfigured')).toBe(models[2])
  })

  it('maps reasoning level lists onto the reasoningEfforts dict with off pinned', () => {
    const next = applyDerivedCapabilities([{ id: 'base' }], knowledgeOf({ base: { reasoning: ['low', 'high'] } }))
    expect(next[0]!.reasoningEfforts).toEqual({ off: null, low: 'low', high: 'high' })
  })

  it('passes everything through with an empty knowledge config', () => {
    const models: RouteModelEntry[] = [{ id: 'a', input: ['text'] }, { id: 'b' }]
    expect(applyDerivedCapabilities(models, EMPTY)).toEqual(models)
  })
})

function knowledgeOf(catalog: Record<string, { reasoning?: false | string[] }>): KnowledgeConfig {
  return { capabilityCatalog: catalog, capabilityOverrides: {} }
}
