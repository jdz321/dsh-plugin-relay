import { describe, expect, it } from 'vitest'

import { applyCapabilityOps } from '../src/capability-ops.js'
import { normalizeKnowledgeConfig } from '../src/knowledge.js'
import { FakeSettings } from './fake-settings.js'

async function setup() {
  const settings = new FakeSettings()
  settings.register('relay')
  settings.register('llm-pi-ai')
  await settings.seed('llm-pi-ai', {
    providers: {
      relay: {
        api: 'openai-completions',
        baseURL: 'https://panel.example.com/v1',
        apiKeyEnv: 'RELAY_API_KEY',
        models: [{ id: 'model-a', name: 'model-a' }, { id: 'model-b', name: 'model-b' }],
      },
    },
  })
  const knowledge = () => normalizeKnowledgeConfig(settings.get('relay'))
  return { settings, knowledge }
}

describe('applyCapabilityOps (directed POST /capabilities handler core)', () => {
  it('writes each entry as a path-addressed set under the right dict', async () => {
    const { settings, knowledge } = await setup()
    await applyCapabilityOps(settings, 'relay', {
      catalogSet: { 'deepseek-chat': { input: ['text'], reasoning: false, contextWindow: 131072 } },
      overrideSet: { 'model-a': { reasoning: ['high'] } },
    }, knowledge)
    const section = settings.section('relay')!
    expect(section.capabilityCatalog).toEqual({ 'deepseek-chat': { input: ['text'], reasoning: false, contextWindow: 131072 } })
    expect(section.capabilityOverrides).toEqual({ 'model-a': { reasoning: ['high'] } })
  })

  it('deletes for real: unset removes the key, unlike the v0.5.0 whole-dict set', async () => {
    const { settings, knowledge } = await setup()
    await applyCapabilityOps(settings, 'relay', { catalogSet: { a: { input: ['text'] }, b: { input: ['image'] } } }, knowledge)
    await applyCapabilityOps(settings, 'relay', { catalogDelete: ['a'] }, knowledge)
    const section = settings.section('relay')!
    expect(section.capabilityCatalog).toEqual({ b: { input: ['image'] } })
    // deleting a key that is not there is a no-op, not an error — and it does
    // not materialize an empty dict either
    await applyCapabilityOps(settings, 'relay', { overrideDelete: ['nope'] }, knowledge)
    expect(settings.section('relay')!.capabilityOverrides).toBeUndefined()
  })

  it('replays the derivation over the route in the same call (one write after the ops)', async () => {
    const { settings, knowledge } = await setup()
    const writesBefore = settings.writes
    await applyCapabilityOps(settings, 'relay', {
      catalogSet: { 'model-a': { reasoning: ['low', 'high'], contextWindow: 262144 } },
    }, knowledge)
    // one mutate for the ops + one guarded mutate for the replay
    expect(settings.writes - writesBefore).toBe(2)
    const models = (settings.get('llm-pi-ai') as { providers: { relay: { models: Array<Record<string, unknown>> } } }).providers.relay.models
    const modelA = models.find((m) => m.id === 'model-a')!
    expect(modelA.reasoningEfforts).toEqual({ off: null, low: 'low', high: 'high' })
    expect(modelA.contextWindow).toBe(262144)
    expect(models.find((m) => m.id === 'model-b')).toEqual({ id: 'model-b', name: 'model-b' })
  })

  it('rename arrives as set-new + unset-old in one batch', async () => {
    const { settings, knowledge } = await setup()
    await applyCapabilityOps(settings, 'relay', { catalogSet: { old: { input: ['text'] } } }, knowledge)
    await applyCapabilityOps(settings, 'relay', {
      catalogSet: { new: { input: ['text'] } },
      catalogDelete: ['old'],
    }, knowledge)
    expect(settings.section('relay')!.capabilityCatalog).toEqual({ new: { input: ['text'] } })
  })

  it('validates before writing: a bad entry aborts the whole batch', async () => {
    const { settings, knowledge } = await setup()
    await expect(applyCapabilityOps(settings, 'relay', {
      catalogSet: { bad: { contextWindow: 1.5 } },
    }, knowledge)).rejects.toThrow(/正整数/)
    expect(settings.section('relay')).toBeUndefined()
    await expect(applyCapabilityOps(settings, 'relay', {}, knowledge)).rejects.toThrow(/没有需要执行的操作/)
    await expect(applyCapabilityOps(settings, 'relay', { catalogSet: { '': { input: ['text'] } } }, knowledge)).rejects.toThrow(/不能为空/)
  })
})
