import { describe, expect, it } from 'vitest'

import { keyRefForPanelId, normalizePanel, panelSummaries, panelsOf, uniqueKeyRef } from '../src/panels.js'
import { createPanel, deletePanel, PanelRequestError } from '../src/panels-ops.js'
import type { CredentialsService, RouteProfile } from '../src/types.js'
import { FakeSettings } from './fake-settings.js'

async function setup() {
  const settings = new FakeSettings().register('relay').register('llm-pi-ai')
  const unsetCalls: string[] = []
  const credentials: CredentialsService = {
    resolve: async () => undefined,
    set: async () => {},
    unset: async (ref) => {
      unsetCalls.push(ref)
    },
  }
  return { settings, credentials, unsetCalls }
}

describe('panel config model', () => {
  it('keyRefForPanelId spells the id into an env-safe ref', () => {
    expect(keyRefForPanelId('my-relay')).toBe('RELAY_API_KEY_MY_RELAY')
    expect(keyRefForPanelId('Panel_1')).toBe('RELAY_API_KEY_PANEL_1')
  })

  it('uniqueKeyRef deduplicates against the used set', () => {
    expect(uniqueKeyRef('a', new Set())).toBe('RELAY_API_KEY_A')
    expect(uniqueKeyRef('a', new Set(['RELAY_API_KEY_A']))).toBe('RELAY_API_KEY_A_2')
    expect(uniqueKeyRef('a', new Set(['RELAY_API_KEY_A', 'RELAY_API_KEY_A_2']))).toBe('RELAY_API_KEY_A_3')
  })

  it('normalizePanel fills defaults and rejects bad ids', () => {
    expect(normalizePanel('ok', { baseUrl: 'https://x' })).toMatchObject({
      id: 'ok', relayKind: 'new-api', userId: 0, keyRef: 'RELAY_API_KEY_OK',
    })
    expect(normalizePanel('bad id!', {})).toBeNull()
    expect(normalizePanel('ok', 'garbage')).toBeNull()
  })

  it('panelsOf reads the dict out of the section', () => {
    expect(panelsOf({ panels: { a: { baseUrl: 'x' }, bad: 'junk' } }).map((p) => p.id)).toEqual(['a'])
    expect(panelsOf(undefined)).toEqual([])
  })
})

describe('createPanel', () => {
  it('creates a panel with a generated unique keyRef', async () => {
    const { settings } = await setup()
    const panel = await createPanel(settings, { id: 'my-relay', baseUrl: 'https://panel.example.com/', userId: 42 })
    expect(panel.keyRef).toBe('RELAY_API_KEY_MY_RELAY')
    const stored = panelsOf(settings.get('relay'))
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: 'my-relay', baseUrl: 'https://panel.example.com', userId: 42, relayKind: 'new-api' })
  })

  it('rejects invalid ids, duplicates, and writes nothing then', async () => {
    const { settings } = await setup()
    await expect(createPanel(settings, { id: '' })).rejects.toThrow(PanelRequestError)
    await expect(createPanel(settings, { id: '-leading-dash' })).rejects.toThrow(/字母或数字/)
    await expect(createPanel(settings, { id: 'has space' })).rejects.toThrow(/字母或数字/)
    await createPanel(settings, { id: 'a' })
    await expect(createPanel(settings, { id: 'a' })).rejects.toThrow(/已存在/)
    expect(panelsOf(settings.get('relay'))).toHaveLength(1)
  })

  it('token write-through only when actually provided', async () => {
    const { settings } = await setup()
    await createPanel(settings, { id: 'a', accessToken: '  tok  ' })
    await createPanel(settings, { id: 'b' })
    const stored = panelsOf(settings.get('relay'))
    expect(stored.find((p) => p.id === 'a')!.accessToken).toBe('tok')
    expect(stored.find((p) => p.id === 'b')!.accessToken).toBeUndefined()
  })
})

describe('deletePanel', () => {
  it('removes the panel, its overrides group, its route, and its credential ref', async () => {
    const { settings, credentials, unsetCalls } = await setup()
    await settings.seed('llm-pi-ai', {
      providers: {
        'my-relay': { api: 'openai-completions', models: [{ id: 'm' }] } as unknown as RouteProfile,
      },
    })
    // seed the overrides FIRST — createPanel deep-merges the panels dict into
    // the existing relay section, while seed replaces the whole document
    await settings.seed('relay', {
      capabilityOverrides: {
        'my-relay': { m: { input: ['text'] } },
        other: { n: { input: ['text'] } },
      },
    })
    await createPanel(settings, { id: 'my-relay', baseUrl: 'https://x', userId: 1 })
    const result = await deletePanel(settings, credentials, 'my-relay')
    expect(result.routeRemoved).toBe(true)
    expect(result.overridesRemoved).toBe(true)
    const section = settings.get('relay') as { panels?: Record<string, unknown>, capabilityOverrides?: Record<string, unknown> }
    // the panel entry is gone (the dict materializes as `{}`, schema semantics)
    expect(section.panels).toEqual({})
    expect(section.capabilityOverrides).toEqual({ other: { n: { input: ['text'] } } })
    const providers = (settings.get('llm-pi-ai') as { providers: Record<string, unknown> }).providers
    expect(providers['my-relay']).toBeUndefined()
    expect(unsetCalls).toEqual(['RELAY_API_KEY_MY_RELAY'])
  })

  it('reports credential-ref failures as warnings instead of failing', async () => {
    const { settings } = await setup()
    await createPanel(settings, { id: 'a' })
    const credentials: CredentialsService = {
      resolve: async () => undefined,
      set: async () => {},
      unset: async () => {
        throw new Error('shadowed by the launch environment')
      },
    }
    const result = await deletePanel(settings, credentials, 'a')
    expect(result.warnings[0]).toContain('RELAY_API_KEY_A')
    expect(result.warnings[0]).toContain('shadowed')
  })

  it('404s on unknown panels', async () => {
    const { settings, credentials } = await setup()
    await expect(deletePanel(settings, credentials, 'ghost')).rejects.toMatchObject({ status: 404 })
  })
})

describe('panelSummaries (v0.6.1 connection rows — config state, no I/O)', () => {
  it('carries overrideCount and defaultModelTarget and NO account field', async () => {
    const { settings } = await setup()
    await settings.seed('relay', {
      panels: {
        a: { id: 'a', baseUrl: 'https://a.example.com', relayKind: 'new-api', accessToken: 't', userId: 9, keyRef: 'RELAY_API_KEY_A', selectedKeyName: 'k' },
        incomplete: { id: 'incomplete', baseUrl: '', userId: 0, keyRef: 'RELAY_API_KEY_INCOMPLETE', selectedKeyName: '' },
      },
      capabilityOverrides: { a: { m1: { input: ['text'] }, m2: { input: ['text'] } }, other: { x: { input: ['text'] } } },
    })
    await settings.seed('llm-pi-ai', {
      providers: { a: { models: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] } as unknown as RouteProfile },
    })
    const summaries = panelSummaries({
      relay: settings.get('relay'),
      piAi: settings.get('llm-pi-ai'),
      defaultModel: { provider: 'a' },
      routeModelsCount: (route) => route === 'a' ? 3 : 0,
    })
    const a = summaries.find((summary) => summary.id === 'a')!
    expect(a).toMatchObject({
      host: 'a.example.com',
      configured: true,
      tokenConfigured: true,
      userId: 9,
      selectedKeyName: 'k',
      modelCount: 3,
      overrideCount: 2,
      defaultModelTarget: true,
    })
    const incomplete = summaries.find((summary) => summary.id === 'incomplete')!
    expect(incomplete.configured).toBe(false)
    expect(incomplete.missing).toBe('baseUrl')
    expect(incomplete.defaultModelTarget).toBe(false)
    // the account line is lazy since v0.6.1 — the summary carries no account
    for (const summary of summaries) {
      expect(Object.hasOwn(summary, 'account')).toBe(false)
    }
  })

  it('defaultModelTarget stays false when the namespace is absent or mismatched', () => {
    const summaries = panelSummaries({
      relay: { panels: { a: { id: 'a', baseUrl: 'https://a', userId: 1, keyRef: 'R', selectedKeyName: '' } } },
      piAi: {},
      defaultModel: undefined,
      routeModelsCount: () => 0,
    })
    expect(summaries[0]!.defaultModelTarget).toBe(false)
    const mismatched = panelSummaries({
      relay: { panels: { a: { id: 'a', baseUrl: 'https://a', userId: 1, keyRef: 'R', selectedKeyName: '' } } },
      piAi: {},
      defaultModel: { provider: 'b' },
      routeModelsCount: () => 0,
    })
    expect(mismatched[0]!.defaultModelTarget).toBe(false)
  })
})
