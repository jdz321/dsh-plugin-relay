import { describe, expect, it } from 'vitest'

import { buildPresetEntries, isNonDialogueModel, openrouterCanonicalNames, PRESET_MAX_AGE_DAYS, PRESET_PROVIDERS, type PresetEntry } from '../src/knowledge-preset.js'
import type { ModelsDevDocument, ModelsDevEntry } from '../src/capabilities.js'

/** Fixed "now" so the release-age window is deterministic: 2026-09-24T00:00:00Z. */
const NOW = Date.parse('2026-09-24T00:00:00Z')
const DAY = 86_400_000
const d = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10)

function entry(overrides: Partial<ModelsDevEntry> = {}): ModelsDevEntry {
  return { release_date: d(30), modalities: { input: ['text'], output: ['text'] }, reasoning: false, ...overrides }
}

/** Fixture document: whitelist providers plus outside ones, shared names. */
function doc(): ModelsDevDocument {
  return {
    openai: {
      models: {
        'gpt-6.1': entry({ modalities: { input: ['text', 'image'], output: ['text'] }, reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }], limit: { context: 400000, output: 128000 } }),
        'gpt-old': entry({ release_date: d(400), limit: { context: 128000 } }),
      },
    },
    deepseek: {
      models: {
        'deepseek-chat': entry({ release_date: d(500), limit: { context: 131072 } }),
      },
    },
    'some-channel': {
      models: {
        // channel mirror of deepseek-chat: garbage newer date must NOT
        // rescue the model past the window (first-party dates only)
        'deepseek-chat': entry({ release_date: d(1), limit: { context: 262144 } }),
        'panel-only-model': entry(),
        'panel-stale': entry({ release_date: d(300) }),
        'foo@default': entry({ limit: { context: 32000 } }),
        'vendor/bar': entry({ limit: { context: 32000 } }),
        'baz-maas': entry({ limit: { context: 32000 } }),
      },
    },
  }
}

describe('buildPresetEntries (models.dev mainstream only — the panel is never a source)', () => {
  it('keeps only recent whitelist models (channel data never admits or re-dates them)', () => {
    const built = buildPresetEntries(doc(), { now: NOW })
    expect(Object.keys(built.entries)).toEqual(['gpt-6.1'])
    expect(built.entries['gpt-6.1']).toEqual({
      input: ['text', 'image'],
      reasoning: ['low', 'medium', 'high'],
      contextWindow: 400000,
      maxTokens: 128000,
    })
    // gpt-old and deepseek-chat are out of window; deepseek-chat's channel
    // mirror carries yesterday's garbage date and must not re-date it.
    expect(built.agedOut).toBe(2)
  })

  it('window width is ~1 year and matches the shared constant', () => {
    expect(PRESET_MAX_AGE_DAYS).toBe(365)
    const edge: ModelsDevDocument = {
      openai: { models: { a: entry({ release_date: d(PRESET_MAX_AGE_DAYS) }), b: entry({ release_date: d(PRESET_MAX_AGE_DAYS + 1) }) } },
    }
    const built = buildPresetEntries(edge, { now: NOW })
    expect(built.entries.a).toBeDefined()
    expect(built.entries.b).toBeUndefined()
  })

  it('undated models cannot qualify', () => {
    const undated: ModelsDevDocument = { openai: { models: { m: entry({ release_date: undefined }) } } }
    expect(buildPresetEntries(undated, { now: NOW }).entries.m).toBeUndefined()
  })
})

describe('buildPresetEntries — non-dialogue exclusion (modalities AND name form)', () => {
  it('excludes image/video/embedding/tts models by name form', () => {
    const names: ModelsDevDocument = {
      openai: {
        models: {
          'gpt-image-2.5': entry(),
          'grok-video': entry(),
          'text-embedding-3': entry(),
          'gemini-tts': entry(),
          'qwen3-max': entry(),
          'sora-2': entry(),
        },
      },
    }
    const built = buildPresetEntries(names, { now: NOW })
    expect(built.entries['qwen3-max']).toBeDefined()
    expect(built.nonDialogue).toBe(5)
    expect(built.entries['gpt-image-2.5']).toBeUndefined()
  })

  it('excludes by modalities when the name gives nothing away', () => {
    const byModalities: ModelsDevDocument = {
      openai: {
        models: {
          'weird-name': entry({ modalities: { input: ['text'], output: ['image'] } }),
          'quiet-model': entry({ modalities: { input: ['text'], output: ['text'] } }),
        },
      },
    }
    const built = buildPresetEntries(byModalities, { now: NOW })
    expect(built.entries['quiet-model']).toBeDefined()
    expect(built.entries['weird-name']).toBeUndefined()
    // vision-language stays dialogue: input text + images, output text
    const vl: ModelsDevDocument = {
      openai: { models: { 'qwen3-vl': entry({ modalities: { input: ['text', 'image'], output: ['text'] } }) } },
    }
    expect(buildPresetEntries(vl, { now: NOW }).entries['qwen3-vl']).toBeDefined()
  })

  it('isNonDialogueModel: absent modalities never decide alone', () => {
    expect(isNonDialogueModel('xai-embed', undefined)).toBe(true)
    expect(isNonDialogueModel('some-chat-model', {})).toBe(false)
    expect(isNonDialogueModel('plain-name', { modalities: { input: ['audio'] } })).toBe(true)
  })
})

describe('buildPresetEntries — channel re-registration dedup (drop vs rekey)', () => {
  function channelDoc(): ModelsDevDocument {
    return {
      openai: {
        models: {
          'alpha@default': entry({ limit: { context: 1000 } }), // dropped: bare alpha exists
          'alpha': entry({ limit: { context: 2000 } }),
          'vendor/beta': entry({ limit: { context: 3000 } }), // rekeyed: no bare beta
          'beta-maas': entry({ limit: { context: 3000 } }), // duplicate of the rekey target → dropped
          'gamma': entry({ limit: { context: 4000 } }),
        },
      },
    }
  }

  it('drops decorated names whose stripped form already exists; rekeys orphans', () => {
    const built = buildPresetEntries(channelDoc(), { now: NOW })
    expect(built.channelDropped.sort()).toEqual(['alpha@default', 'beta-maas'])
    expect(built.rekeyed).toEqual([{ from: 'vendor/beta', to: 'beta' }])
    expect(built.entries.alpha?.contextWindow).toBe(2000)
    expect(built.entries.beta?.contextWindow).toBe(3000)
    expect(built.entries.gamma?.contextWindow).toBe(4000)
  })

  it('a rekeyed name carries its original suggestion, modalities, and date', () => {
    const rekeyDoc: ModelsDevDocument = {
      xai: {
        models: {
          'vendor/grok-9': entry({ reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }], limit: { context: 2000000, output: 30000 }, release_date: d(10) }),
        },
      },
    }
    const built = buildPresetEntries(rekeyDoc, { now: NOW })
    expect(built.rekeyed).toEqual([{ from: 'vendor/grok-9', to: 'grok-9' }])
    expect(built.entries['grok-9']).toEqual({ input: ['text'], reasoning: ['high'], contextWindow: 2000000, maxTokens: 30000 })
  })

  it('a channel mirror never re-dates or rescues a model (first-party dates only)', () => {
    const staleDoc: ModelsDevDocument = {
      deepseek: {
        models: {
          'old-timer': entry({ release_date: d(400) }),
          'vendor/old-timer': entry({ release_date: d(2) }),
        },
      },
    }
    const built = buildPresetEntries(staleDoc, { now: NOW })
    // the decorated mirror drops onto the bare name (A3), whose first-party
    // date keeps it out of the window — the mirror's fresh date is gone with it
    expect(built.entries['old-timer']).toBeUndefined()
    expect(built.channelDropped).toEqual(['vendor/old-timer'])
    expect(built.rekeyed).toEqual([])
    expect(built.agedOut).toBe(1)
  })
})

describe('buildPresetEntries — OpenRouter backstop (injected names, build-time only)', () => {
  it('admits backstop names through the same window and dialogue filters', () => {
    const base: ModelsDevDocument = {
      deepseek: {
        models: {
          'deepseek-chat': entry({ release_date: d(400) }),
        },
      },
      'some-aggregator': {
        models: {
          // kimi-k3 has NO first-party registration here — only the usage
          // backstop admits it; the window and dialogue filters still apply.
          'kimi-k3': entry({ release_date: d(50), limit: { context: 1048576 } }),
        },
      },
    }
    const built = buildPresetEntries(base, { now: NOW, openrouterNames: ['kimi-k3', 'made-up-model'] })
    expect(built.openrouterNames).toEqual(['kimi-k3'])
    expect(built.entries['kimi-k3']?.contextWindow).toBe(1048576)
    // aged-out whitelist names are not rescued
    expect(built.entries['deepseek-chat']).toBeUndefined()
  })

  it('without a backstop the whitelist stands alone (full degradation)', () => {
    const built = buildPresetEntries(doc(), { now: NOW })
    expect(built.openrouterNames).toEqual([])
  })
})

describe('openrouterCanonicalNames (slug → models.dev name)', () => {
  it('maps the last path segment exactly or case-folded, dropping unknowns', () => {
    const document: ModelsDevDocument = {
      deepseek: { models: { 'deepseek-chat': entry() } },
      minimax: { models: { 'MiniMax-M3': entry() } },
    }
    expect(openrouterCanonicalNames(['deepseek/deepseek-chat', 'minimax/minimax-m3', 'nonsense'], document)).toEqual([
      'MiniMax-M3',
      'deepseek-chat',
    ])
  })
})

describe('preset entry shape', () => {
  it('entries stay structurally plain and include maxTokens when known', () => {
    const document: ModelsDevDocument = {
      openai: { models: { m: entry({ limit: { context: 131072, output: 16384 }, reasoning: true, reasoning_options: [{ type: 'toggle' }] }) } },
    }
    const entry0: PresetEntry | undefined = buildPresetEntries(document, { now: NOW }).entries.m
    expect(entry0).toEqual({ input: ['text'], reasoning: ['medium'], contextWindow: 131072, maxTokens: 16384 })
  })
})

describe('whitelist providers (curated first-party author keys)', () => {
  it('covers the operator-approved families (SPEC-0.6.0 §3.1-A)', () => {
    expect(PRESET_PROVIDERS).toContain('openai')
    expect(PRESET_PROVIDERS).toContain('anthropic')
    expect(PRESET_PROVIDERS).toContain('google')
    expect(PRESET_PROVIDERS).toContain('google-vertex')
    expect(PRESET_PROVIDERS).toContain('xai')
    expect(PRESET_PROVIDERS).toContain('deepseek')
    expect(PRESET_PROVIDERS).toContain('alibaba')
    expect(PRESET_PROVIDERS).toContain('alibaba-cn')
    expect(PRESET_PROVIDERS).toContain('moonshotai')
    expect(PRESET_PROVIDERS).toContain('moonshotai-cn')
    expect(PRESET_PROVIDERS).toContain('zai')
    expect(PRESET_PROVIDERS).toContain('zhipuai')
    expect(PRESET_PROVIDERS).toContain('minimax')
    expect(PRESET_PROVIDERS).toContain('minimax-cn')
    expect(PRESET_PROVIDERS).toContain('xiaomi')
    expect(PRESET_PROVIDERS).toContain('mistral')
    expect(PRESET_PROVIDERS).toHaveLength(16)
  })

  it('ignores absent whitelist providers without failing', () => {
    const built = buildPresetEntries({ openai: doc().openai }, { now: NOW })
    expect(Object.keys(built.entries)).toEqual(['gpt-6.1'])
  })
})
