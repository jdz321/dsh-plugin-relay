/**
 * Panel configuration model — since v0.6.0 the `relay` namespace holds a
 * `panels` dict and every panel is its own pi-ai provider: the panel id IS
 * the provider route key and display name, and each panel carries its own
 * connection fields, credential ref, and active-key metadata. Multi-panel is
 * additive (several providers live at once), never a switcher.
 */

import { KEY_REF_PREFIX, PANEL_ID_PATTERN } from './constants.js'
import { Relay } from './relay.js'

/** One stored panel config (the `relay.panels.<id>` entry). */
export interface PanelConfig {
  id: string
  baseUrl: string
  relayKind: string
  /** Write-only; the settings wire never echoes it back. */
  accessToken?: string
  userId: number
  keyRef: string
  selectedKeyName: string
}

/** Validation error for a would-be panel id, or null when acceptable. */
export function panelIdError(id: string): string | null {
  if (!id) return '面板名称必填'
  if (!PANEL_ID_PATTERN.test(id)) {
    return '面板名称须以字母或数字开头，仅含字母、数字、下划线、连字符（≤32 字符）'
  }
  return null
}

/** Read one resolved `panels` dict entry into a PanelConfig; null when unusable. */
export function normalizePanel(id: string, raw: unknown): PanelConfig | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!PANEL_ID_PATTERN.test(id)) return null
  const record = raw as Record<string, unknown>
  const userId = Number(record.userId)
  return {
    id,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    relayKind: typeof record.relayKind === 'string' && record.relayKind ? record.relayKind : 'new-api',
    accessToken: typeof record.accessToken === 'string' && record.accessToken ? record.accessToken : undefined,
    userId: Number.isFinite(userId) ? userId : 0,
    keyRef: typeof record.keyRef === 'string' && record.keyRef ? record.keyRef : keyRefForPanelId(id),
    selectedKeyName: typeof record.selectedKeyName === 'string' ? record.selectedKeyName : '',
  }
}

/** Read the whole `panels` dict out of the resolved relay section. */
export function panelsOf(section: unknown): PanelConfig[] {
  const raw = (section && typeof section === 'object' && !Array.isArray(section))
    ? (section as Record<string, unknown>).panels
    : undefined
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
  return Object.entries(raw as Record<string, unknown>)
    .map(([id, entry]) => normalizePanel(id, entry))
    .filter((panel): panel is PanelConfig => panel !== null)
}

/** `my-relay` → `RELAY_API_KEY_MY_RELAY` (env-safe spelling of the id). */
export function keyRefForPanelId(id: string): string {
  return `${KEY_REF_PREFIX}_${id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
}

/** First credential ref for `id` that no existing panel already claims. */
export function uniqueKeyRef(id: string, used: ReadonlySet<string>): string {
  const base = keyRefForPanelId(id)
  if (!used.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`
    if (!used.has(candidate)) return candidate
  }
}

/** Build a Relay client from one panel config. */
export function relayFromPanel(panel: PanelConfig, timeoutMs = 20000, proxy: string | null = null): Relay {
  return new Relay({
    baseUrl: panel.baseUrl,
    accessToken: panel.accessToken ?? '',
    userId: panel.userId,
    proxy,
    timeoutMs,
  })
}

/** Whether a panel carries everything the management API needs. */
export function missingPanelSetup(panel: PanelConfig): 'baseUrl' | 'accessToken' | 'userId' | null {
  if (!panel.baseUrl) return 'baseUrl'
  if (!panel.accessToken) return 'accessToken'
  if (!panel.userId || panel.userId <= 0) return 'userId'
  return null
}

/** Host of a panel's base URL for list display; '' when unparseable. */
export function panelHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return ''
  }
}

/**
 * One connection-list row (v0.6.1): pure config state — NO account I/O (the
 * client fills that lazily via GET /api/relay/account). Carries the delete
 * Modal's warning inputs: the panel's override-group entry count and whether
 * dsh's default model points at this panel.
 */
export interface PanelSummary {
  id: string
  baseUrl: string
  host: string
  relayKind: string
  configured: boolean
  missing: string | null
  tokenConfigured: boolean
  userId: number | null
  keyRef: string
  selectedKeyName: string
  modelCount: number
  /** Entries in this panel's capabilityOverrides group. */
  overrideCount: number
  /** agent-default-model.provider === panel id. */
  defaultModelTarget: boolean
}

function overrideCountOf(relaySection: unknown, panelId: string): number {
  const raw = (relaySection && typeof relaySection === 'object' && !Array.isArray(relaySection))
    ? (relaySection as Record<string, unknown>).capabilityOverrides
    : undefined
  const group = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? (raw as Record<string, unknown>)[panelId]
    : undefined
  return group && typeof group === 'object' && !Array.isArray(group) ? Object.keys(group).length : 0
}

/**
 * Build every panel's list row from three namespace views. Pure and I/O-free
 * so the /panels route answers instantly (the v0.6.0 list called `self()` per
 * panel and stalled up to the HTTP timeout when a panel was down).
 */
export function panelSummaries(input: {
  /** Resolved `relay` section (panels + capabilityOverrides). */
  relay: unknown
  /** Resolved `llm-pi-ai` section (route catalogs → model counts). */
  piAi: unknown
  /** Resolved `agent-default-model` section (`.provider`), when it exists. */
  defaultModel: unknown
  /** Route models count lookup, injected so panels.ts stays route-agnostic. */
  routeModelsCount: (route: string) => number
}): PanelSummary[] {
  const defaultProvider = (input.defaultModel && typeof input.defaultModel === 'object' && !Array.isArray(input.defaultModel))
    ? (input.defaultModel as Record<string, unknown>).provider
    : undefined
  return panelsOf(input.relay).map((panel) => {
    const missing = missingPanelSetup(panel)
    return {
      id: panel.id,
      baseUrl: panel.baseUrl,
      host: panelHost(panel.baseUrl),
      relayKind: panel.relayKind,
      configured: missing === null,
      missing,
      tokenConfigured: Boolean(panel.accessToken),
      userId: panel.userId > 0 ? panel.userId : null,
      keyRef: panel.keyRef,
      selectedKeyName: panel.selectedKeyName || '',
      modelCount: input.routeModelsCount(panel.id),
      overrideCount: overrideCountOf(input.relay, panel.id),
      defaultModelTarget: typeof defaultProvider === 'string' && defaultProvider === panel.id,
    }
  })
}

/** The pi-ai route profile fields derived from one panel's connection settings. */
export function routeProfileFieldsFor(panel: Pick<PanelConfig, 'baseUrl' | 'keyRef'>): { api: string, baseURL: string, apiKeyEnv: string } {
  return {
    api: 'openai-completions',
    baseURL: `${panel.baseUrl.replace(/\/+$/, '')}/v1`,
    apiKeyEnv: panel.keyRef,
  }
}
