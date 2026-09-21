import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveDevHome, resolveDshEntry } from '../scripts/dev.js'

const ROOT = path.resolve(import.meta.dirname, '..')

describe('dev launcher home anchoring', () => {
  it('resolveDevHome anchors npm start to the workspace .dsh-home', () => {
    // No flag → the workspace home, ignoring an exported DSH_HOME: the dev
    // launcher must never boot a foreign dsh home.
    process.env.DSH_HOME = '/tmp/env-home-must-be-ignored'
    try {
      expect(resolveDevHome()).toBe(path.join(ROOT, '.dsh-home'))
    } finally {
      delete process.env.DSH_HOME
    }
    expect(resolveDevHome('/tmp/explicit')).toBe(path.resolve('/tmp/explicit'))
  })

  it('resolveDshEntry finds the dsh launcher from devDependencies', () => {
    const entry = resolveDshEntry()
    const rel = path.relative(ROOT, entry)
    expect(rel).toMatch(/^node_modules\/@deepseek-ai\/dsh\/.*bin\.js$/)
  })
})
