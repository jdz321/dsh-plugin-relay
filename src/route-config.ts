/**
 * Reads and writes of the pi-ai route profile (`llm-pi-ai.providers.<route>`).
 *
 * The official Models settings page, and this plugin's catalog sync, edit the
 * same profile. The invariant every writer here honors: only touch the fields
 * you own, and do read-modify-write on the `models` ARRAY under a settings
 * revision guard with bounded retry — the write queue serializes writes, not
 * the read before them, so without the guard a stale read could clobber a
 * concurrent writer's fields (settings update merges objects but REPLACES
 * arrays).
 *
 * Capability config on the models entries (`input`, `reasoningEfforts`,
 * `contextWindow`) is derived state since v0.5.0: its persistent sources are
 * the plugin's knowledge base and per-id overrides (see knowledge.ts), and
 * every catalog sync or capability save replays those sources over the
 * entries. Entries no plugin config covers are left untouched, so manual
 * edits from the official Models page survive.
 */

import { cleanModelEntry, mergeCatalog } from './catalog.js'
import { applyDerivedCapabilities, type KnowledgeConfig } from './knowledge.js'
import { routeProfileFields, type Section } from './plan.js'
import type { PiAiSection, RouteModelEntry, RouteProfile, SettingsConflictError, SettingsPathOp, SettingsService } from './types.js'

/** How often a revision-guarded write retries after losing a race. */
const WRITE_ATTEMPTS = 3

/** The profile fields derived from the connection settings, per key. */
const CONNECTION_FIELDS = ['api', 'baseURL', 'apiKeyEnv'] as const

/** The registered `llm-pi-ai` namespace resolved value, undefined while absent. */
export function piAiSection(settings: SettingsService): PiAiSection | undefined {
  const value = settings.get('llm-pi-ai')
  return (value && typeof value === 'object') ? value as PiAiSection : undefined
}

/** Stored profile of one route, undefined when the route does not exist. */
export function storedRouteProfile(settings: SettingsService, route: string): RouteProfile | undefined {
  return piAiSection(settings)?.providers?.[route]
}

/** Stored models entries of one route, empty when the route does not exist. */
export function storedRouteModels(settings: SettingsService, route: string): RouteModelEntry[] {
  return storedRouteProfile(settings, route)?.models ?? []
}

export function isSettingsConflict(err: unknown): err is SettingsConflictError {
  return err instanceof Error && (err as SettingsConflictError).code === 'SETTINGS_CONFLICT'
}

/**
 * Read the route profile under the current revision, let the caller build
 * path ops from it, and write with a revision guard, retrying the whole
 * read-build-write cycle while the guard reports a lost race.
 */
async function guardedMutate(
  settings: SettingsService,
  build: (section: PiAiSection) => SettingsPathOp[],
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const descriptor = settings.describe().find((d) => d.ns === 'llm-pi-ai')
    if (!descriptor) throw new Error('settings namespace "llm-pi-ai" is not registered')
    const ops = build(piAiSection(settings) ?? {})
    if (!ops.length) return
    try {
      await settings.mutate('llm-pi-ai', ops, descriptor.revision)
      return
    } catch (err) {
      if (!isSettingsConflict(err)) throw err
      lastError = err
    }
  }
  throw lastError
}

/**
 * Reconcile the route's catalog with the ids the active key can call:
 * surviving ids keep their stored fields, new ids join, gone ids drop; then
 * the knowledge base / override rules replay over the result. Creates the
 * route (with its connection-derived profile fields) when absent.
 */
export async function syncRouteCatalog(settings: SettingsService, section: Section, ids: readonly string[], knowledge: KnowledgeConfig = { capabilityCatalog: {}, capabilityOverrides: {} }): Promise<{ models: RouteModelEntry[], written: boolean }> {
  const profileFields = routeProfileFields(section)
  if (!storedRouteProfile(settings, section.route)) {
    const models = applyDerivedCapabilities(mergeCatalog(ids, undefined), knowledge).map(cleanModelEntry)
    // Create path: a plain update suffices — there is nothing to clobber.
    await settings.update('llm-pi-ai', {
      providers: { [section.route]: { ...profileFields, models } },
    })
    return { models, written: true }
  }
  let wrote = false
  await guardedMutate(settings, (current) => {
    const profile = current.providers?.[section.route]
    const stored = profile?.models ?? []
    // stored entries come from the RESOLVED value: schemastery materializes
    // `input: []` shells that must be stripped before they are written back.
    const models = applyDerivedCapabilities(mergeCatalog(ids, stored), knowledge).map(cleanModelEntry)
    const unchanged = JSON.stringify(models) === JSON.stringify(stored.map(cleanModelEntry))
    const staleFields = CONNECTION_FIELDS.filter((key) => {
      const value = profile?.[key]
      return typeof value === 'string' && value !== profileFields[key]
    })
    if (unchanged && !staleFields.length) return []
    wrote = true
    const ops: SettingsPathOp[] = staleFields.map((key) => ({
      op: 'set',
      path: ['providers', section.route, key],
      value: profileFields[key],
    }))
    if (!unchanged) ops.push({ op: 'set', path: ['providers', section.route, 'models'], value: models })
    return ops
  })
  return { models: storedRouteModels(settings, section.route), written: wrote }
}

/**
 * Re-apply the knowledge base / override rules to the route's stored entries
 * after the plugin's capability config changed. A revision-guarded no-op
 * write when nothing derives differently.
 */
export async function replayRouteCapabilities(settings: SettingsService, route: string, knowledge: KnowledgeConfig): Promise<RouteModelEntry[]> {
  if (!storedRouteProfile(settings, route)) return []
  await guardedMutate(settings, (current) => {
    const stored = current.providers?.[route]?.models ?? []
    // same resolved-value shells as syncRouteCatalog: strip before writing.
    const next = applyDerivedCapabilities(stored, knowledge).map(cleanModelEntry)
    const unchanged = JSON.stringify(next) === JSON.stringify(stored.map(cleanModelEntry))
    return unchanged ? [] : [{ op: 'set', path: ['providers', route, 'models'], value: next }]
  })
  return storedRouteModels(settings, route)
}

/**
 * Make an existing route follow the connection settings (baseURL etc.).
 * Never creates the route — without models a custom route cannot pass pi-ai's
 * strict validation, so creation is syncRouteCatalog's job on first key use.
 */
export async function ensureRouteProfile(settings: SettingsService, section: Section): Promise<boolean> {
  const profile = storedRouteProfile(settings, section.route)
  if (!profile) return false
  const fields = routeProfileFields(section)
  const stale = CONNECTION_FIELDS.filter((key) => profile[key] !== undefined && profile[key] !== fields[key])
  if (!stale.length) return false
  await settings.update('llm-pi-ai', {
    providers: { [section.route]: Object.fromEntries(stale.map((key) => [key, fields[key]])) },
  })
  return true
}
