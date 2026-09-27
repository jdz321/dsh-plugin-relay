// Resolve the `.js` specifiers our TS sources use for each other onto the
// actual `.ts` files, so plain `node` (≥22.18, where type stripping is on by
// default) can run `src/*.ts` directly. Maintainer-only helper for
// `npm run preset:fetch` — keeps the script on the same builder the runtime
// uses without a throwaway build of a compiled helper.
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (!specifier.endsWith('.js') || !context.parentURL?.startsWith('file:')) throw err
      const tsUrl = pathToFileURL(fileURLToPath(new URL('.', context.parentURL)) + specifier.slice(0, -2) + 'ts')
      if (!existsSync(fileURLToPath(tsUrl))) throw err
      return { url: tsUrl.href, shortCircuit: true }
    }
  },
})
