/**
 * Browser half of dsh-plugin-relay.
 *
 * Registers the settings section (four tabs) under the locale namespace
 * `relay-ui`, binds the host plugin's `relay` settings namespace for the
 * connection form, and injects the stylesheet once. The bundle is wrapped in
 * `window.__ModuleLoader__.load` at build time (see tsdown.config.ts).
 */

import { CSS_PREFIX, LOCALE_NS, NAMESPACE } from '../constants.js'
import { dictionaries, localeNs, type Translator } from './locale.js'
import { RelaySection, type SectionEnv, type SettingsScope } from './section.js'
import { cssText } from './styles.js'

/** Minimal structural view of the client root context. */
export interface ClientContext {
  effect(fn: () => (() => void) | void, label: string): void
  locale: {
    register(ns: string, dict: Record<string, unknown>): void
    bind(ns: string): (key: string) => unknown
  }
  settingsScope: {
    bind(spec: { namespace: string, decode?: (raw: unknown) => unknown }): SettingsScope
  }
  slots: {
    inject(slot: string, factory: () => unknown): void
    register(decl: Record<string, unknown>, component: unknown): unknown
  }
}

/** Services the section needs; apply waits for each through slots.inject. */
export const inject = ['slots', 'locale', 'settingsScope']

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
 * Register the relay settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  injectStyles()
  ctx.effect(() => ctx.locale.register(localeNs, dictionaries as unknown as Record<string, unknown>), 'relay: locale')
  // Boundary: the shell's bound translator returns dictionary values of the
  // current language; our Dictionary type describes their exact shapes.
  const t = ctx.locale.bind(localeNs) as unknown as Translator
  const scope = ctx.settingsScope.bind({
    namespace: NAMESPACE,
    decode: (raw: unknown) => raw ?? {},
  })
  const env = (): SectionEnv => ({ scope, t })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'relay',
    order: 12,
    label: () => t('nav'),
    inject: env,
  }, RelaySection))
}
