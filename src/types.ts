/**
 * Structural types for the dsh host services this plugin consumes. The
 * official packages ship no type declarations, so these describe exactly the
 * surface we call — nothing more — and are verified against the runtime in
 * tests and browser acceptance.
 *
 * dsh ≥0.2.1 model: a plugin's persisted state lives in its composition
 * entry's config (the profile patch). The host `settings` service
 * (`ctx.settings`, the settings-forms service) reads/writes entries by ENTRY
 * id; fields the plugin's Config schema declares `.volatile()` are editable
 * without a plugin reload and arrive in `apply(ctx, config)` as live cell
 * references (`.get()` re-reads after every hot update).
 */

/** Schema value type: schemastery schemas are callable validators. */
export interface SchemaType<T = unknown> {
  (value: unknown): T
  /** schemastery builder surface we rely on. */
  role(tag: string): SchemaType<T>
  default(value: T): SchemaType<T>
  /** Mark a field hot-editable: writes never restart the plugin fiber. */
  volatile(): SchemaType<T>
}

/** What the host needs of a plugin Config schema: a callable validator. */
export type SchemaLike = (data: never) => unknown

/** Consumer context of a host plugin (cordis). */
export interface HostContext {
  inject(deps: readonly string[], callback: (ctx: HostContext) => void): void
  /** Register a disposable that dies with this plugin's fiber. */
  effect(fn: () => (() => void) | void, label?: string): void
  on(event: string, listener: (...args: never[]) => void): void
  logger: {
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
  }
  /**
   * Fiber-scoped repeating timers (cordis-plugin-timer, mounted by dsh-base).
   * NOTE: the mixin accessor THROWS on a context that never injected
   * `timer` — access is only legal after `ctx.inject(['timer'], …)`; callers
   * that cannot inject must self-manage via `effect` (see index.ts
   * `startInterval`).
   */
  setInterval?(callback: () => void, delay: number): () => void
  interval?(callback: () => void, delay: number): () => void
  /** The plugin's own fiber; `entry.options.id` is this instance's entry id. */
  fiber?: {
    entry?: { options?: { id?: string } }
  }
}

/** A live volatile config cell handed to `apply` for each `.volatile()` field. */
export interface VolatileRef<T> {
  get(): T
}

/**
 * The resolved plugin config as `apply(ctx, config)` receives it: every
 * volatile field of the Config schema is a cell, updated in place when the
 * entry config changes without a reload.
 */
export interface RelayConfigCells {
  panels: VolatileRef<Record<string, unknown> | undefined>
  capabilityCatalog: VolatileRef<Record<string, unknown> | undefined>
  capabilityOverrides: VolatileRef<Record<string, Record<string, unknown> | undefined> | undefined>
}

/** One path-addressed edit (`set` writes / creates, `unset` removes). */
export interface SettingsPathOp {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

/**
 * One entry descriptor as the host settings service describes it. `value` is
 * the resolved entry config projected to its volatile fields (secrets
 * included unless the caller asked for redaction); `user` is the raw profile
 * patch layer when one exists.
 */
export interface HostNamespaceView {
  ns: string
  revision: number
  value: unknown
  user?: unknown
}

/**
 * The HOST settings service (`ctx.settings`): form projection over every
 * composition entry's Config schema. Writes land in the profile patch and
 * reconcile volatile-only changes without a plugin reload. Every write must
 * be awaited before a request handler responds.
 */
export interface HostSettingsService {
  /** Register this instance's page policy (`{auto: false}` = we draw our own page). */
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
  /** Every configurable entry's current view, keyed by `ns` (the entry id). */
  describe(options?: { redactSecrets?: boolean }): HostNamespaceView[]
  /** Merge fields into an entry's config (objects deep-merge, arrays replace). */
  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void>
  /** Apply path ops without restating redacted secrets. */
  mutate(ns: string, ops: SettingsPathOp[], expectedRevision?: number): Promise<void>
}

/**
 * The plugin-side store facade every internal module consumes: the same
 * read/write shape the plugin used before dsh 0.2.x, now implemented over
 * volatile cells (own namespace) and the host describe view (foreign
 * namespaces). `get` returns resolved values; `section` the raw user layer.
 */
export interface SettingsService {
  get(ns: string): unknown
  section(ns: string): Record<string, unknown> | undefined
  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void>
  mutate(ns: string, ops: SettingsPathOp[], expectedRevision?: number): Promise<void>
  describe(options?: { redactSecrets?: boolean }): HostNamespaceView[]
}

/** Resolution result of a credential reference. */
export interface CredentialResolution {
  value?: string
}

/** The credentials service (`ctx.credentials`). */
export interface CredentialsService {
  resolve(ref: string): Promise<CredentialResolution | null | undefined>
  set(ref: string, value: string): Promise<void>
  /** Remove a reference; absent is a no-op, env-shadowed refs reject. */
  unset?(ref: string): Promise<void>
}

/** A stored models entry of a pi-ai provider profile (sparse shape). */
export interface RouteModelEntry {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  /** Request modalities; `[]`/absent means "inherit the route default". */
  input?: string[]
  /** `false` = explicitly non-reasoning; dict = level → wire spelling. */
  reasoningEfforts?: false | Record<string, string | null>
  compat?: Record<string, unknown>
  [field: string]: unknown
}

/** A pi-ai provider profile as stored under `llm-pi-ai.providers.<route>`. */
export interface RouteProfile {
  displayName?: string
  apiKeyEnv?: string
  api?: string
  baseURL?: string
  models?: RouteModelEntry[]
  modelOverrides?: Record<string, RouteModelEntry>
  defaultContextWindow?: number
  defaultMaxTokens?: number
  defaultInput?: string[]
  [field: string]: unknown
}

/** The `llm-pi-ai` namespace as the settings service resolves it. */
export interface PiAiSection {
  providers?: Record<string, RouteProfile>
}

/** Rejection thrown by the settings service when a revision-guarded write lost a race. */
export interface SettingsConflictError extends Error {
  code: 'SETTINGS_CONFLICT'
}
