# tests/walkthrough — browser acceptance tooling

Long-lived, zero-dependency Chrome-CDP driver for the plugin's browser
walkthroughs (v0.6.1, R6.4). These scripts are dev tools, not tests: they are
excluded from `npm pack` (package.json `files` lists only lib/ + docs) and
never run under vitest (`include: tests/**/*.test.ts`).

## Why CDP (and not Playwright/IAB)

The dsh settings dialog intercepts pointer events from Playwright-style
automation (actionability-timeout misses) and — per the v0.6.0/v0.6.1 IAB
investigation (docs/WORKLOG.md) — from the in-app-browser input pipeline
too. What reliably works is driving the page through Chrome DevTools
Protocol: `Runtime.evaluate` runs JS in the page, and DOM `.click()`
(isTrusted=false) is accepted by dsh. `Input.dispatchMouseEvent` (trusted
input events) also works; `Runtime.evaluate` is simply the most robust
against coordinate drift (zoom, smooth scroll, dialog clipping).

## cdp.mjs — driver library + CLI

```sh
# CLI quick checks
node tests/walkthrough/cdp.mjs open  <url> [--chrome <path>] [--port 9223]
node tests/walkthrough/cdp.mjs eval  '<js>'                 # print JSON result
node tests/walkthrough/cdp.mjs shot  out.png                # full-page screenshot
node tests/walkthrough/cdp.mjs close
```

Library use (from another .mjs):

```js
import { withChrome } from './cdp.mjs'
await withChrome({ url }, async ({ eval, shot, click }) => {
  await click('.relay_panelMain')            // visible-center click via CDP Input
  await eval('document.querySelector(".relay_keyList").children.length')
  await shot('panel-open.png')
})
```

Helpers worth knowing:

- `eval(expr)` — `Runtime.evaluate` with `awaitPromise`, JSON-stringified back.
- `click(selector)` — scrollIntoView({behavior:'instant'}), settle, then
  `Input.dispatchMouseEvent` at the element's visible center **verified with
  `elementFromPoint`** (the 0.6.0 lesson: smooth scroll and `<details>`
  clipping both stale coordinates).
- `domClick(selector)` — direct `HTMLElement.click()` fallback (works even
  when the point is covered by the dialog chrome).
- `shot(path)` — `Page.captureScreenshot` (viewport).

## shot.mjs — screenshot CLI against an ALREADY-running CDP target

```sh
node tests/walkthrough/shot.mjs <wsUrl-or-httpUrl> out.png
```

## Conventions

- Launch Chrome with its OWN user-data-dir under a temp path; never touch the
  operator's browser profile.
- The dsh web URL carries a session token (`?token=…` from the startup
  banner); treat it as a secret — screenshots must not include the URL bar
  (headless screenshots never do).
- Isolated dsh instances: `node scripts/dev.js --dsh-home <tmp> --port 3198
  --no-open` + `node .tmp/run-mock.mjs <port>` (mock panels).
