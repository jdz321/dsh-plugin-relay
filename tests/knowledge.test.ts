import { describe, expect, it } from 'vitest'

import {
  applyDerivedCapabilities,
  deriveCapabilityFor,
  diffPreset,
  matchCatalogName,
  normalizeCapabilityEntry,
  normalizeKnowledgeConfig,
  normalizePresetDelta,
  PRESET_ALIASES,
  resolvePreset,
  summarizePresetDelta,
  validateCapabilityEntry,
  type CatalogEntry,
  type KnowledgeConfig,
  type KnowledgeView,
} from '../src/knowledge.js'
import type { RouteModelEntry } from '../src/types.js'

const EMPTY: KnowledgeView = { capabilityCatalog: {}, capabilityOverrides: {} }

describe('matchCatalogName hierarchy L0-L5 (SPEC-0.6.0 §3.3)', () => {
  const names = ['qwen3.8-max', 'gemini-3.6-flash', 'deepseek-chat', 'MiniMax-M3', 'claude-fable-5-1', 'gemini-3.1-pro-preview']

  it('L0 — matches exact ids first (case sensitive)', () => {
    expect(matchCatalogName('deepseek-chat', names)).toEqual({ name: 'deepseek-chat', approximate: 0 })
    expect(matchCatalogName('Deepseek-Chat', names)).not.toEqual({ name: 'Deepseek-Chat', approximate: 0 })
  })

  it('L1 — case-folded exact hits the one same-model spelling (minimax-m3 ↔ MiniMax-M3)', () => {
    expect(matchCatalogName('minimax-m3', names)).toEqual({ name: 'MiniMax-M3', approximate: 1 })
    expect(matchCatalogName('DEEPSEEK-CHAT', names)).toEqual({ name: 'deepseek-chat', approximate: 1 })
  })

  it('L1 — ambiguous fold (several names collapse alike) gives up entirely', () => {
    const ambiguous = ['Foo-Bar', 'foo-bar', 'other']
    expect(matchCatalogName('FOO-BAR', ambiguous)).toBeNull()
  })

  it('L2 — strips one trailing segment and marks the hit approximate', () => {
    expect(matchCatalogName('qwen3.8-max-0902', names)).toEqual({ name: 'qwen3.8-max', approximate: 2 })
    expect(matchCatalogName('gemini-3.6-flash-tiered', names)).toEqual({ name: 'gemini-3.6-flash', approximate: 2 })
  })

  it('L2 — strips at most two levels', () => {
    expect(matchCatalogName('deepseek-chat-a-b', names)).toEqual({ name: 'deepseek-chat', approximate: 2 })
    expect(matchCatalogName('deepseek-chat-a-b-c', names)).toBeNull()
  })

  it('L2 — folded candidate works within a strip level', () => {
    expect(matchCatalogName('minimax-m3-x', names)).toEqual({ name: 'MiniMax-M3', approximate: 2 })
  })

  it('L3 — version separator swaps both directions (claude-fable-5.1 ↔ claude-fable-5-1)', () => {
    expect(matchCatalogName('claude-fable-5.1', names)).toEqual({ name: 'claude-fable-5-1', approximate: 3 })
    // reverse direction: the panel spells with a dash where the catalog has a dot
    const dotted = [...names, 'gpt-4.1']
    expect(matchCatalogName('gpt-4-1', dotted)).toEqual({ name: 'gpt-4.1', approximate: 3 })
  })

  it('L3 — folded uniqueness still applies after the swap', () => {
    expect(matchCatalogName('CLAUDE-FABLE-5.1', names)).toEqual({ name: 'claude-fable-5-1', approximate: 3 })
  })

  it('L4 — unique variant completion (gemini-3.1-pro + preview)', () => {
    expect(matchCatalogName('gemini-3.1-pro', names)).toEqual({ name: 'gemini-3.1-pro-preview', approximate: 4 })
  })

  it('L4 — several possible completions abort (fixed token set + uniqueness)', () => {
    const multi = ['gemini-3.1-pro-preview', 'gemini-3.1-pro-exp', 'unrelated']
    expect(matchCatalogName('gemini-3.1-pro', multi)).toBeNull()
    // gemini-3-pro-image-preview stays a strip-1 base of the id below → the
    // completion `gemini-3-pro-preview` may not exist; uniqueness holds only
    // when exactly one (base, token) pair lands.
    const multiBase = ['gemini-3-pro-preview', 'gemini-3-pro-exp']
    expect(matchCatalogName('gemini-3-pro', multiBase)).toBeNull()
  })

  it('L5 — the curated alias table resolves k3 → kimi-k3', () => {
    expect(PRESET_ALIASES.k3).toBe('kimi-k3')
    const withKimi = [...names, 'kimi-k3']
    expect(matchCatalogName('k3', withKimi)).toEqual({ name: 'kimi-k3', approximate: 5 })
    expect(matchCatalogName('k3', names)).toBeNull() // target must exist
  })

  it('never matches a bare prefix without the dash boundary', () => {
    // "deepseek-chatbot" stripped to "deepseek" does not hit "deepseek-chat"
    expect(matchCatalogName('deepseek-chatbot', names)).toBeNull()
  })

  it('gives up on panel-only models', () => {
    expect(matchCatalogName('grok-video', names)).toBeNull()
    expect(matchCatalogName('gpt-image-2.5-flare', names)).toBeNull()
  })

  it('v0.5.1 regression — the 19 caseform pairs stay same-model folds, strips stay exact-boundary', () => {
    // measured behavior: case-insensitive folding only via full equality;
    // no substring/fuzzy matching anywhere.
    expect(matchCatalogName('minimax-m3', ['MiniMax-M2', 'MiniMax-M3'])).toEqual({ name: 'MiniMax-M3', approximate: 1 })
    expect(matchCatalogName('minimax-m3xyz', ['MiniMax-M3'])).toBeNull()
    expect(matchCatalogName('minimaxx-m3', ['MiniMax-M3'])).toBeNull()
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

  it('keeps a positive maxTokens and drops non-finite ones', () => {
    expect(normalizeCapabilityEntry({ maxTokens: 65536 })?.maxTokens).toBe(65536)
    expect(normalizeCapabilityEntry({ maxTokens: 'x' })?.maxTokens).toBeUndefined()
    expect(normalizeCapabilityEntry({ maxTokens: Infinity })?.maxTokens).toBeUndefined()
  })

  it('reads both dicts, groups overrides per panel, and skips blank names', () => {
    const config = normalizeKnowledgeConfig({
      capabilityCatalog: { ' a ': { input: ['text'] }, '': { input: ['text'] }, bad: {} },
      capabilityOverrides: {
        ' p1 ': { m: { input: ['text'] } },
        empty: {},
        bad: 'garbage',
      },
    })
    expect(config.capabilityCatalog).toEqual({ a: { input: ['text'] } })
    expect(config.capabilityOverrides).toEqual({ p1: { m: { input: ['text'] } } })
  })
})

describe('validateCapabilityEntry (save-boundary validation)', () => {
  it('rejects non-positive-integer context windows', () => {
    expect(() => validateCapabilityEntry({ contextWindow: 0 }, 'x')).toThrow(/正整数/)
    expect(() => validateCapabilityEntry({ contextWindow: 1.5 }, 'x')).toThrow(/正整数/)
    expect(() => validateCapabilityEntry({ contextWindow: -5 }, 'x')).toThrow(/正整数/)
    expect(() => validateCapabilityEntry({ contextWindow: 4096 }, 'x')).not.toThrow()
  })

  it('rejects maxTokens beyond 1,048,576 and non-integers', () => {
    expect(() => validateCapabilityEntry({ maxTokens: 1_048_577 }, 'x')).toThrow(/输出上限/)
    expect(() => validateCapabilityEntry({ maxTokens: 1.5 }, 'x')).toThrow(/输出上限/)
    expect(() => validateCapabilityEntry({ maxTokens: 1_048_576 }, 'x')).not.toThrow()
  })

  it('rejects empty reasoning level lists and unknown modalities', () => {
    expect(() => validateCapabilityEntry({ reasoning: [] }, 'x')).toThrow(/档位/)
    expect(() => validateCapabilityEntry({ input: ['video'] }, 'x')).toThrow(/模态/)
  })

  it('rejects entries without any configuration', () => {
    expect(() => validateCapabilityEntry({}, 'x')).toThrow(/至少/)
    expect(() => validateCapabilityEntry({ maxTokens: undefined }, 'x')).toThrow(/至少/)
  })
})

describe('deriveCapabilityFor (override > catalog > none)', () => {
  const kb: KnowledgeView = {
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

  it('carries maxTokens from a matched entry', () => {
    const withMax: KnowledgeView = {
      capabilityCatalog: { base: { maxTokens: 65536 } },
      capabilityOverrides: { capped: { maxTokens: 32768 } },
    }
    expect(deriveCapabilityFor('base', withMax).maxTokens).toBe(65536)
    expect(deriveCapabilityFor('capped', withMax)).toMatchObject({ source: 'override', maxTokens: 32768 })
  })

  it('returns source null for unknown ids', () => {
    expect(deriveCapabilityFor('grok-video', kb).source).toBeNull()
    expect(deriveCapabilityFor('anything', EMPTY)).toEqual({ source: null })
  })
})

describe('deriveCapabilityFor with the preset layer (user ∪ preset name sets)', () => {
  const kb: KnowledgeView = {
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
    const mixed: KnowledgeView = {
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
    const withOverride: KnowledgeView = {
      ...kb,
      capabilityOverrides: { 'gpt-6.1': { reasoning: false } },
    }
    expect(deriveCapabilityFor('gpt-6.1', withOverride)).toMatchObject({ source: 'override', reasoning: false })
  })
})

describe('applyDerivedCapabilities (route entry rewrite rules)', () => {
  const kb: KnowledgeView = {
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

  it('maxTokens: writes only when configured; clearing the config falls back to the heuristic', async () => {
    const withMax: KnowledgeView = {
      capabilityCatalog: { m: { maxTokens: 65536 } },
      capabilityOverrides: {},
    }
    const models: RouteModelEntry[] = [{ id: 'm', maxTokens: 8192 }]
    expect(applyDerivedCapabilities(models, withMax)[0]!.maxTokens).toBe(65536)
    // config without maxTokens → the entry's heuristic value stays
    const withoutMax: KnowledgeView = {
      capabilityCatalog: { m: { contextWindow: 131072 } },
      capabilityOverrides: {},
    }
    expect(applyDerivedCapabilities(models, withoutMax)[0]!.maxTokens).toBe(8192)
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

describe('preset delta layer (v0.6.1: resolvePreset / diffPreset / normalizePresetDelta)', () => {
  const baseline: Record<string, CatalogEntry> = {
    'gpt-6.1': { contextWindow: 400000 },
    'claude-fable': { contextWindow: 200000 },
    'deepseek-chat': { contextWindow: 128000 },
  }

  it('normalizePresetDelta accepts a full delta and drops bad members', () => {
    expect(normalizePresetDelta(undefined)).toBeUndefined()
    expect(normalizePresetDelta(null)).toBeUndefined()
    expect(normalizePresetDelta('junk')).toBeUndefined()
    // the schemastery-resolved section materializes the key as {} — absent
    expect(normalizePresetDelta({})).toBeUndefined()
    expect(normalizePresetDelta({ removed: ['x'] })).toBeUndefined() // no builtAt
    const delta = normalizePresetDelta({
      builtAt: 123,
      removed: ['deepseek-chat', ' ', 42],
      changed: { 'gpt-6.2': { contextWindow: 500000 }, bad: 'junk', '': { input: ['text'] } },
    })
    expect(delta).toEqual({
      builtAt: 123,
      removed: ['deepseek-chat'],
      changed: { 'gpt-6.2': { contextWindow: 500000 } },
    })
  })

  it('resolvePreset: no delta → baseline untouched; changed overrides; removed drops', () => {
    expect(resolvePreset(baseline, undefined)).toBe(baseline)
    expect(resolvePreset(baseline, normalizePresetDelta({ builtAt: 1 }))).toEqual(baseline)
    const effective = resolvePreset(baseline, {
      builtAt: 1,
      removed: ['claude-fable'],
      changed: { 'gpt-6.1': { contextWindow: 999 }, 'new-model': { input: ['text'] } },
    })
    expect(Object.keys(effective).sort()).toEqual(['deepseek-chat', 'gpt-6.1', 'new-model'])
    expect(effective['gpt-6.1']).toEqual({ contextWindow: 999 })
    // a removed name re-added by `changed` comes back (changed wins)
    const resurrected = resolvePreset(baseline, { builtAt: 1, removed: ['deepseek-chat'], changed: { 'deepseek-chat': { input: ['text'] } } })
    expect(resurrected['deepseek-chat']).toEqual({ input: ['text'] })
  })

  it('diffPreset reports added / updated / removed relative to the baseline', () => {
    const next: Record<string, CatalogEntry> = {
      'gpt-6.1': { contextWindow: 400000 }, // unchanged
      'claude-fable': { contextWindow: 256000 }, // updated
      'new-model': { input: ['text'] }, // added
      // deepseek-chat gone → removed
    }
    const diff = diffPreset(baseline, next)
    expect(diff.removed).toEqual(['deepseek-chat'])
    expect(Object.keys(diff.changed).sort()).toEqual(['claude-fable', 'new-model'])
    // equal-value entries stay OUT of the delta
    expect(diff.changed['gpt-6.1']).toBeUndefined()
    // key-order-independent comparison
    const reordered = diffPreset(baseline, { 'gpt-6.1': { contextWindow: 400000 } })
    expect(reordered.changed).toEqual({})
    expect(reordered.removed).toEqual(['claude-fable', 'deepseek-chat'])
  })

  it('summarizePresetDelta counts added vs updated against the CURRENT baseline', () => {
    const summary = summarizePresetDelta(baseline, {
      builtAt: 7,
      removed: ['claude-fable'],
      changed: { 'gpt-6.1': { contextWindow: 999 }, 'new-model': { input: ['text'] } },
    })
    expect(summary).toEqual({ builtAt: 7, added: 1, updated: 1, removed: 1 })
  })
})

function knowledgeOf(catalog: Record<string, { reasoning?: false | string[] }>): KnowledgeView {
  return { capabilityCatalog: catalog, capabilityOverrides: {} }
}
