/**
 * An in-memory settings service that mirrors the dsh semantics the plugin
 * relies on: resolved `get` (base + user), raw `section`, deep-merging
 * `update` (arrays replace wholesale), path-op `mutate` applied to the section
 * as it stands when the write lands, revision-guarded writes, and
 * `describe` for the current revisions.
 */

import type { HostNamespaceView, SettingsPathOp, SettingsService } from '../src/types.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeLayers(under: unknown, over: unknown): unknown {
  if (over === undefined) return under
  if (!isPlainObject(under) || !isPlainObject(over)) return over
  const merged = { ...under }
  for (const [key, value] of Object.entries(over)) merged[key] = key in merged ? mergeLayers(merged[key], value) : value
  return merged
}

/** dsh-settings applyPathOp: path segments address plain objects only. */
function applyPathOp(section: Record<string, unknown>, op: SettingsPathOp): Record<string, unknown> {
  const [head, ...rest] = op.path
  if (head === undefined) {
    if (op.op === 'unset') return {}
    return { ...(op.value as Record<string, unknown>) }
  }
  if (rest.length === 0) {
    if (op.op === 'set') return { ...section, [head]: op.value }
    const { [head]: _removed, ...kept } = section
    return kept
  }
  const child = section[head]
  if (!isPlainObject(child)) {
    if (op.op === 'unset') return section
    return { ...section, [head]: applyPathOp({}, { ...op, path: rest }) }
  }
  return { ...section, [head]: applyPathOp(child, { ...op, path: rest }) }
}

function conflict(ns: string): Error {
  const err = new Error(`settings namespace "${ns}" changed since it was read`) as Error & { code: string }
  err.code = 'SETTINGS_CONFLICT'
  return err
}

interface Registration {
  ns: string
  revision: number
  base?: Record<string, unknown>
  schema?: (value: unknown) => unknown
}

export class FakeSettings implements SettingsService {
  document: Record<string, Record<string, unknown>> = {}
  registrations = new Map<string, Registration>()
  /** When set, the next revision-matching mutate is refused once (simulated concurrent writer). */
  conflictOnce = false
  writes = 0
  installSectionCalls = 0

  register(ns: string, base?: Record<string, unknown>): this {
    this.registrations.set(ns, { ns, revision: 1, ...(base ? { base } : {}) })
    return this
  }

  installSection(): void {
    this.installSectionCalls += 1
  }

  async seed(ns: string, section: Record<string, unknown>): Promise<void> {
    this.document[ns] = section
    this.registrations.get(ns)!.revision += 1
  }

  get(ns: string): unknown {
    const registration = this.registrations.get(ns)
    if (!registration) return undefined
    const section = this.document[ns] ?? {}
    const merged = mergeLayers(registration.base ?? {}, section)
    return registration.schema ? registration.schema(merged) : merged
  }

  section(ns: string): Record<string, unknown> | undefined {
    const section = this.document[ns]
    if (section === undefined) return undefined
    if (!isPlainObject(section)) throw new TypeError(`section "${ns}" must be an object`)
    return section
  }

  async update(ns: string, patch: Record<string, unknown>): Promise<void> {
    this.writes += 1
    const registration = this.registrations.get(ns)
    if (!registration) throw new Error(`settings namespace "${ns}" is not registered`)
    const current = this.document[ns] ?? {}
    this.document[ns] = mergeLayers(current, patch) as Record<string, unknown>
    registration.revision += 1
  }

  async mutate(ns: string, ops: SettingsPathOp[], expectedRevision?: number): Promise<void> {
    this.writes += 1
    const registration = this.registrations.get(ns)
    if (!registration) throw new Error(`settings namespace "${ns}" is not registered`)
    if (expectedRevision !== undefined) {
      if (this.conflictOnce && expectedRevision === registration.revision) {
        // A concurrent writer lands first, then our write hits the guard.
        this.conflictOnce = false
        registration.revision += 1
        throw conflict(ns)
      }
      if (expectedRevision !== registration.revision) throw conflict(ns)
    }
    let section = this.document[ns] ?? {}
    for (const op of ops) section = applyPathOp(section, op)
    this.document[ns] = section
    registration.revision += 1
  }

  describe(): HostNamespaceView[] {
    return [...this.registrations.values()].map((registration) => ({
      ns: registration.ns,
      revision: registration.revision,
      value: this.get(registration.ns),
    }))
  }
}
