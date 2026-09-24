/**
 * Node-side aggregator for scripts/fetch-knowledge-preset.mjs, built to
 * lib/preset-tools.js by tsdown. The script cannot import src/*.ts under
 * plain Node (sources import each other with .js extensions), so it consumes
 * this compiled module instead — guaranteeing the script and the runtime
 * share one builder implementation. Not part of the package exports.
 */

export { buildPresetEntries, panelModelNames, PRESET_MAX_AGE_DAYS, PRESET_PROVIDERS } from './knowledge-preset.js'
export { envProxy, requestJson } from './http.js'
