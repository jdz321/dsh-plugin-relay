/**
 * Build config for dsh-plugin-relay.
 *
 * Two artifacts, mirroring the DeepSeek Harness client-bundle conventions:
 *  - lib/index.js  : Host entry (ESM, Node) — the `relay` settings namespace
 *                    and the /api/relay/* fetch routes.
 *  - lib/client.js : Browser bundle wrapped in `window.__ModuleLoader__.load`.
 *                    Only react is externalized (the shell's module table
 *                    provides it); everything else is inlined.
 */
import { defineConfig } from 'tsdown'

const id = 'dsh-plugin-relay'

/** Browser module table entries the shell seeds at boot. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
] as const

/** Node-side runtime imports provided by the Harness host, never bundled. */
const HOST_EXTERNALS = [
  '@deepseek-ai/schemastery',
] as const

export default defineConfig([
  {
    name: id,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: [...HOST_EXTERNALS],
      onlyBundle: false,
    },
  },
  {
    name: `${id}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      onlyBundle: false,
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
