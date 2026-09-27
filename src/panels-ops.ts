/**
 * Panel CRUD behind the /api/relay/panels-* routes, extracted so it is
 * unit-testable against FakeSettings. Writes are directed path ops into the
 * `relay.panels` dict; deleting a panel tears down everything the panel
 * owns — its pi-ai route, its override group, its credential ref — but never
 * the global knowledge base. The panel id is the provider route key and
 * display name, so it is immutable after creation (rename = delete + create).
 */

import { NAMESPACE } from './constants.js'
import { normalizePanel, panelIdError, panelsOf, uniqueKeyRef, type PanelConfig } from './panels.js'
import { ensureRouteProfile, unsetRoute } from './route-config.js'
import type { CredentialsService, SettingsPathOp, SettingsService } from './types.js'

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

export async function updatePanel(
  settings: SettingsService,
  input: { panel?: unknown, baseUrl?: unknown, accessToken?: unknown, userId?: unknown },
): Promise<PanelConfig> {
  const id = typeof input.panel === 'string' ? input.panel.trim() : ''
  const current = normalizePanel(id, (panelsOf(settings.get(NAMESPACE)) as PanelConfig[]).find((panel) => panel.id === id))
  if (!current) throw new PanelRequestError(`找不到面板「${id}」`, 404)
  const ops: SettingsPathOp[] = []
  if (typeof input.baseUrl === 'string') {
    const next = normalizeBaseUrl(input.baseUrl)
    if (!next) throw new PanelRequestError('API 地址不能为空')
    ops.push({ op: 'set', path: ['panels', id, 'baseUrl'], value: next })
  }
  if (input.userId !== undefined) {
    const userId = Number(input.userId)
    if (!Number.isFinite(userId) || userId <= 0) throw new PanelRequestError('用户 ID 须为正整数')
    ops.push({ op: 'set', path: ['panels', id, 'userId'], value: userId })
  }
  // Write-only token: absent or empty means "keep the current one".
  if (typeof input.accessToken === 'string' && input.accessToken.trim() !== '') {
    ops.push({ op: 'set', path: ['panels', id, 'accessToken'], value: input.accessToken.trim() })
  }
  if (ops.length) await settings.mutate(NAMESPACE, ops)
  const updated = normalizePanel(id, (panelsOf(settings.get(NAMESPACE)) as PanelConfig[]).find((panel) => panel.id === id))
  return updated ?? current
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
