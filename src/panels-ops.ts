/**
 * Panel CRUD behind the /api/relay/panels-* routes, extracted so it is
 * unit-testable against FakeSettings. Writes are directed path ops into the
 * `relay.panels` dict; deleting a panel tears down everything the panel
 * owns — its pi-ai route, its override group, its credential ref — but never
 * the global knowledge base. The panel id is the provider route key and
 * display name, and v0.6.1 removed editing altogether: the id and every
 * connection field are create-time only (change = delete + re-create).
 */

import { NAMESPACE } from './constants.js'
import { panelIdError, panelsOf, uniqueKeyRef, type PanelConfig } from './panels.js'
import { ensureRouteProfile, unsetRoute } from './route-config.js'
import type { CredentialsService, SettingsService } from './types.js'

/** Normalize a user-entered base URL the same way the old connection form did. */
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/** Thrown when a panel create/update/delete request is invalid or unknown. */
export class PanelRequestError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'PanelRequestError'
    this.status = status
  }
}

/** All credential refs currently claimed by stored panels. */
function usedKeyRefs(settings: SettingsService): Set<string> {
  return new Set(panelsOf(settings.get(NAMESPACE)).map((panel) => panel.keyRef))
}

export async function createPanel(
  settings: SettingsService,
  input: { id?: unknown, baseUrl?: unknown, accessToken?: unknown, userId?: unknown },
): Promise<PanelConfig> {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const idProblem = panelIdError(id)
  if (idProblem) throw new PanelRequestError(idProblem)
  if (panelsOf(settings.get(NAMESPACE)).some((panel) => panel.id === id)) {
    throw new PanelRequestError(`面板名称「${id}」已存在`)
  }
  const userId = Number(input.userId ?? 0)
  const panel: PanelConfig = {
    id,
    baseUrl: typeof input.baseUrl === 'string' ? normalizeBaseUrl(input.baseUrl) : '',
    relayKind: 'new-api',
    accessToken: typeof input.accessToken === 'string' && input.accessToken.trim() !== '' ? input.accessToken.trim() : undefined,
    userId: Number.isFinite(userId) ? userId : 0,
    keyRef: uniqueKeyRef(id, usedKeyRefs(settings)),
    selectedKeyName: '',
  }
  await settings.update(NAMESPACE, { panels: { [id]: panel } })
  return panel
}

export interface DeletePanelResult {
  routeRemoved: boolean
  overridesRemoved: boolean
  warnings: string[]
}

/**
 * Delete a panel and everything it owns. Knowledge-base entries are global
 * and survive; the capabilityOverrides group of the panel and the pi-ai
 * route do not. The credential ref removal is best-effort: an env-shadowed
 * ref rejects the unset, which is reported as a warning, not a failure.
 */
export async function deletePanel(
  settings: SettingsService,
  credentials: CredentialsService | null,
  panelId: string,
): Promise<DeletePanelResult> {
  const panels = panelsOf(settings.get(NAMESPACE))
  const panel = panels.find((candidate) => candidate.id === panelId)
  if (!panel) throw new PanelRequestError(`找不到面板「${panelId}」`, 404)
  await settings.mutate(NAMESPACE, [
    { op: 'unset', path: ['panels', panelId] },
    { op: 'unset', path: ['capabilityOverrides', panelId] },
  ])
  const routeRemoved = await unsetRoute(settings, panelId)
  const warnings: string[] = []
  try {
    await credentials?.unset?.(panel.keyRef)
  } catch (err) {
    warnings.push(`凭据引用 ${panel.keyRef} 未能删除: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { routeRemoved, overridesRemoved: true, warnings }
}

/** Mirror one panel's connection fields into its route when the route exists. */
export async function mirrorPanelRoute(settings: SettingsService, panel: PanelConfig): Promise<boolean> {
  return await ensureRouteProfile(settings, panel)
}
