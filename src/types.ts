/**
 * Structural types for the dsh host services this plugin consumes. The
 * official packages ship no type declarations, so these describe exactly the
 * surface we call — nothing more — and are verified against the runtime in
 * tests and browser acceptance.
 */

/** Schema value type: schemastery schemas are callable validators. */
export interface SchemaType<T = unknown> {
  (value: unknown): T
  /** schemastery builder surface we rely on. */
  role(tag: string): SchemaType<T>
  default(value: T): SchemaType<T>
}

/** What installSection needs of a schema: a callable validator. */
export type SchemaLike = (data: never) => unknown

/** Consumer context of a host plugin (cordis). */
export interface HostContext {
  inject(deps: readonly string[], callback: (ctx: HostContext) => void): void
  logger: {
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
  }
}

/** One `settings.mutate` path operation. */
export interface SettingsPathOp {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

/** One namespace descriptor as returned by `settings.describe()`. */
export interface SettingsDescriptor {
  ns: string
  revision: number
  value: unknown
}

/**
 * The settings service (`ctx.settings`). `get` returns the resolved value
 * (schema defaults + composition base + user layer); `section` returns the
 * raw stored user section; writes are queued per namespace and must be
 * awaited before a request handler responds.
 */
export interface SettingsService {
  get(ns: string): unknown
  section(ns: string): Record<string, unknown> | undefined
  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void>
  mutate(ns: string, ops: SettingsPathOp[], expectedRevision?: number): Promise<void>
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]
  installSection(
    owner: HostContext,
    ns: string,
    schema: SchemaLike,
    entry: Record<string, unknown>,
    hooks: {
      setSource: (current: unknown) => void
      onChange: () => void
    },
  ): void
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
