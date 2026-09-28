/**
 * Zero-dependency Chrome DevTools Protocol driver for browser walkthroughs
 * (Node ≥22: global fetch + WebSocket). See README.md in this directory.
 *
 * Driver semantics distilled from the v0.6.0 walkthrough pain:
 *  - clicks go through CDP Input.dispatchMouseEvent at the element's visible
 *    center, verified with elementFromPoint after an INSTANT scroll;
 *  - `domClick` is the guaranteed fallback (dsh accepts isTrusted=false);
 *  - `eval` awaits promises and returns plain JSON.
 */

import { spawn, execFileSync } from 'node:child_process'
import { accessSync, mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const DEFAULT_PORT = 9223

/** Candidate Chrome binaries, first existing one wins. */
function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'google-chrome',
    'chromium',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      try {
        accessSync(candidate)
        return candidate
      } catch {
        continue
      }
    }
    try {
      execFileSync(`command -v ${candidate}`, { shell: '/bin/zsh', stdio: 'ignore' })
      return candidate
    } catch {
      continue
    }
  }
  throw new Error('no Chrome/Chromium found; set CHROME_BIN')
}

export class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined) return
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(`${message.error.message}: ${message.error.data ?? ''}`))
      else entry.resolve(message.result)
    })
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`cannot connect ${wsUrl}`)), { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  /** Evaluate an expression in the page; awaits promises; returns JSON data. */
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page eval failed: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`)
    }
    return result.result.value
  }

  /** Navigate and wait for the load event. */
  async goto(url) {
    await this.send('Page.enable')
    await this.send('Page.navigate', { url })
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  /**
   * Click a selector with trusted CDP input at its visible center. Scrolls
   * instantly first and verifies elementFromPoint hits the target (or a
   * descendant); otherwise falls back to a DOM click.
   */
  async click(selector) {
    const hit = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return { missing: true }
      el.scrollIntoView({ behavior: 'instant', block: 'center' })
      return {}
    })()`)
    if (hit?.missing) throw new Error(`selector not found: ${selector}`)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const center = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      const x = Math.floor(r.left + r.width / 2)
      const y = Math.floor(r.top + r.height / 2)
      const at = document.elementFromPoint(x, y)
      const inside = at !== null && (at === el || el.contains(at))
      return { x, y, inside, atTag: at?.tagName ?? null }
    })()`)
    if (center === null) throw new Error(`selector vanished: ${selector}`)
    if (center.inside) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await this.send('Input.dispatchMouseEvent', {
          type, x: center.x, y: center.y, button: 'left', clickCount: 1,
        })
      }
      return { input: true, ...center }
    }
    await this.domClick(selector)
    return { input: false, dom: true, ...center }
  }

  /** Direct HTMLElement.click() — dsh does not check isTrusted. */
  async domClick(selector) {
    const done = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      el.scrollIntoView({ behavior: 'instant', block: 'center' })
      el.click()
      return true
    })()`)
    if (done !== true) throw new Error(`selector not found: ${selector}`)
    return { dom: true }
  }

  /** Type text into a focused input via CDP key events. */
  async type(text) {
    for (const char of String(text)) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char })
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', text: char })
    }
  }

  /** Viewport screenshot to a PNG file. */
  async shot(path) {
    await this.send('Page.enable')
    const capture = await this.send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from(capture.data, 'base64'))
    return path
  }
}

/** The first page target's WebSocket URL of a debugger on `port`. */
export async function pageWsUrl(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  const targets = await response.json()
  const page = targets.find((target) => target.type === 'page')
  if (page === undefined) throw new Error(`no page target on port ${port}`)
  return page.webSocketDebuggerUrl
}

let chromeProcess = null
let chromeDir = null

/** Launch an isolated headless Chrome on a private user-data-dir. */
export async function launchChrome({ port = DEFAULT_PORT, chromeBin } = {}) {
  const bin = chromeBin ?? findChrome()
  chromeDir = mkdtempSync(join(tmpdir(), 'dsh-walkthrough-'))
  chromeProcess = spawn(bin, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${chromeDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1440,1000',
    'about:blank',
  ], { stdio: 'ignore' })
  // wait for the debugger endpoint
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return chromeProcess
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Chrome did not expose its debugger on :${port}`)
}

/** Kill the Chrome WE launched (by our own PID) and drop its profile dir. */
export function stopChrome() {
  if (chromeProcess !== null && chromeProcess.exitCode === null) chromeProcess.kill('SIGTERM')
  chromeProcess = null
  if (chromeDir !== null) {
    try {
      rmSync(chromeDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
  chromeDir = null
}

/** Run `body` against a fresh isolated Chrome pointed at `url`. */
export async function withChrome({ url, port = DEFAULT_PORT, chromeBin }, body) {
  await launchChrome({ port, chromeBin })
  try {
    const cdp = await Cdp.connect(await pageWsUrl(port))
    await cdp.goto(url)
    return await body(cdp)
  } finally {
    stopChrome()
  }
}

// ---------------------------------------------------------------------------
// CLI: open / eval / shot / close
if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2)
  const flag = (name) => {
    const index = rest.indexOf(name)
    return index === -1 ? undefined : rest[index + 1]
  }
  const port = Number(flag('--port') ?? DEFAULT_PORT)
  if (command === 'open') {
    const url = rest[0]
    await launchChrome({ port, chromeBin: flag('--chrome') })
    const cdp = await Cdp.connect(await pageWsUrl(port))
    await cdp.goto(url)
    console.log(`cdp: chrome up on :${port}, navigated`)
  } else if (command === 'eval') {
    console.log(JSON.stringify(await (await Cdp.connect(await pageWsUrl(port))).eval(rest[0]), null, 2))
  } else if (command === 'shot') {
    const cdp = await Cdp.connect(await pageWsUrl(port))
    console.log(await cdp.shot(rest[0]))
  } else if (command === 'close') {
    stopChrome()
    console.log('cdp: chrome stopped')
  } else {
    console.log('usage: cdp.mjs open <url> | eval <js> | shot <out.png> | close  [--port N] [--chrome <bin>]')
    process.exitCode = 2
  }
}
