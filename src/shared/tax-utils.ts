/**
 * Compute missing after-tax amount from before-tax + tax rate.
 * One-directional only: beforeTax + rate → afterTax. Never reverse-computes.
 *
 * Rules:
 * - Both beforeTax and afterTax provided: return as-is
 * - beforeTax provided, no afterTax: compute afterTax using rate (default 0%)
 * - Only afterTax provided (no beforeTax): return as-is, no back-computation
 * - No amounts at all: return nulls
 */
export function computeMissingTaxField(opts: {
  beforeTax?: number | null;
  afterTax?: number | null;
  taxRate?: number | string | null;
}): { beforeTax: number | null; afterTax: number | null } {
  const bt = opts.beforeTax ?? null;
  const at = opts.afterTax ?? null;
  const rate = typeof opts.taxRate === 'number' ? opts.taxRate : 0; // string rates (KCT, KKKNT) treated as 0%

  // Both provided — return as-is
  if (bt != null && at != null) {
    return { beforeTax: bt, afterTax: at };
  }

  // beforeTax + rate → compute afterTax
  if (bt != null && at == null) {
    return { beforeTax: bt, afterTax: Math.round(bt * (1 + rate / 100)) };
  }

  // Only afterTax (or nothing) — return as-is, no back-computation
  return { beforeTax: bt, afterTax: at };
}

/**
 * Normalize decimal tax rates to percentage integers.
 * Some sources (especially XLSX) store 0.08 instead of 8, 0.1 instead of 10.
 * Values > 0 and < 1 are assumed to be decimals and are multiplied by 100.
 */
export function normalizeTaxRate(rate: number | string | null | undefined): number | string | null {
  if (rate == null) return null;
  if (typeof rate === 'string') return rate;
  if (rate > 0 && rate < 1) return Math.round(rate * 100);
  return rate;
}
