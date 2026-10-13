/**
 * Browser half of dsh-plugin-relay.
 *
 * Registers the relay page under the installed package's entry in the Plugins
 * panel (`plugins.bundle.config`, keyed by the bundle name — dsh ≥0.2.1 hosts
 * third-party plugin pages on the package detail card, NOT in the official
 * items list), binds the entry's config form for live revision/writable
 * state, and injects the stylesheet once. The bundle is wrapped in
 * `window.__ModuleLoader__.load` at build time (see tsdown.config.ts).
 */

import { CSS_PREFIX, CLIENT_MODULE_ID, LOCALE_NS, NAMESPACE } from '../constants.js'
import { dictionaries, localeNs, type Translator } from './locale.js'
import { RelaySection, type SectionEnv, type SettingsScope } from './section.js'
import { cssText } from './styles.js'

/** The bound config form of one entry: snapshot + queued writes (unused writes kept for parity with the old scope). */
export type ConfigFormScope = SettingsScope

/** Minimal structural view of the client root context. */
export interface ClientContext {
  effect(fn: () => (() => void) | void, label: string): void
  locale: {
    register(ns: string, dict: Record<string, unknown>): void
    bind(ns: string): (key: string) => unknown
  }
  configForms: {
    /** The shared form controller of one entry namespace (created on demand). */
    get(entryId: string): ConfigFormScope
    /** Keep the registration alive while the host serves any of the namespaces. */
    whileServed(namespaces: readonly string[], register: (served: Set<string>) => (() => void) | void): () => void
  }
  slots: {
    inject(slot: string, factory: () => unknown): void
    register(decl: Record<string, unknown>, component: unknown): unknown
  }
}

/** Services the page needs; apply waits for each through slots.inject. */
export const inject = ['slots', 'locale', 'configForms']

/** Inject the stylesheet once per page load (idempotent by data attribute). */
function injectStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = `dsh-plugin-relay/${CSS_PREFIX}-settings.css`
  if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-plugin-relay'
  tag.dataset.pluginCss = tagId
  tag.textContent = cssText
  document.head.append(tag)
}

/**
 * Register the relay page on the installed bundle's detail card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  injectStyles()
  ctx.effect(() => ctx.locale.register(localeNs, dictionaries as unknown as Record<string, unknown>), 'relay: locale')
  // Boundary: the shell's bound translator returns dictionary values of the
  // current language; our Dictionary type describes their exact shapes.
  const t = ctx.locale.bind(localeNs) as unknown as Translator
  const scope = ctx.configForms.get(NAMESPACE)
  const env = (): SectionEnv => ({ scope, t })
  ctx.effect(
    () => ctx.configForms.whileServed([NAMESPACE], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: CLIENT_MODULE_ID,
      inject: env,
    }, RelaySection))),
    'relay: page',
  )
}
