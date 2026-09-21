/**
 * Model pricing shaping for new-api-family panels (`GET /api/pricing`).
 * Two billing dialects exist across panels — newer new-api builds publish
 * direct per-token prices (input_price/output_price in USD per 1M tokens,
 * billing_mode: "token"), classic one-api/new-api publish quota multipliers
 * (model_ratio × group_ratio, completion_ratio for output) or fixed
 * per-call prices (quota_type 1 + model_price). normalizePricing() shapes
 * both into one structure; the web UI renders the numbers.
 *
 * The payload's `vendors` list (a new-api fork extension, present on panels
 * that group models by vendor) maps each entry's `vendor_id` to a display
 * name; models without a vendor keep `null`.
 */

export interface PricingModelEntry {
  quotaType: number
  modelRatio: number
  completionRatio: number
  modelPrice: number
  inputPrice: number
  outputPrice: number
  cacheReadPrice: number
  billingMode: string
  groups: string[]
  vendor: string | null
}

export interface NormalizedPricing {
  byModel: Map<string, PricingModelEntry>
  groupRatio: Record<string, number>
  usableGroup: Record<string, string>
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function isObj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Normalize a /api/pricing payload.
 * @returns null when the panel has no pricing table (endpoint missing/disabled).
 */
export function normalizePricing(body: unknown): NormalizedPricing | null {
  if (!isObj(body) || body.success === false) return null
  const raw = isObj(body.data) ? body.data : body
  const items = Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : []
  const vendorNames = new Map<string, string>()
  for (const vendor of Array.isArray(raw.vendors) ? raw.vendors : []) {
    if (isObj(vendor) && vendor.id !== undefined && typeof vendor.name === 'string') {
      vendorNames.set(String(vendor.id), vendor.name)
    }
  }
  const byModel = new Map<string, PricingModelEntry>()
  for (const item of items) {
    if (!isObj(item) || !item.model_name) continue
    const vendorId = item.vendor_id
    byModel.set(String(item.model_name), {
      quotaType: num(item.quota_type),
      modelRatio: num(item.model_ratio),
      completionRatio: num(item.completion_ratio),
      modelPrice: num(item.model_price),
      inputPrice: num(item.input_price),
      outputPrice: num(item.output_price),
      cacheReadPrice: num(item.cache_read_price),
      billingMode: typeof item.billing_mode === 'string' ? item.billing_mode : '',
      groups: Array.isArray(item.enable_groups) ? item.enable_groups.map(String) : [],
      vendor: vendorId !== undefined && vendorId !== null ? vendorNames.get(String(vendorId)) ?? null : null,
    })
  }
  return {
    byModel,
    groupRatio: isObj(raw.group_ratio) ? raw.group_ratio as Record<string, number> : {},
    usableGroup: isObj(raw.usable_group) ? raw.usable_group as Record<string, string> : {},
  }
}

/** Group multiplier for one group name ("default" → 1 on most panels). */
export function groupRatioOf(pricing: NormalizedPricing | null, group: string): number | null {
  const ratio = pricing?.groupRatio[group]
  return typeof ratio === 'number' ? ratio : null
}

export type PriceKind = 'token' | 'call' | 'ratio' | null

/** Pricing fields for one model id, JSON-safe for the /models fetch route. */
export function priceEntry(modelId: string, pricing: NormalizedPricing | null): {
  kind: PriceKind
  vendor: string | null
  inputPrice?: number
  outputPrice?: number
  cacheReadPrice?: number
  modelPrice?: number
  modelRatio?: number
  completionRatio?: number
  groups: string[]
} {
  const entry = pricing?.byModel.get(String(modelId))
  if (!entry) return { kind: null, vendor: null, groups: [] }
  let kind: PriceKind = null
  if (entry.inputPrice > 0 || entry.outputPrice > 0) kind = 'token'
  else if (entry.quotaType === 1 || entry.modelPrice > 0) kind = 'call'
  else if (entry.modelRatio > 0) kind = 'ratio'
  return {
    kind,
    vendor: entry.vendor,
    inputPrice: entry.inputPrice,
    outputPrice: entry.outputPrice,
    cacheReadPrice: entry.cacheReadPrice,
    modelPrice: entry.modelPrice,
    modelRatio: entry.modelRatio,
    completionRatio: entry.completionRatio,
    groups: entry.groups,
  }
}
