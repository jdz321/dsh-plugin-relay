import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import nodePath from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

import * as hostEntry from '../src/index.js'

const ROOT = nodePath.resolve(import.meta.dirname, '..')

/** Module-table stub: a concrete object (interop enumerates own keys), every
 *  export a callable dummy — the factory only touches these at load time to
 *  wire imports, never to render. */
function stubModule(): Record<string, unknown> {
  const keys = [
    // react surface used across the bundle (incl. recharts' module init)
    'Component', 'PureComponent', 'Fragment', 'StrictMode', 'Suspense', 'lazy',
    'createElement', 'cloneElement', 'createRef', 'isValidElement', 'Children',
    'createContext', 'forwardRef', 'memo', 'startTransition',
    'useCallback', 'useContext', 'useDebugValue', 'useDeferredValue',
    'useEffect', 'useId', 'useImperativeHandle', 'useInsertionEffect',
    'useLayoutEffect', 'useMemo', 'useReducer', 'useRef', 'useState',
    'useSyncExternalStore', 'useTransition', 'version',
    // react/jsx-runtime
    'jsx', 'jsxs', 'jsxDEV',
    // react-dom / react-dom/client
    'createPortal', 'createRoot', 'hydrateRoot', 'render', 'flushSync',
    'unmountComponentAtNode', 'findDOMNode',
    // primitives components/icons this plugin references
    'Button', 'Switch', 'Pill', 'Tag', 'StateDot', 'Menu', 'Modal',
    'IconChevronDownOutline14',
  ]
  const stubValue: Record<string, unknown> = {}
  const stub: Record<string, unknown> = { __esModule: false, version: '18.3.0' }
  for (const key of keys) {
    if (key === 'version') continue
    stub[key] = function dummy(): Record<string, unknown> { return stubValue }
  }
  return stub
}

describe('host entry', () => {
  it('exports the generic plugin name and composition config', () => {
    expect(hostEntry.name).toBe('relay')
    expect(typeof hostEntry.apply).toBe('function')
    const config = (hostEntry.Config as unknown as (v: unknown) => Record<string, unknown>)({})
    // v0.6.0: the connection fields live in the panels dict; no legacy flat
    // route/keyRef base remains (no backward-compat — the plugin is unreleased)
    expect(Object.keys(config).sort()).toEqual(['capabilityCatalog', 'capabilityOverrides', 'panels'])
  })

  it('marks the nested panel access token as a secret in the schema envelope', () => {
    // The redact walker walks object-in-dict by schema: the wire surfaces drop
    // `panels.<id>.accessToken` exactly because this role tag is present (and
    // the field must stay default-less so the envelope carries no value).
    const config = hostEntry.Config as unknown as Record<string, any>
    const panels = config.dict.panels
    expect(panels.type).toBe('dict')
    expect(panels.inner.type).toBe('object')
    const token = panels.inner.dict.accessToken
    expect(token.meta?.role).toBe('secret')
    expect(token.meta?.default).toBeUndefined()
  })
})

describe('built artifacts', () => {
  it('lib/client.js is a __ModuleLoader__ module loading with only shell externals', () => {
    const text = readFileSync(nodePath.join(ROOT, 'lib/client.js'), 'utf8')
    expect(text.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(text.trimEnd().endsWith('});')).toBe(true)
    // no bare module imports (pure classic script)
    expect(text).not.toMatch(/^\s*import\s/m)

    // Load the artifact the way the shell does: run it with a window whose
    // __ModuleLoader__.load captures the definition, call the factory with a
    // fake require, and verify the export face + the require whitelist.
    // (Minification renames require/exports locals, so string greps would be
    // brittle — this exercises the real runtime contract.)
    const requested: string[] = []
    const fakeRequire = (spec: string): unknown => {
      requested.push(spec)
      return stubModule()
    }
    let definition: { id?: string, factory?: (req: (spec: string) => unknown) => Record<string, unknown> } | undefined
    const sandbox = {
      window: {
        __ModuleLoader__: {
          load: (def: { id: string, factory: (req: (spec: string) => unknown) => Record<string, unknown> }): void => {
            definition = def
          },
        },
      },
    }
    vm.runInNewContext(text, sandbox, { filename: 'lib/client.js' })
    expect(definition?.id).toBe('dsh-plugin-relay')
    const exportsFace = definition!.factory!(fakeRequire)
    expect(typeof exportsFace.apply).toBe('function')
    expect(Array.isArray(exportsFace.inject)).toBe(true)
    // react family + the primitives package come from the shell's frozen
    // module table; everything else (the SVG chart included) is bundled.
    // (react-dom / react-dom/client stay declared external in tsdown but the
    // artifact never requests them: the shell renders our component, and the
    // primitives only consume react itself.)
    expect([...new Set(requested)].sort()).toEqual([
      '@deepseek-ai/dsh-client-ui-primitives',
      'react',
      'react/jsx-runtime',
    ])
  })

  it('lib/client.js stays under the 350KB (minified) size cap', () => {
    const stats = statSync(nodePath.join(ROOT, 'lib/client.js'))
    // recharts (~770KB of the v0.5.1 artifact) is gone, replaced by the
    // hand-written SVG chart; the cap keeps the bundle from ever regressing.
    expect(stats.size).toBeLessThanOrEqual(350 * 1024)
  })

  it('lib/index.js is Node ESM importing only externals (dsh packages and node builtins)', () => {
    const text = readFileSync(nodePath.join(ROOT, 'lib/index.js'), 'utf8')
    expect(text).toMatch(/export\s/)
    const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
    const external = imports.filter((spec) => !spec.startsWith('.'))
    expect(external).toContain('@deepseek-ai/schemastery')
    for (const spec of external) {
      expect(spec.startsWith('@deepseek-ai/') || spec.startsWith('node:')).toBe(true)
    }
    // no runtime dependency beyond the declared schemastery + node builtins
    const npmImports = external.filter((spec) => !spec.startsWith('node:'))
    expect(npmImports).toEqual(['@deepseek-ai/schemastery'])
  })
})

describe('naming audit (no vendor-specific tokens in the deliverable)', () => {
  /** The historical vendor sentinel, spelled so this very file stays clean. */
  const SENTINEL = ['nex', 'tai'].join('')
  const FILES = [
    'src',
    'lib/index.js',
    'lib/client.js',
    'cordis.patch.yml',
    'README.md',
    'README.zh.md',
    'CHANGELOG.md',
    'AGENTS.md',
    'docs/WORKLOG.md',
    'docs/SPEC-0.4.0.md',
    'docs/SPEC-0.5.0.md',
    'docs/SPEC-0.5.1.md',
    'docs/SPEC-0.6.0.md',
    'docs/PUBLISHING.md',
    'package.json',
  ]

  it('grep -ri over sources, artifacts, patch, manifest and docs finds nothing', () => {
    const hits: string[] = []
    for (const file of FILES) {
      try {
        const out = execFileSync('grep', ['-ril', SENTINEL, file], { cwd: ROOT, encoding: 'utf8' })
        hits.push(out.trim())
      } catch {
        /* grep exits 1 when there are no matches — that is the pass case */
      }
    }
    expect(hits.filter(Boolean)).toEqual([])
  })
})
