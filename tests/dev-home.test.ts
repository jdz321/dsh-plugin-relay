import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseDevArgs, resolveDevHome, resolveDshEntry } from '../scripts/dev.js'

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

describe('dev launcher flag parsing (--no-open passthrough)', () => {
  it('defaults to opening the browser on port 3098', () => {
    expect(parseDevArgs([])).toEqual({ homeFlag: undefined, port: '3098', noOpen: false })
  })

  it('parses --no-open alongside --dsh-home and --port', () => {
    expect(parseDevArgs(['--no-open', '--port', '3198', '--dsh-home', '/tmp/h']))
      .toEqual({ homeFlag: '/tmp/h', port: '3198', noOpen: true })
    // flag order does not matter; unknown args are ignored
    expect(parseDevArgs(['--port', '3298', '--no-open', '--something-else']))
      .toEqual({ homeFlag: undefined, port: '3298', noOpen: true })
  })
})
