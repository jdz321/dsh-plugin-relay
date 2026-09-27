import { describe, expect, it } from 'vitest'

import { applyCapabilityOps } from '../src/capability-ops.js'
import { normalizeKnowledgeConfig } from '../src/knowledge.js'
import type { PanelConfig } from '../src/panels.js'
import { FakeSettings } from './fake-settings.js'

const PANELS: PanelConfig[] = [
  { id: 'my-relay', baseUrl: 'https://a.example.com', relayKind: 'new-api', accessToken: 't', userId: 1, keyRef: 'RELAY_API_KEY_MY_RELAY', selectedKeyName: '' },
  { id: 'other', baseUrl: 'https://b.example.com', relayKind: 'new-api', accessToken: 't', userId: 2, keyRef: 'RELAY_API_KEY_OTHER', selectedKeyName: '' },
]

async function setup() {
  const settings = new FakeSettings()
  settings.register('relay')
  settings.register('llm-pi-ai')
  await settings.seed('llm-pi-ai', {
    providers: {
      [PANELS[0]!.id]: {
        api: 'openai-completions',
        baseURL: 'https://a.example.com/v1',
        apiKeyEnv: PANELS[0]!.keyRef,
        models: [{ id: 'model-a', name: 'model-a' }, { id: 'model-b', name: 'model-b' }],
      },
      // the second panel has no route yet — replays must skip it silently
    },
  })
  const knowledge = () => normalizeKnowledgeConfig(settings.get('relay'))
  return { settings, knowledge }
}

describe('applyCapabilityOps (directed POST /capabilities handler core)', () => {
  it('writes knowledge entries globally and overrides under the owning panel', async () => {
    const { settings, knowledge } = await setup()
    await applyCapabilityOps(settings, {
      catalogSet: { 'deepseek-chat': { input: ['text'], reasoning: false, contextWindow: 131072 } },
      panel: 'my-relay',
      overrideSet: { 'model-a': { reasoning: ['high'] } },
    }, knowledge, PANELS)
    const section = settings.section('relay')!
    expect(section.capabilityCatalog).toEqual({ 'deepseek-chat': { input: ['text'], reasoning: false, contextWindow: 131072 } })
    expect(section.capabilityOverrides).toEqual({ 'my-relay': { 'model-a': { reasoning: ['high'] } } })
  })

  it('deletes for real: unset removes the key, unlike a whole-dict set', async () => {
    const { settings, knowledge } = await setup()
    await applyCapabilityOps(settings, {
      catalogSet: { a: { input: ['text'] }, b: { input: ['image'] } },
      panel: 'my-relay',
      overrideSet: { 'model-a': { input: ['text'] } },
    }, knowledge, PANELS)
    await applyCapabilityOps(settings, { catalogDelete: ['a'] }, knowledge, PANELS)
    expect(settings.section('relay')!.capabilityCatalog).toEqual({ b: { input: ['image'] } })
    // deleting a key that is not there is a no-op, not an error — and it does
    // not materialize anything new
    await applyCapabilityOps(settings, { panel: 'my-relay', overrideDelete: ['nope'] }, knowledge, PANELS)
    const overrides = settings.section('relay')!.capabilityOverrides as Record<string, unknown>
    expect(overrides).toEqual({ 'my-relay': { 'model-a': { input: ['text'] } } })
  })

  it('unsetting the last override of a panel drops the empty group shell', async () => {
    const { settings, knowledge } = await setup()
    await applyCapabilityOps(settings, {
      panel: 'my-relay',
      overrideSet: { 'model-a': { input: ['text'] } },
    }, knowledge, PANELS)
    await applyCapabilityOps(settings, { panel: 'my-relay', overrideDelete: ['model-a'] }, knowledge, PANELS)
    const section = settings.section('relay')!
    // the panel GROUP is gone (no `'my-relay': {}` shell); the top-level dict
    // materializes as `{}`, which the schema does on every read anyway
    expect(section.capabilityOverrides).toEqual({})
  })

  it('override ops without a panel id (or with an unknown one) are rejected before any write', async () => {
    const { settings, knowledge } = await setup()
    await expect(applyCapabilityOps(settings, { overrideSet: { 'model-a': { input: ['text'] } } }, knowledge, PANELS))
      .rejects.toThrow(/面板/)
    await expect(applyCapabilityOps(settings, { panel: 'ghost', overrideSet: { 'model-a': { input: ['text'] } } }, knowledge, PANELS))
      .rejects.toThrow(/未知面板/)
    expect(settings.writes).toBe(0)
  })

  it('replays the derivation over the panel route in the same call (one write after the ops)', async () => {
    const { settings, knowledge } = await setup()
    const writesBefore = settings.writes
    await applyCapabilityOps(settings, {
      catalogSet: { 'model-a': { reasoning: ['low', 'high'], contextWindow: 262144 } },
    }, knowledge, PANELS)
    // one mutate for the ops + one guarded mutate for the replay (the routeless
    // second panel costs nothing)
    expect(settings.writes - writesBefore).toBe(2)
    const models = (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers['my-relay'].models
    const modelA = models.find((m) => m.id === 'model-a')!
    expect(modelA.reasoningEfforts).toEqual({ off: null, low: 'low', high: 'high' })
    expect(modelA.contextWindow).toBe(262144)
    expect(models.find((m) => m.id === 'model-b')).toEqual({ id: 'model-b', name: 'model-b' })
  })

  it('a panel-scoped override replays only that panel\'s route', async () => {
    const { settings, knowledge } = await setup()
    await settings.seed('llm-pi-ai', {
      providers: {
        'my-relay': {
          api: 'openai-completions', baseURL: 'https://a.example.com/v1', apiKeyEnv: 'X',
          models: [{ id: 'model-a', name: 'model-a' }],
        },
        other: {
          api: 'openai-completions', baseURL: 'https://b.example.com/v1', apiKeyEnv: 'Y',
          models: [{ id: 'model-a', name: 'model-a' }],
        },
      },
    })
    await applyCapabilityOps(settings, {
      panel: 'my-relay',
      overrideSet: { 'model-a': { reasoning: false } },
    }, knowledge, PANELS)
    const providers = (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers
    expect(providers['my-relay'].models[0]!.reasoningEfforts).toBe(false)
    // the other panel's identical id is untouched
    expect(providers.other.models[0]).toEqual({ id: 'model-a', name: 'model-a' })
  })

  it('maxTokens reaches the route entry through a knowledge-base set', async () => {
    const { settings, knowledge } = await setup()
    await applyCapabilityOps(settings, {
      catalogSet: { 'model-a': { maxTokens: 65536 } },
    }, knowledge, PANELS)
    const models = (settings.get('llm-pi-ai') as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers['my-relay'].models
    expect(models.find((m) => m.id === 'model-a')!.maxTokens).toBe(65536)
  })

  it('rename arrives as set-new + unset-old in one batch', async () => {
    const { settings, knowledge } = await setup()
    await applyCapabilityOps(settings, { catalogSet: { old: { input: ['text'] } } }, knowledge, PANELS)
    await applyCapabilityOps(settings, {
      catalogSet: { new: { input: ['text'] } },
      catalogDelete: ['old'],
    }, knowledge, PANELS)
    expect(settings.section('relay')!.capabilityCatalog).toEqual({ new: { input: ['text'] } })
  })

  it('validates before writing: a bad entry aborts the whole batch', async () => {
    const { settings, knowledge } = await setup()
    await expect(applyCapabilityOps(settings, {
      catalogSet: { bad: { contextWindow: 1.5 } },
    }, knowledge, PANELS)).rejects.toThrow(/正整数/)
    expect(settings.section('relay')).toBeUndefined()
    await expect(applyCapabilityOps(settings, {}, knowledge, PANELS)).rejects.toThrow(/没有需要执行的操作/)
    await expect(applyCapabilityOps(settings, { catalogSet: { '': { input: ['text'] } } }, knowledge, PANELS)).rejects.toThrow(/不能为空/)
  })
})
