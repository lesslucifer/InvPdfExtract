import { InvoiceLineItem } from '../shared/types';

const TOLERANCE = 1; // 1 VND rounding tolerance

/**
 * Compute the tax-inclusive total for a line item.
 * thanh_tien is pre-tax (don_gia * so_luong), thue_suat is percentage (e.g. 10 for 10%).
 */
function lineItemWithTax(item: { thanh_tien?: number | null; thue_suat?: number | null }): number {
  const base = item.thanh_tien ?? 0;
  const rate = item.thue_suat ?? 0;
  return Math.round(base * (1 + rate / 100));
}

/**
 * Check if tong_tien matches the tax-inclusive sum of line items.
 */
export function computeTotalMismatch(
  tongTien: number,
  lineItems: { thanh_tien?: number | null; thue_suat?: number | null }[],
): { hasMismatch: boolean; sum: number } {
  if (lineItems.length === 0 || !tongTien) {
    return { hasMismatch: false, sum: 0 };
  }
  const sum = lineItems.reduce((acc, item) => acc + lineItemWithTax(item), 0);
  const hasMismatch = Math.abs(sum - tongTien) > TOLERANCE;
  return { hasMismatch, sum };
}

/**
 * Check if thanh_tien matches don_gia * so_luong (pre-tax line total).
 */
export function computeLineItemMismatch(
  item: { don_gia?: number | null; so_luong?: number | null; thanh_tien?: number | null },
): { hasMismatch: boolean; expected: number | null } {
  if (item.don_gia == null || item.so_luong == null || item.thanh_tien == null) {
    return { hasMismatch: false, expected: null };
  }
  const expected = Math.round(item.don_gia * item.so_luong);
  const hasMismatch = Math.abs(item.thanh_tien - expected) > TOLERANCE;
  return { hasMismatch, expected };
}

export function getMismatchedLineItems(
  items: InvoiceLineItem[],
): { item: InvoiceLineItem; expected: number }[] {
  const results: { item: InvoiceLineItem; expected: number }[] = [];
  for (const item of items) {
    const { hasMismatch, expected } = computeLineItemMismatch(item);
    if (hasMismatch && expected != null) {
      results.push({ item, expected });
    }
  }
  return results;
}

/**
 * Detect if thue_suat was likely extracted as a decimal (e.g. 0.08) instead of
 * percentage (e.g. 8). Values < 1 are almost certainly decimals that need *100.
 */
export function computeTaxRateMismatch(
  item: { thue_suat?: number | null },
): { hasMismatch: boolean; expected: number | null } {
  if (item.thue_suat == null || item.thue_suat === 0) {
    return { hasMismatch: false, expected: null };
  }
  if (item.thue_suat > 0 && item.thue_suat < 1) {
    return { hasMismatch: true, expected: Math.round(item.thue_suat * 100) };
  }
  return { hasMismatch: false, expected: null };
}

export function getItemsWithBadTaxRate(
  items: InvoiceLineItem[],
): { item: InvoiceLineItem; expected: number }[] {
  const results: { item: InvoiceLineItem; expected: number }[] = [];
  for (const item of items) {
    const { hasMismatch, expected } = computeTaxRateMismatch(item);
    if (hasMismatch && expected != null) {
      results.push({ item, expected });
    }
  }
  return results;
}
