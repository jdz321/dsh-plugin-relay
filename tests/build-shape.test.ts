import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import * as hostEntry from '../src/index.js'

const ROOT = path.resolve(import.meta.dirname, '..')

describe('host entry', () => {
  it('exports the generic plugin name and composition config', () => {
    expect(hostEntry.name).toBe('relay')
    expect(typeof hostEntry.apply).toBe('function')
    const config = (hostEntry.Config as unknown as (v: unknown) => Record<string, unknown>)({})
    expect(config.baseUrl).toBe('')
    expect(config.route).toBe('relay')
    expect(config.keyRef).toBe('RELAY_API_KEY')
  })
})

describe('built artifacts', () => {
  it('lib/client.js is a __ModuleLoader__ module exporting {inject, apply}', () => {
    const text = readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
    expect(text.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(text).toContain('id: "dsh-plugin-relay"')
    expect(text.trimEnd().endsWith('});')).toBe(true)
    expect(text).toContain('exports.apply')
    expect(text).toContain('exports.inject')
    // react family comes from the shell's frozen module table; everything
    // else — the chart library included — is bundled into the artifact.
    expect(text).toContain('require("react")')
    const requires = [...text.matchAll(/\brequire\("([^"]+)"\)/g)].map((m) => m[1])
    const bare = [...new Set(requires.filter((spec) => !spec.startsWith('.') && !spec.startsWith('/')))]
    for (const spec of bare) {
      expect(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']).toContain(spec)
    }
    // no bare module imports (pure classic script)
    expect(text).not.toMatch(/^\s*import\s/m)
  })

  it('lib/index.js is Node ESM importing only externals (dsh packages and node builtins)', () => {
    const text = readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
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
  const FILES = [
    'src',
    'lib/index.js',
    'lib/client.js',
    'cordis.patch.yml',
    'README.md',
    'package.json',
  ]

  it('grep -ri over sources, artifacts, patch and manifest finds nothing', () => {
    const hits: string[] = []
    for (const file of FILES) {
      try {
        const out = execFileSync('grep', ['-ril', 'relay', file], { cwd: ROOT, encoding: 'utf8' })
        hits.push(out.trim())
      } catch {
        /* grep exits 1 when there are no matches — that is the pass case */
      }
    }
    expect(hits.filter(Boolean)).toEqual([])
  })
})
