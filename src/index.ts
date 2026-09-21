/**
 * Host entry for dsh-plugin-relay.
 *
 * Owns the `relay` settings namespace (relay base URL, access token, user
 * id, active key metadata) and serves the /api/relay/* fetch routes the web
 * settings page talks to: connection state, key browsing/switching, per-key
 * model pricing with catalog sync, per-model capability configuration (the
 * same `llm-pi-ai.providers.<route>.models` entries the official Models page
 * edits), and models.dev capability lookups. Works with any new-api family
 * relay panel.
 */

import Schema from '@deepseek-ai/schemastery'

import { ModelsDevClient } from './capabilities.js'
import { mergeCatalog } from './catalog.js'
import { CLIENT_MODULE_ID, KEY_REF_DEFAULT, NAMESPACE, PLUGIN_NAME, ROUTE_DEFAULT } from './constants.js'
import { envProxy } from './http.js'
import { formatQuota, keySummary, missingSetup, planSwitch, relayFromSection, resolveSection, routeProfileFields, SECTION_DEFAULTS, type Section } from './plan.js'
import { groupRatioOf, priceEntry } from './pricing.js'
import { capabilityOf, ensureRouteProfile, saveCapabilities, storedRouteModels, storedRouteProfile, syncRouteCatalog, type CapabilityUpdate } from './route-config.js'
import type { CredentialsService, HostContext, SchemaType, SettingsService } from './types.js'

/** Stable Cordis plugin name. */
export const name = PLUGIN_NAME

/** Composition schema; resolved values are the settings `base` layer. */
export interface PluginConfig {
  baseUrl: string
  relayKind: string
  accessToken: string
  userId: number
  keyRef: string
  route: string
  selectedKeyName: string
}

const configShape = {
  baseUrl: Schema.string().default(SECTION_DEFAULTS.baseUrl),
  relayKind: Schema.string().default(SECTION_DEFAULTS.relayKind),
  accessToken: Schema.string().role('secret').default(SECTION_DEFAULTS.accessToken),
  userId: Schema.number().default(SECTION_DEFAULTS.userId),
  keyRef: Schema.string().default(SECTION_DEFAULTS.keyRef),
  route: Schema.string().default(SECTION_DEFAULTS.route),
  selectedKeyName: Schema.string().default(SECTION_DEFAULTS.selectedKeyName),
}

export const Config: SchemaType<PluginConfig> = Schema.object(configShape) as SchemaType<PluginConfig>

/** The user-editable settings section schema served to the web settings page. */
const SectionSchema = Schema.object(configShape)

/** Service references captured from the composition (null when absent). */
let settingsService: SettingsService | null = null
let credentialsService: CredentialsService | null = null
let hostLogger: HostContext['logger'] | null = null

/** Diagnostic: last settings-registration failure, surfaced via /state. */
let settingsRegistrationError: string | null = null

/** Diagnostic: last settings read failure, surfaced via /state. */
let settingsReadError: string | null = null

function errorText(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}

function safeGet(ns: string): unknown {
  try {
    return settingsService?.get(ns)
  } catch (err) {
    settingsReadError = err instanceof Error ? err.message : String(err)
    return undefined
  }
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

/** The effective connection section: stored values over the schema defaults. */
function currentSection(): Section {
  if (!settingsService) return resolveSection(null)
  return resolveSection(safeGet(NAMESPACE) as Partial<Section> | undefined)
}

/** JSON response helper (fetch routes answer with standard Response). */
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

/** Wrap a fetch handler so internal failures surface as JSON, not a bare 400. */
function guarded(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request)
    } catch (err) {
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

/** JSON-safe view of the integration state for the settings page. */
async function buildState(section: Section) {
  let credentialConfigured = false
  try {
    credentialConfigured = Boolean(await activeCredential(section.keyRef))
  } catch {
    /* credentials service unavailable in this composition */
  }
  const llmSection = safeGet('llm-pi-ai') as { providers?: Record<string, { models?: unknown[] }> } | undefined
  const routeConfig = llmSection?.providers?.[section.route]
  const models = Array.isArray(routeConfig?.models) ? routeConfig.models : []
  const defaultModel = safeGet('agent-default-model') as { provider?: string, model?: string } | undefined
  return {
    clientModuleId: CLIENT_MODULE_ID,
    baseUrl: section.baseUrl,
    relayKind: section.relayKind,
    userId: section.userId > 0 ? section.userId : null,
    accessTokenConfigured: Boolean(section.accessToken),
    keyRef: section.keyRef,
    route: section.route,
    setupMissing: missingSetup(section),
    selectedKeyName: section.selectedKeyName || '',
    credentialConfigured,
    modelCount: models.length,
    defaultModel: defaultModel?.provider === section.route ? (defaultModel.model ?? null) : null,
    namespaceRegistered: safeGet(NAMESPACE) !== undefined,
    settingsRegistrationError,
    settingsReadError,
  }
}

/** models.dev lookup, single instance per plugin process. */
const modelsDev = new ModelsDevClient({ proxy: envProxy() })

/** Debounced route-profile mirror after connection edits. */
let mirrorTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRouteMirror(): void {
  if (!settingsService) return
  if (mirrorTimer) clearTimeout(mirrorTimer)
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null
    ensureRouteProfile(settingsService!, currentSection()).catch((err) => {
      hostLogger?.warn('relay: route profile mirror failed', err)
    })
  }, 300)
}

/** The /keys response: account line plus per-key metadata, never key material. */
async function keysResponse(): Promise<Response> {
  const section = currentSection()
  const missing = missingSetup(section)
  if (missing) return json({ ok: false, error: `missing:${missing}`, keys: [] }, 400)
  const relay = relayFromSection(section)
  const [tokens, self, pricing] = await Promise.all([
    relay.listTokens(),
    relay.self().catch(() => null),
    relay.pricing(),
  ])
  return json({
    ok: true,
    account: self
      ? {
          username: self.username ?? String(self.id ?? ''),
          group: groupOf(self),
          quotaCny: formatQuota(self.quota as number | undefined),
          groupRatio: groupRatioOf(pricing, groupOf(self)),
        }
      : null,
    keys: tokens.map((t) => keySummary(t, {
      selectedName: section.selectedKeyName,
      groupRatio: groupRatioOf(pricing, t.group || groupOf(self)),
    })),
  })
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

/**
 * Mount the settings namespace and, when the composition serves a browser,
 * the /api/relay/* routes. Both registrations die with this plugin's fiber,
 * so removing the bundle row unmounts everything.
 */
export function apply(ctx: HostContext, config: Partial<PluginConfig> | undefined): void {
  const base = Config(config ?? {}) as unknown as Record<string, unknown>
  hostLogger = ctx.logger
  ctx.inject(['settings', 'credentials'], (services) => {
    const captured = services as unknown as { settings: SettingsService, credentials: CredentialsService }
    settingsService = captured.settings
    credentialsService = captured.credentials
    try {
      settingsService.installSection(ctx, NAMESPACE, SectionSchema, base, {
        setSource: () => {},
        onChange: scheduleRouteMirror,
      })
    } catch (err) {
      settingsRegistrationError = errorText(err)
    }
  })

  ctx.inject(['connection'], (services) => {
    const connection = (services as unknown as { connection: { registerFetchRoute(owner: HostContext, spec: Record<string, unknown>): void } }).connection

    route(connection, ctx, 'state', ['GET'], async () => {
      return json({ ok: true, state: await buildState(currentSection()) })
    })

    // API keys of the account, with group + group ratio metadata. The key
    // material itself is never sent to the browser.
    route(connection, ctx, 'keys', ['GET'], () => keysResponse())

    route(connection, ctx, 'use', ['POST'], async (request) => {
      const body = await readJson(request)
      const idOrName = typeof body.idOrName === 'string' ? body.idOrName : ''
      if (!idOrName) return json({ ok: false, error: 'idOrName is required' }, 400)
      const section = currentSection()
      const missing = missingSetup(section)
      if (missing) return json({ ok: false, error: `missing:${missing}` }, 400)
      if (!settingsService || !credentialsService) return json({ ok: false, error: 'services unavailable' }, 500)
      const relay = relayFromSection(section)
      const previous = safeGet('agent-default-model') as { model?: string } | undefined
      let plan
      try {
        plan = await planSwitch({
          relay,
          section,
          idOrName,
          preferModel: typeof body.model === 'string' && body.model ? body.model : previous?.model,
          noModels: body.noModels === true,
          storedModels: storedRouteModels(settingsService, section.route),
        })
      } catch (err) {
        const status = (err as { code?: string }).code === 'KEY_NOT_FOUND' ? 404 : 502
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, status)
      }
      const warnings: string[] = []
      if (!plan.token.enabled) {
        warnings.push(`「${plan.token.name}」当前处于禁用状态，请求会被中转站拒绝；请先到中转站控制台启用它。`)
      }
      try {
        await credentialsService.set(section.keyRef, plan.token.key)
      } catch (err) {
        return json({ ok: false, error: `凭据写入失败: ${err instanceof Error ? err.message : String(err)}` }, 500)
      }
      // One write carries the connection fields and the merged catalog; the
      // merge keeps capability config and manual fields of surviving ids.
      const profileFields = routeProfileFields(section)
      const models = plan.ids ? mergeCatalog(plan.ids, storedRouteModels(settingsService, section.route)) : undefined
      try {
        await settingsService.update('llm-pi-ai', {
          providers: { [section.route]: models ? { ...profileFields, models } : profileFields },
        })
      } catch (err) {
        warnings.push(`模型列表写入被 llm-pi-ai 设置校验拒绝: ${err instanceof Error ? err.message : String(err)}`)
      }
      try {
        await settingsService.update('agent-default-model', {
          provider: section.route,
          model: plan.defaultModel,
        })
      } catch (err) {
        warnings.push(`默认模型写入被拒绝: ${err instanceof Error ? err.message : String(err)}`)
      }
      // update() queues serialized work per namespace: every write must be
      // awaited before this responds — the client refetches /keys on arrival.
      try {
        await settingsService.update(NAMESPACE, { selectedKeyName: plan.token.name })
      } catch {
        /* cosmetic only */
      }
      return json({
        ok: true,
        key: { id: plan.token.id, name: plan.token.name, enabled: plan.token.enabled },
        modelCount: plan.ids?.length ?? 0,
        defaultModel: plan.defaultModel,
        warnings,
      })
    })

    // The active key's callable models with pricing. Also republishes the
    // model list into the dsh route config (hot-reloads running sessions),
    // preserving capability config and manual fields of surviving ids.
    route(connection, ctx, 'models', ['GET'], async () => {
      const section = currentSection()
      const missing = missingSetup(section)
      if (missing) return json({ ok: false, error: `missing:${missing}`, models: [] }, 400)
      if (!settingsService) return json({ ok: false, error: 'settings service unavailable' }, 500)
      const credentialValue = await activeCredential(section.keyRef)
      if (!credentialValue) return json({ ok: false, error: 'no-active-key', models: [] }, 400)
      const relay = relayFromSection(section)
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
        await syncRouteCatalog(settingsService, section, ids)
      } catch (err) {
        catalogWarning = err instanceof Error ? err.message : String(err)
      }
      return json({
        ok: true,
        source: '/v1/models',
        group: groupOf(self) || null,
        groupRatio,
        models,
        catalogWarning,
      })
    })

    // Capability Tab: GET reads the stored per-model capability fields plus
    // the route default input; POST saves (field-level merge into the stored
    // models array, revision-guarded against concurrent writers — see
    // route-config.ts). One registration serves both methods: dsh allows a
    // single fetch route per path.
    route(connection, ctx, 'capabilities', ['GET', 'POST'], async (request) => {
      if (!settingsService) return json({ ok: false, error: 'settings service unavailable' }, 500)
      const section = currentSection()
      if (request.method === 'GET') {
        const profile = storedRouteProfile(settingsService, section.route)
        if (!profile) return json({ ok: true, configured: false, route: section.route, models: [] })
        const entries = Array.isArray(profile.models) ? profile.models : []
        return json({
          ok: true,
          configured: true,
          route: section.route,
          routeDefaultInput: Array.isArray(profile.defaultInput) ? profile.defaultInput : ['text'],
          models: entries.map((entry) => ({ id: entry.id, ...capabilityOf(entry) })),
        })
      }
      const body = await readJson(request)
      const updates = Array.isArray(body.updates) ? body.updates as CapabilityUpdate[] : []
      try {
        const models = await saveCapabilities(settingsService, section.route, updates)
        return json({ ok: true, models: models.map((entry) => ({ id: entry.id, ...capabilityOf(entry) })) })
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400)
      }
    })

    // ↻ per capability card: models.dev initial values for one model id.
    route(connection, ctx, 'model-info', ['GET'], async (request) => {
      const modelId = new URL(request.url).searchParams.get('model') ?? ''
      if (!modelId) return json({ ok: false, error: 'model is required' }, 400)
      const suggestion = await modelsDev.suggest(modelId)
      return json({ ok: true, model: modelId, suggestion })
    })
  })
}
