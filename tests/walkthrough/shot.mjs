/**
 * Screenshot CLI against an ALREADY-running CDP target — useful when a
 * walkthrough session is up and you just want a frame:
 *
 *   node tests/walkthrough/shot.mjs <wsUrl|httpUrl> out.png
 *
 * <httpUrl> may be the debugger http endpoint (http://127.0.0.1:9223) — the
 * first page target is used.
 */

import { Cdp, pageWsUrl } from './cdp.mjs'

const [target, out] = process.argv.slice(2)
if (!target || !out) {
  console.log('usage: shot.mjs <wsUrl|httpUrl> <out.png>')
  process.exit(2)
}
const wsUrl = target.startsWith('ws://')
  ? target
  : await pageWsUrl(Number(new URL(target).port))
const cdp = await Cdp.connect(wsUrl)
console.log(await cdp.shot(out))
