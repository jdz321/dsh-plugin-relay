/**
 * The plugin-side settings store: adapts the dsh ≥0.2.1 settings-forms
 * service (entry-config model) to the read/write face the plugin's internal
 * modules consume.
 *
 * Own namespace: reads come from the volatile config cells `apply` received —
 * free, and always current after a hot (no-reload) write. Foreign namespaces
 * (`llm-pi-ai`, `agent-default-model`) are read through the host describe
 * view, cached until the host's `settings/document-updated` event reports a
 * change, so a request handler never pays a full describe() per read.
 *
 * Writes pass straight through: objects deep-merge, arrays replace, and every
 * call must be awaited before the request responds (the client refetches the
 * moment the response lands).
 */

import { NAMESPACE } from './constants.js'
import type {
  HostNamespaceView,
  HostSettingsService,
  PiAiSection,
  RelayConfigCells,
  SettingsPathOp,
  SettingsService,
} from './types.js'

/** `llm-pi-ai`'s composition entry id — the route profile store. */
export const PI_AI_NS = 'llm-pi-ai'

/** `agent-default-model`'s composition entry id — read for delete warnings. */
export const DEFAULT_MODEL_NS = 'agent-default-model'

interface CachedView {
  revision: number
  value: unknown
  user: Record<string, unknown> | undefined
}

export class PluginStore implements SettingsService {
  private readonly foreign = new Map<string, CachedView>()

  constructor(
    private readonly host: HostSettingsService,
    private readonly cells: RelayConfigCells,
    /** This instance's composition entry id (= the settings ns the UI edits). */
    readonly entryId: string = NAMESPACE,
  ) {}

  /**
   * Drop the foreign-entry cache. Wired to the host `settings/document-updated`
   * event (which fires after every reconciled config write, ours included).
   */
  invalidateForeign(ns?: string): void {
    if (ns === undefined) this.foreign.clear()
    else this.foreign.delete(ns)
  }

  /** Cached describe view of one entry; a miss describes every entry once. */
  private cachedView(ns: string): CachedView | undefined {
    const hit = this.foreign.get(ns)
    if (hit) return hit
    const fresh = this.host.describe().find((view) => view.ns === ns)
    if (!fresh) return undefined
    const view: CachedView = {
      revision: fresh.revision,
      value: fresh.value,
      user: fresh.user !== null && typeof fresh.user === 'object' && !Array.isArray(fresh.user)
        ? fresh.user as Record<string, unknown>
        : undefined,
    }
    this.foreign.set(ns, view)
    return view
  }

  /** Resolved value of one entry: own namespace from cells, others from describe. */
  get(ns: string): unknown {
    if (ns === this.entryId) {
      return {
        panels: this.cells.panels.get() ?? {},
        capabilityCatalog: this.cells.capabilityCatalog.get() ?? {},
        capabilityOverrides: this.cells.capabilityOverrides.get() ?? {},
      }
    }
    return this.cachedView(ns)?.value
  }

  /**
   * The raw user layer (profile patch) of one entry, when one exists — the
   * describe view's `user`, so post-write checks (empty override groups) see
   * exactly what was just persisted.
   */
  section(ns: string): Record<string, unknown> | undefined {
    return this.cachedView(ns)?.user
  }

  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void> {
    return this.host.update(ns, patch, expectedRevision)
  }

  mutate(ns: string, ops: SettingsPathOp[], expectedRevision?: number): Promise<void> {
    return this.host.mutate(ns, ops, expectedRevision)
  }

  describe(options?: { redactSecrets?: boolean }): HostNamespaceView[] {
    return this.host.describe(options)
  }

  /** The pi-ai section as the route writers and list views consume it. */
  piAi(): PiAiSection | undefined {
    const value = this.get(PI_AI_NS)
    return (value && typeof value === 'object') ? value as PiAiSection : undefined
  }
}
