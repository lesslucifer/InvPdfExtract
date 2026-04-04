import { InvoiceLineItem } from '../shared/types';

const TOLERANCE = 1000; // 1 VND rounding tolerance

/**
 * Check if tong_tien (after-tax) matches the sum of line item thanh_tien (after-tax).
 */
export function computeTotalMismatch(
  tongTien: number,
  lineItems: { thanh_tien?: number | null }[],
): { hasMismatch: boolean; sum: number } {
  if (lineItems.length === 0 || !tongTien) {
    return { hasMismatch: false, sum: 0 };
  }
  const sum = lineItems.reduce((acc, item) => acc + (item.thanh_tien ?? 0), 0);
  const hasMismatch = Math.abs(sum - tongTien) > TOLERANCE;
  return { hasMismatch, sum };
}

/**
 * Check if thanh_tien_truoc_thue matches don_gia * so_luong (both pre-tax).
 */
export function computeLineItemMismatch(
  item: { don_gia?: number | null; so_luong?: number | null; thanh_tien_truoc_thue?: number | null },
): { hasMismatch: boolean; expected: number | null } {
  if (item.don_gia == null || item.so_luong == null || item.thanh_tien_truoc_thue == null) {
    return { hasMismatch: false, expected: null };
  }
  const expected = Math.round(item.don_gia * item.so_luong);
  const hasMismatch = Math.abs(item.thanh_tien_truoc_thue - expected) > TOLERANCE;
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
