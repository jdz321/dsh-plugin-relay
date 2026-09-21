/**
 * Naming and vocabulary constants of the plugin. Every user-visible
 * identifier (settings namespace, HTTP prefix, pi-ai route, credential ref)
 * hangs off this module so the generic naming stays consistent.
 */

/** Settings namespace owned by the host plugin and edited by the web UI. */
export const NAMESPACE = 'relay'

/** pi-ai provider route the plugin publishes models under. */
export const ROUTE_DEFAULT = 'relay'

/** Credential reference the pi-ai route resolves its API key from. */
export const KEY_REF_DEFAULT = 'RELAY_API_KEY'

/** Stable Cordis plugin name. */
export const PLUGIN_NAME = 'relay'

/** npm package id, used as the browser client module id. */
export const CLIENT_MODULE_ID = 'dsh-plugin-relay'

/** Request modalities a pi-ai model entry may declare. */
export const MODALITIES = ['text', 'image'] as const

/** Thinking levels pi-ai understands, in escalation order. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Thinking levels the capability UI offers as chips (off is implicit). */
export const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type Modality = (typeof MODALITIES)[number]
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

/** Route-level capacity fallbacks when nothing better is known. */
export const DEFAULT_CONTEXT_WINDOW = 131072
export const DEFAULT_MAX_TOKENS = 8192

/** Locale namespace of the browser face. */
export const LOCALE_NS = 'relay-ui'

/** Prefix shared by every CSS class the browser face emits. */
export const CSS_PREFIX = 'relay'
