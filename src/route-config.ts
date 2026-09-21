/**
 * Reads and writes of the pi-ai route profile (`llm-pi-ai.providers.<route>`).
 *
 * The capability Tab, the official Models settings page, and this plugin's
 * catalog sync all edit the same profile. The invariant every writer here
 * honors: only touch the fields you own, and do read-modify-write on the
 * `models` ARRAY under a settings revision guard with bounded retry — the
 * write queue serializes writes, not the read before them, so without the
 * guard a stale read could clobber a concurrent writer's fields (settings
 * update merges objects but REPLACES arrays).
 *
 * Capability config lives on the models entries themselves (`input`,
 * `reasoningEfforts`): `modelOverrides` is rejected by pi-ai beside a
 * `models` list and on routes its installed catalog does not describe, and a
 * relay route is always both.
 */

import { cleanModelEntry, mergeCatalog } from './catalog.js'
import { EFFORT_LEVELS } from './constants.js'
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
 * The capability fields of one stored entry as the UI sees them: absent or
 * empty arrays collapse to null ("inherit"), reasoning efforts keep
 * false/dict and lose the implicit `off` bookkeeping.
 */
export function capabilityOf(entry: RouteModelEntry): { input: string[] | null, reasoning: false | string[] | null } {
  const input = Array.isArray(entry.input) && entry.input.length ? [...entry.input] : null
  const efforts = entry.reasoningEfforts
  let reasoning: false | string[] | null
  if (efforts === false) reasoning = false
  else if (efforts && typeof efforts === 'object') {
    reasoning = Object.keys(efforts).filter((level) => level !== 'off')
  } else reasoning = null
  return { input, reasoning }
}

/** One submitted capability change from the browser. */
export interface CapabilityUpdate {
  id: string
  /** Selected modalities; empty = inherit the route default. */
  input?: string[]
  /** `false` = mark non-reasoning; levels = reasoning with those efforts. */
  reasoning?: false | { levels: string[] } | null
  /** Strip the entry's capability fields (clear the override). */
  removeCapability?: boolean
  /** Drop the entry from the route entirely (manual models only). */
  removeModel?: boolean
}

/** Validate levels; throws with a user-facing message on bad input. */
function assertLevels(levels: readonly string[]): void {
  if (!levels.length) throw new Error('推理档位至少选择一个（或关闭推理）')
  for (const level of levels) {
    if (!(EFFORT_LEVELS as readonly string[]).includes(level)) {
      throw new Error(`未知推理档位「${level}」`)
    }
  }
}

/** The reasoningEfforts dict for chosen levels: level name as wire value, off pinned null. */
export function reasoningEffortsFor(levels: readonly string[]): Record<string, string | null> {
  const dict: Record<string, string | null> = { off: null }
  for (const level of levels) dict[level] = level
  return dict
}

/**
 * Apply capability updates to a models array. Pure; throws on invalid input.
 * Manual models (ids without a stored entry) are appended, which is how the
 * capability Tab's 「添加」 grows the route.
 */
export function applyCapabilityUpdates(models: readonly RouteModelEntry[], updates: readonly CapabilityUpdate[]): RouteModelEntry[] {
  const byId = new Map(models.map((entry) => [String(entry.id), entry]))
  const addedIds = new Set<string>()
  for (const update of updates) {
    const id = String(update.id ?? '').trim()
    if (!id) throw new Error('模型 id 不能为空')
    const existing = byId.get(id)
    if (update.removeModel) {
      if (!existing) throw new Error(`模型「${id}」不在当前目录中，无法删除`)
      byId.delete(id)
      continue
    }
    let next: RouteModelEntry
    if (existing) {
      next = { ...cleanModelEntry(existing) }
    } else {
      if (update.removeCapability) throw new Error(`模型「${id}」没有可清除的能力配置`)
      next = { id, name: id }
      addedIds.add(id)
    }
    byId.set(id, next)
    if (update.removeCapability) {
      delete next.input
      delete next.reasoningEfforts
      continue
    }
    if (update.input !== undefined) {
      const input = update.input.filter((m) => m === 'text' || m === 'image')
      if (input.length) next.input = [...new Set(input)]
      else delete next.input
    }
    if (update.reasoning !== undefined) {
      if (update.reasoning === null) {
        delete next.reasoningEfforts
      } else if (update.reasoning === false) {
        next.reasoningEfforts = false
      } else {
        const levels = update.reasoning.levels ?? []
        assertLevels(levels)
        next.reasoningEfforts = reasoningEffortsFor(levels)
      }
    }
  }
  const kept = [...byId.values()].filter((entry) => !addedIds.has(String(entry.id)))
  const added = [...addedIds].map((id) => byId.get(id)!)!
  return [...kept, ...added].map(cleanModelEntry)
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
 * Apply one save from the capability Tab: merge the submitted capability
 * fields into the stored entries, leaving every other field (and every other
 * writer's fields) untouched. Fails when the route does not exist yet —
 * capabilities are an overlay on a synced catalog, and a route materializes
 * on first key use.
 */
export async function saveCapabilities(settings: SettingsService, route: string, updates: readonly CapabilityUpdate[]): Promise<RouteModelEntry[]> {
  if (!updates.length) return storedRouteModels(settings, route)
  if (!storedRouteProfile(settings, route)) {
    throw new Error('中转站路由尚未建立：请先在 API Keys 页选择一个 key（同步模型目录后即可配置能力）')
  }
  let result: RouteModelEntry[] = []
  await guardedMutate(settings, (current) => {
    const models = current.providers?.[route]?.models ?? []
    result = applyCapabilityUpdates(models, updates)
    return [{ op: 'set', path: ['providers', route, 'models'], value: result }]
  })
  return result
}

/**
 * Reconcile the route's catalog with the ids the active key can call:
 * surviving ids keep their stored fields, new ids join, gone ids drop.
 * Creates the route (with its connection-derived profile fields) when absent.
 * Resolves with the models stored after the call and whether a write happened.
 */
export async function syncRouteCatalog(settings: SettingsService, section: Section, ids: readonly string[]): Promise<{ models: RouteModelEntry[], written: boolean }> {
  const profileFields = routeProfileFields(section)
  if (!storedRouteProfile(settings, section.route)) {
    const models = mergeCatalog(ids, undefined)
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
    const models = mergeCatalog(ids, stored)
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
