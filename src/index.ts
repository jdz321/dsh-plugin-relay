/**
 * Host entry for dsh-plugin-relay.
 *
 * Owns the `relay` settings namespace — since v0.6.0 a `panels` dict where
 * EVERY panel is its own pi-ai provider (route key = panel id), plus the
 * global capability knowledge base and the per-panel per-id capability
 * overrides — and serves the /api/relay/* fetch routes the web settings page
 * talks to: panel CRUD summaries, per-panel key browsing / switching / CRUD,
 * per-key model pricing with catalog sync, the capability knowledge base with
 * route replay, connection testing, usage dashboard, and usage logs. Works
 * with any new-api family relay panel; several panels live at once.
 */

import Schema from '@deepseek-ai/schemastery'

import { AccountCache } from './account.js'
import { applyCapabilityOps } from './capability-ops.js'
import { ModelsDevClient } from './capabilities.js'
import { CLIENT_MODULE_ID, NAMESPACE, PLUGIN_NAME } from './constants.js'
import { testPanelConnection } from './connection-test.js'
import { envProxy } from './http.js'
import {
  deriveCapabilityFor,
  knowledgeForPanel,
  normalizeKnowledgeConfig,
  normalizePresetDelta,
  resolvePreset,
  summarizePresetDelta,
  type CatalogEntry,
  type KnowledgeConfig,
} from './knowledge.js'
import { buildPresetEntries } from './knowledge-preset.js'
import { KNOWLEDGE_PRESET } from './knowledge-preset.generated.js'
import {
  formatQuota,
  keySummary,
  planSwitch,
  type SwitchPlan,
} from './plan.js'
import {
  missingPanelSetup,
  panelSummaries,
  panelsOf,
  relayFromPanel,
  type PanelConfig,
} from './panels.js'
import { createPanel, deletePanel, PanelRequestError } from './panels-ops.js'
import { groupRatioOf, priceEntry } from './pricing.js'
import { refreshPresetAndReplay, restorePresetBaseline } from './refresh.js'
import { ensureRouteProfile, storedRouteProfile, syncRouteCatalog } from './route-config.js'
import { DEFAULT_MODEL_NS, PI_AI_NS, PluginStore } from './store.js'
import type { CredentialsService, HostContext, HostSettingsService, RelayConfigCells, SchemaType } from './types.js'
import { aggregateDailyBuckets, buildDashboardView, normalizeLog, startOfDaysAgo, startOfToday } from './usage.js'

/** Stable Cordis plugin name. */
export const name = PLUGIN_NAME

/** Capability knowledge entry schema (all three dicts share the entry shape). */
const CapabilityEntrySchema = Schema.object({
  input: Schema.array(Schema.string()),
  reasoning: Schema.union([Schema.boolean(), Schema.array(Schema.string())]),
  contextWindow: Schema.number(),
  maxTokens: Schema.number(),
})

/** The persisted refresh delta against the compiled preset baseline. */
const PresetDeltaSchema = Schema.object({
  builtAt: Schema.number(),
  removed: Schema.array(Schema.string()),
  changed: Schema.dict(CapabilityEntrySchema),
})

/**
 * One panel config. The id IS the pi-ai provider route key and display name
 * (immutable after creation); the access token is write-only — no default
 * and not required, so the redacted wire view (schema envelope included)
 * never carries a value and the client decode of the redacted section stays
 * valid.
 */
const PanelSchema = Schema.object({
  id: Schema.string(),
  baseUrl: Schema.string(),
  relayKind: Schema.string().default('new-api'),
  accessToken: Schema.string().role('secret'),
  userId: Schema.number(),
  keyRef: Schema.string(),
  selectedKeyName: Schema.string(),
})

/**
 * The plugin's Config schema — since dsh ≥0.2.1 this IS the settings page
 * schema: the entry's persisted state lives in the composition entry's
 * profile patch, and every top-level field is declared `.volatile()` so the
 * plugin's own runtime writes (panel CRUD, capability saves, preset
 * refreshes) hot-reload into the running fiber instead of restarting it. The
 * resolved config arrives in `apply` as live cells; the schema envelope the
 * settings page sees is derived from this same schema, with `role('secret')`
 * fields redacted on the wire.
 */
const configShape = {
  panels: Schema.dict(PanelSchema).volatile(),
  capabilityCatalog: Schema.dict(CapabilityEntrySchema).volatile(),
  capabilityOverrides: Schema.dict(Schema.dict(CapabilityEntrySchema)).volatile(),
  capabilityPresetDelta: PresetDeltaSchema.volatile(),
}

export const Config = Schema.object(configShape) as unknown as SchemaType<Record<string, unknown>>

/** Service references captured from the composition (null when absent). */
let settingsService: HostSettingsService | null = null
let credentialsService: CredentialsService | null = null
let hostLogger: HostContext['logger'] | null = null
/** The store facade over the host service + volatile cells (null until wired). */
let store: PluginStore | null = null

/** Diagnostic: last settings-registration failure, surfaced via /state. */
let settingsRegistrationError: string | null = null

/** Diagnostic: last settings read failure, surfaced via /state. */
let settingsReadError: string | null = null

function errorText(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}

/** Stored panels, read from the volatile config cell. */
function currentPanels(): PanelConfig[] {
  return panelsOf(store?.get(NAMESPACE))
}

/** Resolve the API key credential dsh currently routes with (null if none). */
async function activeCredential(keyRef: string): Promise<string | null> {
  if (!credentialsService) return null
  try {
    const resolved = await credentialsService.resolve(keyRef)
    return resolved?.value ?? null
  } catch {
    return null
  }
}

/** One stored panel by id, or null. */
function currentPanel(id: string): PanelConfig | null {
  return currentPanels().find((panel) => panel.id === id) ?? null
}

/**
 * Resolve the panel a request addresses: the explicit id when given, else
 * the only panel when exactly one exists. Everything else is an error the
 * client can show.
 */
function resolvePanel(explicit: unknown): PanelConfig {
  const id = typeof explicit === 'string' ? explicit.trim() : ''
  if (id) {
    const panel = currentPanel(id)
    if (!panel) throw new PanelRequestError(`找不到面板「${id}」`, 404)
    return panel
  }
  const panels = currentPanels()
  if (panels.length === 1) return panels[0]!
  throw new PanelRequestError('缺少 panel 参数（当前存在多个面板）', 400)
}

/** The plugin-owned capability config (knowledge base + per-panel overrides). */
function currentKnowledge(): KnowledgeConfig {
  return normalizeKnowledgeConfig(store?.get(NAMESPACE))
}

/**
 * The preset delta persisted by the last 「刷新预置」 (v0.6.1). Read from the
 * volatile cell — its value is absent (undefined) until the first refresh
 * persists one, which normalizePresetDelta reports as absent.
 */
function storedPresetDelta() {
  const raw = store?.get(NAMESPACE) as Record<string, unknown> | undefined
  return normalizePresetDelta(raw?.capabilityPresetDelta)
}

/** The effective preset layer: compiled baseline + the persisted delta. */
function effectivePreset(): Record<string, CatalogEntry> {
  return resolvePreset(KNOWLEDGE_PRESET, storedPresetDelta())
}

/** User dicts + the effective preset layer, as every derivation consumes. */
function resolvedKnowledge(): KnowledgeConfig {
  return { ...currentKnowledge(), capabilityPreset: effectivePreset() }
}

/** JSON response helper (fetch routes answer with standard Response). */
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

/**
 * Wrap a fetch handler so internal failures surface as JSON, not a bare 400.
 * Errors carrying a plausible HTTP status (PanelRequestError) keep it.
 */
function guarded(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request)
    } catch (err) {
      const status = (err as { status?: number }).status
      if (typeof status === 'number' && status >= 400 && status <= 599) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, status)
      }
      return json({ ok: false, error: errorText(err) }, 500)
    }
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json() as Record<string, unknown>
  } catch {
    return {}
  }
}

function groupOf(self: Record<string, unknown> | null): string {
  return typeof self?.group === 'string' ? self.group : ''
}

/** Diagnostic state for the settings page (panel data lives in /panels). */
function buildState() {
  return {
    clientModuleId: CLIENT_MODULE_ID,
    panelCount: currentPanels().length,
    namespaceRegistered: store !== null,
    settingsRegistrationError,
    settingsReadError,
  }
}

/** models.dev lookup, single instance per plugin process. */
const modelsDev = new ModelsDevClient({ proxy: envProxy() })

/** Account lines behind GET /api/relay/account, 5s TTL (success and failure). */
const accountCache = new AccountCache()

/** Debounced route-profile mirror after connection edits (every panel). */
let mirrorTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRouteMirror(): void {
  if (!store) return
  if (mirrorTimer) clearTimeout(mirrorTimer)
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null
    for (const panel of currentPanels()) {
      ensureRouteProfile(store!, panel).catch((err) => {
        hostLogger?.warn(`relay: route profile mirror failed for ${panel.id}`, err)
      })
    }
  }, 300)
}

/** The /keys response: account line, per-key metadata, usable groups — never key material. */
async function keysResponse(panel: PanelConfig): Promise<Response> {
  const missing = missingPanelSetup(panel)
  if (missing) return json({ ok: false, error: `missing:${missing}`, keys: [], groups: {} }, 400)
  const relay = relayFromPanel(panel)
  const [tokens, self, pricing] = await Promise.all([
    relay.listTokens(),
    relay.self().catch(() => null),
    relay.pricing(),
  ])
  const groups: Record<string, string> = {}
  if (pricing) {
    for (const [name, description] of Object.entries(pricing.usableGroup)) {
      if (name.trim()) groups[name] = String(description ?? '')
    }
  }
  // Per-group billing ratios for the key editor's group selector labels.
  const groupRatios: Record<string, number> = {}
  if (pricing) {
    for (const [name, ratio] of Object.entries(pricing.groupRatio)) {
      if (name.trim() && Number.isFinite(ratio)) groupRatios[name] = ratio
    }
  }
  return json({
    ok: true,
    panel: panel.id,
    account: self
      ? {
          username: self.username ?? String(self.id ?? ''),
          quotaCny: formatQuota(self.quota as number | undefined),
        }
      : null,
    groups,
    groupRatios,
    keys: tokens.map((t) => keySummary(t, {
      selectedName: panel.selectedKeyName,
      groupRatio: groupRatioOf(pricing, t.group || groupOf(self)),
    })),
  })
}

/** Apply a planned switch: credential write, route sync (with capability replay), metadata. */
async function performSwitch(panel: PanelConfig, idOrName: string, noModels: boolean): Promise<{ plan: SwitchPlan, warnings: string[] }> {
  if (!store || !credentialsService) throw new Error('services unavailable')
  const relay = relayFromPanel(panel)
  const plan = await planSwitch({ relay, idOrName, noModels })
  const warnings: string[] = []
  if (!plan.token.enabled) {
    warnings.push(`「${plan.token.name}」当前处于禁用状态，请求会被中转站拒绝；请先到中转站控制台启用它。`)
  }
  await credentialsService.set(panel.keyRef, plan.token.key)
  // One guarded write carries the connection fields, the merged catalog, and
  // the capability fields derived from the knowledge base / overrides.
  if (plan.ids) {
    try {
      await syncRouteCatalog(store, panel, plan.ids, knowledgeForPanel(resolvedKnowledge(), panel.id))
    } catch (err) {
      warnings.push(`模型列表写入被 llm-pi-ai 设置校验拒绝: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    try {
      await ensureRouteProfile(store, panel)
    } catch {
      /* connection mirror is cosmetic */
    }
  }
  try {
    await store.update(NAMESPACE, { panels: { [panel.id]: { selectedKeyName: plan.token.name } } })
  } catch {
    /* cosmetic only */
  }
  return { plan, warnings }
}

/** Mount one fetch route with the standard wrapper. dsh registers ONE route per path, so a path may need to serve several methods. */
function route(connection: { registerFetchRoute(owner: HostContext, spec: Record<string, unknown>): void }, ctx: HostContext, action: string, methods: readonly ('GET' | 'POST')[], handler: (request: Request) => Promise<Response>): void {
  connection.registerFetchRoute(ctx, {
    path: `/api/relay/${action}`,
    methods: [...methods],
    requestBody: 'buffered',
    fetch: guarded(handler),
  })
}

/** Build the per-model capability view for one panel's route. */
function capabilityModelsView(panel: PanelConfig) {
  const profile = storedRouteProfile(store!, panel.id)
  const entries = Array.isArray(profile?.models) ? profile!.models ?? [] : []
  const knowledge = knowledgeForPanel(resolvedKnowledge(), panel.id)
  return entries.map((entry) => {
    const derived = deriveCapabilityFor(String(entry.id), knowledge)
    return {
      id: String(entry.id),
      input: derived.input ?? null,
      reasoning: derived.reasoning ?? null,
      contextWindow: derived.contextWindow ?? null,
      maxTokens: derived.maxTokens ?? null,
      source: derived.source,
      catalogName: derived.catalogName ?? null,
    }
  })
}


/** The capabilities GET/POST shared response body. */
function capabilitiesView() {
  const knowledge = currentKnowledge()
  const panels = currentPanels().map((panel) => {
    const profile = storedRouteProfile(store!, panel.id)
    return {
      id: panel.id,
      configured: Boolean(profile),
      route: panel.id,
      routeDefaultInput: Array.isArray(profile?.defaultInput) ? profile!.defaultInput : ['text'],
      models: capabilityModelsView(panel),
    }
  })
  const delta = storedPresetDelta()
  return {
    ok: true,
    configured: panels.some((panel) => panel.configured),
    panels,
    catalog: knowledge.capabilityCatalog,
    overrides: knowledge.capabilityOverrides,
    presets: effectivePreset(),
    baselineCount: Object.keys(KNOWLEDGE_PRESET).length,
    ...(delta !== undefined ? { presetDelta: summarizePresetDelta(KNOWLEDGE_PRESET, delta) } : {}),
  }
}

/** Per-panel list summaries for the connection tab — pure config state, no I/O. */
function panelsResponse(): Response {
  const summaries = panelSummaries({
    relay: store?.get(NAMESPACE),
    piAi: store?.get(PI_AI_NS),
    defaultModel: store?.get(DEFAULT_MODEL_NS),
    routeModelsCount: storedRouteModelsCount,
  })
  return json({ ok: true, panels: summaries })
}

function storedRouteModelsCount(route: string): number {
  const profile = store ? storedRouteProfile(store, route) : undefined
  return Array.isArray(profile?.models) ? profile!.models!.length : 0
}

/** Panel create/delete share one body shape and error mapping (v0.6.1: edit is gone). */
async function handlePanelsMutation(request: Request, action: 'create' | 'delete'): Promise<Response> {
  if (!store) return json({ ok: false, error: 'settings service unavailable' }, 500)
  const body = await readJson(request)
  if (action === 'create') {
    const panel = await createPanel(store, body)
    hostLogger?.info(`relay: panel ${panel.id} created`)
    return json({ ok: true, panel: { id: panel.id, keyRef: panel.keyRef } })
  }
  const id = typeof body.panel === 'string' ? body.panel.trim() : ''
  const result = await deletePanel(store, credentialsService, id)
  hostLogger?.info(`relay: panel ${id} deleted (route removed: ${result.routeRemoved})`)
  return json({ ok: true, ...result })
}

/**
 * Wire the plugin to the composition: read the entry's volatile config cells,
 * disable the host's auto-generated settings page in favor of the client's
 * own, serve the /api/relay/* routes, and keep the route profiles mirrored
 * after hot config changes. Every registration dies with this plugin's fiber,
 * so removing the bundle row unmounts everything.
 */
export function apply(ctx: HostContext, config: unknown): void {
  hostLogger = ctx.logger
  // The resolved entry config: volatile fields arrive as live cells that the
  // loader updates in place on every hot (no-reload) write.
  const cells = config as RelayConfigCells
  ctx.inject(['settings', 'credentials'], (services) => {
    const captured = services as unknown as { settings: HostSettingsService, credentials: CredentialsService }
    settingsService = captured.settings
    credentialsService = captured.credentials
    try {
      // The client draws the relay page itself (plugins.item slot); without
      // this the host would also generate a generic config form for the entry.
      ctx.effect(() => settingsService!.configure({ auto: false }, ctx.fiber))
      const entryId = ctx.fiber?.entry?.options?.id?.trim() || NAMESPACE
      store = new PluginStore(settingsService!, cells, entryId)
      // Foreign entry reads (llm-pi-ai, agent-default-model) cache until the
      // host reports the entry's document changed (every reconciled write).
      ctx.on('settings/document-updated', ((ns: unknown) => {
        store?.invalidateForeign(String(ns))
      }) as never)
      // Hot config changes (panel CRUD, capability saves, preset refreshes,
      // page edits) — mirror the pi-ai route profiles afterward.
      ctx.on('loader/volatile-update', (() => scheduleRouteMirror()) as never)
    } catch (err) {
      settingsRegistrationError = errorText(err)
    }
  })

  ctx.inject(['connection'], (services) => {
    const connection = (services as unknown as { connection: { registerFetchRoute(owner: HostContext, spec: Record<string, unknown>): void } }).connection

    route(connection, ctx, 'state', ['GET'], async () => {
      return json({ ok: true, state: buildState() })
    })

    // Panel list summaries for the connection tab (pure config state — the
    // account line fills lazily via /account below).
    route(connection, ctx, 'panels', ['GET'], async () => panelsResponse())

    route(connection, ctx, 'panels-create', ['POST'], (request) => handlePanelsMutation(request, 'create'))
    route(connection, ctx, 'panels-delete', ['POST'], (request) => handlePanelsMutation(request, 'delete'))

    // Lazy account line for one panel row: username + balance from
    // /api/user/self, served from a 5s TTL cache (failures included) so a
    // client re-render storm cannot hammer an unreachable panel.
    route(connection, ctx, 'account', ['GET'], async (request) => {
      const panel = resolvePanel(new URL(request.url).searchParams.get('panel'))
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}` }, 400)
      const result = await accountCache.lookup(panel, async (target) => {
        const self = await relayFromPanel(target).self()
        if (!self) throw new Error('面板未返回账户信息')
        return {
          username: String(self.username ?? self.id ?? ''),
          quotaCny: formatQuota(self.quota as number | undefined),
        }
      })
      if (!result.ok) return json({ ok: false, error: result.error }, 502)
      return json({ ok: true, account: result.account })
    })

    // Connection test for one panel: GET /api/user/self with the saved
    // settings, classified into the four failure shapes (§6).
    route(connection, ctx, 'connection-test', ['POST'], async (request) => {
      const body = await readJson(request)
      const panel = resolvePanel(body.panel)
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}` }, 400)
      const result = await testPanelConnection(panel)
      return json(result)
    })

    // API keys of one panel account with per-key metadata. The key material
    // itself is never sent to the browser.
    route(connection, ctx, 'keys', ['GET'], async (request) => {
      const panel = resolvePanel(new URL(request.url).searchParams.get('panel'))
      return keysResponse(panel)
    })

    route(connection, ctx, 'use', ['POST'], async (request) => {
      const body = await readJson(request)
      const idOrName = typeof body.idOrName === 'string' ? body.idOrName : ''
      if (!idOrName) return json({ ok: false, error: 'idOrName is required' }, 400)
      const panel = resolvePanel(body.panel)
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}` }, 400)
      let result
      try {
        result = await performSwitch(panel, idOrName, body.noModels === true)
      } catch (err) {
        const status = (err as { code?: string }).code === 'KEY_NOT_FOUND' ? 404 : 502
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, status)
      }
      return json({
        ok: true,
        panel: panel.id,
        key: { id: result.plan.token.id, name: result.plan.token.name, enabled: result.plan.token.enabled },
        modelCount: result.plan.ids?.length ?? 0,
        warnings: result.warnings,
      })
    })

    // The active key's callable models with pricing. Also republishes the
    // model list into the dsh route config (hot-reloads running sessions),
    // with the capability rules from the knowledge base applied.
    route(connection, ctx, 'models', ['GET'], async (request) => {
      const panel = resolvePanel(new URL(request.url).searchParams.get('panel'))
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}`, models: [] }, 400)
      if (!store) return json({ ok: false, error: 'settings service unavailable' }, 500)
      const credentialValue = await activeCredential(panel.keyRef)
      if (!credentialValue) return json({ ok: false, error: 'no-active-key', models: [] }, 400)
      const relay = relayFromPanel(panel)
      let ids: string[]
      try {
        ids = await relay.keyModels(credentialValue)
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502)
      }
      if (!ids.length) return json({ ok: false, error: '该 key 没有任何可用模型', models: [] }, 502)
      const pricing = await relay.pricing()
      let self: Record<string, unknown> | null = null
      try {
        self = await relay.self()
      } catch {
        /* account context is optional for the list */
      }
      const groupRatio = groupRatioOf(pricing, groupOf(self))
      const models = [...new Set(ids)].map((id) => ({
        id,
        price: priceEntry(id, pricing),
      }))
      let catalogWarning: string | undefined
      try {
        await syncRouteCatalog(store, panel, ids, knowledgeForPanel(resolvedKnowledge(), panel.id))
      } catch (err) {
        catalogWarning = err instanceof Error ? err.message : String(err)
      }
      return json({
        ok: true,
        panel: panel.id,
        source: '/v1/models',
        group: groupOf(self) || null,
        groupRatio,
        models,
        catalogWarning,
      })
    })

    // Capability Tab: the knowledge base plus per-panel per-id overrides live
    // in the relay namespace; the route entries carry only the derived
    // result. GET returns both dicts, the preset layer, and the derived
    // per-panel per-model view; POST applies directed ops (set/delete per
    // name/id, overrides addressed to their panel) and replays the
    // derivation over every configured route in one guarded write each.
    route(connection, ctx, 'capabilities', ['GET', 'POST'], async (request) => {
      if (!store) return json({ ok: false, error: 'settings service unavailable' }, 500)
      if (request.method === 'GET') return json(capabilitiesView())
      const body = await readJson(request)
      try {
        await applyCapabilityOps(store, body as Record<string, unknown>, resolvedKnowledge, currentPanels())
        return json(capabilitiesView())
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400)
      }
    })

    // 刷新预置: force-fetch models.dev (bypassing the TTL cache), rebuild the
    // preset layer with the same mainstream rules as `npm run preset:fetch`,
    // PERSIST the difference against the compiled baseline as the namespace's
    // `capabilityPresetDelta` (one awaited mutate — the delta survives
    // restarts; 恢复基线 is the way back), and replay the derivation over
    // every configured panel route.
    route(connection, ctx, 'knowledge-refresh', ['POST'], async () => {
      if (!store) return json({ ok: false, error: 'settings service unavailable' }, 500)
      let result
      try {
        result = await refreshPresetAndReplay({
          fetchDoc: () => modelsDev.refresh(),
          settings: store,
          panels: currentPanels(),
          baseline: KNOWLEDGE_PRESET,
          knowledge: resolvedKnowledge,
        })
      } catch (err) {
        return json({ ok: false, error: `models.dev 获取失败: ${err instanceof Error ? err.message : String(err)}` }, 502)
      }
      hostLogger?.info(`relay: knowledge preset refreshed (${result.count} entries, delta +${result.delta.added + result.delta.updated} / -${result.delta.removed})`)
      return json({ ok: true, ...result })
    })

    // 恢复基线: drop the persisted preset delta (back to the compiled-in
    // baseline) and replay the derivation over every configured panel route.
    route(connection, ctx, 'preset-restore', ['POST'], async () => {
      if (!store) return json({ ok: false, error: 'settings service unavailable' }, 500)
      const result = await restorePresetBaseline({
        settings: store,
        panels: currentPanels(),
        knowledge: resolvedKnowledge,
      })
      return json({ ok: true, ...result })
    })

    // ↻ models.dev reference values for one model name (knowledge base default).
    route(connection, ctx, 'model-info', ['GET'], async (request) => {
      const modelId = new URL(request.url).searchParams.get('model') ?? ''
      if (!modelId) return json({ ok: false, error: 'model is required' }, 400)
      const suggestion = await modelsDev.suggest(modelId)
      return json({ ok: true, model: modelId, suggestion })
    })

    // Create a key on one panel. The panel-generated secret is stripped in
    // relay.createToken — it never reaches this response. setAsActive runs
    // the regular switch flow server-side (secret only enters the credential
    // store).
    route(connection, ctx, 'keys-create', ['POST'], async (request) => {
      const body = await readJson(request)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const group = typeof body.group === 'string' ? body.group.trim() : ''
      if (!name) return json({ ok: false, error: 'key 名称必填' }, 400)
      if (!group) return json({ ok: false, error: '分组必填' }, 400)
      const unlimitedQuota = body.unlimitedQuota === true
      let remainQuota = 0
      if (!unlimitedQuota) {
        remainQuota = Number(body.remainQuota ?? 0)
        if (!Number.isInteger(remainQuota) || remainQuota < 0) {
          return json({ ok: false, error: '额度须为非负整数（点数）' }, 400)
        }
      }
      let expiredTime = -1
      if (body.expiredTime !== undefined && body.expiredTime !== null && body.expiredTime !== -1) {
        expiredTime = Number(body.expiredTime)
        if (!Number.isFinite(expiredTime) || expiredTime <= 0) {
          return json({ ok: false, error: '有效期非法' }, 400)
        }
      }
      const panel = resolvePanel(body.panel)
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}` }, 400)
      const relay = relayFromPanel(panel)
      const created = await relay.createToken({ name, group, unlimitedQuota, remainQuota, expiredTime })
      const warnings: string[] = []
      let switched = false
      if (body.setAsActive === true) {
        try {
          const result = await performSwitch(panel, String(created.id), false)
          switched = true
          warnings.push(...result.warnings)
        } catch (err) {
          warnings.push(`创建成功，但切换生效失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      return json({ ok: true, key: { id: created.id, name: created.name }, switched, warnings })
    })

    // Edit one key: read the panel's own record, merge validated fields, PUT
    // the whole object back (the endpoint is a whole-object update).
    route(connection, ctx, 'keys-update', ['POST'], async (request) => {
      const body = await readJson(request)
      const id = body.id
      if (id === undefined || id === null || id === '') return json({ ok: false, error: '缺少 key id' }, 400)
      const panel = resolvePanel(body.panel)
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}` }, 400)
      const relay = relayFromPanel(panel)
      const records = await relay.listTokensRaw()
      const record = records.find((r) => String(r.id) === String(id))
      if (!record) return json({ ok: false, error: `找不到编号为「${String(id)}」的 key` }, 404)
      if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name) return json({ ok: false, error: 'key 名称不能为空' }, 400)
        record.name = name
      }
      if (body.group !== undefined) {
        const group = typeof body.group === 'string' ? body.group.trim() : ''
        if (!group) return json({ ok: false, error: '分组不能为空' }, 400)
        record.group = group
      }
      if (body.unlimitedQuota !== undefined) {
        record.unlimited_quota = body.unlimitedQuota === true
      }
      if (body.remainQuota !== undefined) {
        const remainQuota = Number(body.remainQuota)
        if (!Number.isInteger(remainQuota) || remainQuota < 0) {
          return json({ ok: false, error: '额度须为非负整数（点数）' }, 400)
        }
        record.remain_quota = remainQuota
      }
      if (body.expiredTime !== undefined) {
        const expiredTime = Number(body.expiredTime)
        if (!Number.isFinite(expiredTime) || (expiredTime !== -1 && expiredTime <= 0)) {
          return json({ ok: false, error: '有效期非法' }, 400)
        }
        record.expired_time = expiredTime
      }
      // Upstream UpdateToken applies regular fields and status in two
      // distinct modes: a plain PUT ignores status entirely.
      const wantsEdit = body.name !== undefined || body.group !== undefined
        || body.unlimitedQuota !== undefined || body.remainQuota !== undefined || body.expiredTime !== undefined
      const wantsStatus = body.enabled !== undefined
      if (!wantsEdit && !wantsStatus) return json({ ok: false, error: '没有需要修改的字段' }, 400)
      if (wantsEdit) await relay.updateToken(record)
      if (wantsStatus) {
        record.status = body.enabled === true ? 1 : 2
        await relay.updateToken(record, true)
      }
      return json({ ok: true })
    })

    // Delete one key. Response carries active:true when the deleted key was
    // the currently active one, so the client can warn (Modal confirm).
    route(connection, ctx, 'keys-delete', ['POST'], async (request) => {
      const body = await readJson(request)
      const id = body.id
      if (id === undefined || id === null || id === '') return json({ ok: false, error: '缺少 key id' }, 400)
      const panel = resolvePanel(body.panel)
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}` }, 400)
      const relay = relayFromPanel(panel)
      let name = ''
      try {
        const tokens = await relay.listTokens()
        name = tokens.find((t) => String(t.id) === String(id))?.name ?? ''
      } catch {
        /* the delete attempt below surfaces real errors */
      }
      await relay.deleteToken(id as number | string)
      return json({ ok: true, active: name !== '' && name === panel.selectedKeyName })
    })

    // Dashboard: account cards plus per-day per-model usage buckets (¥ done
    // server-side). Panels keep only recent buckets — sparse/empty is normal.
    route(connection, ctx, 'dashboard', ['GET'], async (request) => {
      const panel = resolvePanel(new URL(request.url).searchParams.get('panel'))
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}` }, 400)
      const daysParam = Number(new URL(request.url).searchParams.get('days') ?? 7)
      const days = Number.isInteger(daysParam) && daysParam >= 1 && daysParam <= 30 ? daysParam : 7
      const nowSeconds = Math.floor(Date.now() / 1000)
      const relay = relayFromPanel(panel)
      let self: Record<string, unknown> | null
      try {
        self = await relay.self()
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502)
      }
      let todayStatQuota = 0
      try {
        todayStatQuota = (await relay.logStat(startOfToday(nowSeconds), nowSeconds)).quota
      } catch {
        /* today's card falls back to 0 */
      }
      let rawBuckets: Record<string, unknown>[] = []
      let warning: string | undefined
      try {
        rawBuckets = await relay.usageData(startOfDaysAgo(nowSeconds, days - 1), nowSeconds)
      } catch (err) {
        warning = `用量桶获取失败（面板可能未保留数据）: ${err instanceof Error ? err.message : String(err)}`
      }
      const dashboard = buildDashboardView({
        self,
        todayStatQuota,
        buckets: aggregateDailyBuckets(rawBuckets, days, nowSeconds),
        days,
        nowSeconds,
      })
      return json({ ok: true, dashboard, warning })
    })

    // Usage logs: one page of the panel's log list, shaped for the table
    // (`other` pre-parsed into a first-response-time field).
    route(connection, ctx, 'logs', ['GET'], async (request) => {
      const panel = resolvePanel(new URL(request.url).searchParams.get('panel'))
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}`, logs: [] }, 400)
      const params = new URL(request.url).searchParams
      const numberParam = (key: string): number | undefined => {
        const raw = params.get(key)
        if (raw === null || raw === '') return undefined
        const n = Number(raw)
        return Number.isFinite(n) ? n : undefined
      }
      const stringParam = (key: string): string | undefined => {
        const raw = params.get(key)
        return raw ? raw : undefined
      }
      const relay = relayFromPanel(panel)
      const page = await relay.logs({
        p: numberParam('p') ?? 1,
        pageSize: numberParam('pageSize') ?? 10,
        startTimestamp: numberParam('start'),
        endTimestamp: numberParam('end'),
        tokenName: stringParam('tokenName'),
        modelName: stringParam('modelName'),
        group: stringParam('group'),
      })
      return json({
        ok: true,
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        logs: page.items.map(normalizeLog),
      })
    })

    // Page-header statistics over the current filter window.
    route(connection, ctx, 'logs-stat', ['GET'], async (request) => {
      const panel = resolvePanel(new URL(request.url).searchParams.get('panel'))
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}` }, 400)
      const params = new URL(request.url).searchParams
      const numberParam = (key: string): number | undefined => {
        const raw = params.get(key)
        if (raw === null || raw === '') return undefined
        const n = Number(raw)
        return Number.isFinite(n) ? n : undefined
      }
      const relay = relayFromPanel(panel)
      const stat = await relay.logStat(numberParam('start'), numberParam('end'))
      return json({ ok: true, stat: { quota: stat.quota, quotaCny: formatQuota(stat.quota), rpm: stat.rpm, tpm: stat.tpm } })
    })

    // Filter dropdown sources: account-visible model ids and usable groups.
    route(connection, ctx, 'logs-meta', ['GET'], async (request) => {
      const panel = resolvePanel(new URL(request.url).searchParams.get('panel'))
      const missing = missingPanelSetup(panel)
      if (missing) return json({ ok: false, error: `missing:${missing}`, models: [], groups: {} }, 400)
      const relay = relayFromPanel(panel)
      let models: string[] = []
      try {
        models = await relay.userModels()
      } catch {
        /* dropdown degrades to free text */
      }
      const pricing = await relay.pricing()
      const groups: Record<string, string> = {}
      if (pricing) {
        for (const [name, description] of Object.entries(pricing.usableGroup)) {
          if (name.trim()) groups[name] = String(description ?? '')
        }
      }
      return json({ ok: true, models, groups })
    })
  })
}
