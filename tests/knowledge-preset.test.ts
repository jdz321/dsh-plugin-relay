import { describe, expect, it } from 'vitest'

import { buildPresetEntries, PRESET_MAX_AGE_DAYS, PRESET_PROVIDERS } from '../src/knowledge-preset.js'
import type { ModelsDevDocument } from '../src/capabilities.js'

/** Fixed "now" so the release-age window is deterministic: 2026-09-24T00:00:00Z. */
const NOW = Date.parse('2026-09-24T00:00:00Z')
const DAY = 86_400_000
const d = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10)

/** Fixture document: whitelist providers plus an outside one, shared names. */
function doc(): ModelsDevDocument {
  return {
    openai: {
      models: {
        'gpt-6.1': { release_date: d(30), modalities: { input: ['text', 'image'] }, reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }], limit: { context: 400000 } },
        'gpt-old': { release_date: d(400), modalities: { input: ['text'] }, reasoning: false, limit: { context: 128000 } },
      },
    },
    deepseek: {
      models: {
        'deepseek-chat': { release_date: d(200), modalities: { input: ['text'] }, reasoning: false, limit: { context: 131072 } },
      },
    },
    'some-panel-provider': {
      models: {
        'deepseek-chat': { release_date: d(200), modalities: { input: ['text'] }, reasoning: false, limit: { context: 262144 } },
        'panel-only-model': { release_date: d(10), modalities: { input: ['text'] }, reasoning: false },
        'panel-stale': { release_date: d(300), modalities: { input: ['text'] }, reasoning: false },
      },
    },
  }
}

describe('buildPresetEntries (panel source ∪ whitelist providers, 6-month release window)', () => {
  it('keeps only recent whitelist models when no panel source is given', () => {
    const built = buildPresetEntries(null, doc(), { now: NOW })
    expect(Object.keys(built.entries)).toEqual(['gpt-6.1'])
    expect(built.entries['gpt-6.1']).toEqual({ input: ['text', 'image'], reasoning: ['low', 'medium', 'high'], contextWindow: 400000 })
    // whitelist models outside the window are counted, not kept
    expect(built.agedOut).toBe(2)
  })

  it('normalizes panel ids through the runtime match rules (age-filtered)', () => {
    const built = buildPresetEntries(
      ['gpt-6.1', 'gpt-6.1-preview', 'deepseek-chat', 'panel-only-model', 'grok-video'],
      doc(),
      { now: NOW },
    )
    // gpt-6.1-preview → strip one suffix → gpt-6.1; deepseek-chat matches but
    // released 100 days before the cutoff; grok-video matches nothing
    expect(Object.keys(built.entries).sort()).toEqual(['gpt-6.1', 'panel-only-model'])
    expect(built.dropped).toEqual(['grok-video'])
    // panel-only-model matched a non-whitelist provider name
    expect(built.panelOnlyNames).toEqual(['panel-only-model'])
    expect(built.panelTotal).toBe(5)
  })

  it('drops models released before the window even when a panel id matches them', () => {
    const built = buildPresetEntries(['deepseek-chat'], doc(), { now: NOW })
    expect(built.entries['deepseek-chat']).toBeUndefined()
  })

  it('undated models cannot qualify; the latest release date across providers wins', () => {
    const undatedThenFresh: ModelsDevDocument = {
      openai: { models: { m: { modalities: { input: ['text'] }, reasoning: false } } },
      deepseek: { models: { m: { release_date: d(5), modalities: { input: ['text'] }, reasoning: false } } },
    }
    expect(buildPresetEntries(null, undatedThenFresh, { now: NOW }).entries.m).toBeDefined()
    const freshThenStale: ModelsDevDocument = {
      openai: { models: { m: { release_date: d(5), modalities: { input: ['text'] } } } },
      deepseek: { models: { m: { release_date: d(400), modalities: { input: ['text'] } } } },
    }
    expect(buildPresetEntries(null, freshThenStale, { now: NOW }).entries.m).toBeDefined()
  })

  it('window width is ~6 months and matches the shared constant', () => {
    expect(PRESET_MAX_AGE_DAYS).toBe(183)
    const edge: ModelsDevDocument = {
      openai: { models: { a: { release_date: d(PRESET_MAX_AGE_DAYS), modalities: { input: ['text'] } }, b: { release_date: d(PRESET_MAX_AGE_DAYS + 1), modalities: { input: ['text'] } } } },
    }
    const built = buildPresetEntries(null, edge, { now: NOW })
    expect(built.entries.a).toBeDefined()
    expect(built.entries.b).toBeUndefined()
  })

  it('ignores absent whitelist providers without failing', () => {
    const built = buildPresetEntries(null, { openai: doc().openai }, { now: NOW })
    expect(Object.keys(built.entries)).toEqual(['gpt-6.1'])
    expect(PRESET_PROVIDERS).toContain('openai')
  })
})
