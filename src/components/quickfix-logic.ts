import { InvoiceLineItem } from '../shared/types';

const TOLERANCE = 1; // 1 VND rounding tolerance

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
 * Check if tong_tien_truoc_thue (before-tax total) matches the sum of line item thanh_tien_truoc_thue.
 */
export function computeBeforeTaxTotalMismatch(
  tongTienTruocThue: number,
  lineItems: { thanh_tien_truoc_thue?: number | null }[],
): { hasMismatch: boolean; sum: number } {
  if (lineItems.length === 0 || !tongTienTruocThue) {
    return { hasMismatch: false, sum: 0 };
  }
  const sum = lineItems.reduce((acc, item) => acc + (item.thanh_tien_truoc_thue ?? 0), 0);
  const hasMismatch = Math.abs(sum - tongTienTruocThue) > TOLERANCE;
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
 * Check if thanh_tien (after-tax) matches thanh_tien_truoc_thue * (1 + thue_suat/100).
 */
export function computeAfterTaxMismatch(
  item: { thanh_tien_truoc_thue?: number | null; thue_suat?: number | null; thanh_tien?: number | null },
): { hasMismatch: boolean; expected: number | null } {
  if (item.thanh_tien_truoc_thue == null || item.thue_suat == null || item.thanh_tien == null) {
    return { hasMismatch: false, expected: null };
  }
  const expected = Math.round(item.thanh_tien_truoc_thue * (1 + item.thue_suat / 100));
  const hasMismatch = Math.abs(item.thanh_tien - expected) > TOLERANCE;
  return { hasMismatch, expected };
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

// === Cmd+Click field derivation ===

/**
 * Derive a field value from sibling fields on the same line item.
 * Returns null if the derivation is not possible (missing inputs)
 * or if the current value already matches the derived value.
 */
export function deriveFieldValue(
  fieldName: string,
  item: InvoiceLineItem,
): number | null {
  const qty = item.so_luong;
  const price = item.don_gia;
  const tax = item.thue_suat;
  const beforeTax = item.thanh_tien_truoc_thue;
  const afterTax = item.thanh_tien;

  let derived: number | null = null;
  let current: number | null = null;

  switch (fieldName) {
    case 'so_luong': // qty = before_tax / price
      if (beforeTax != null && price != null && price !== 0) {
        derived = Math.round((beforeTax / price) * 1e6) / 1e6;
      }
      current = qty;
      break;

    case 'don_gia': // price = before_tax / qty
      if (beforeTax != null && qty != null && qty !== 0) {
        derived = Math.round((beforeTax / qty) * 1e6) / 1e6;
      }
      current = price;
      break;

    case 'thue_suat': {
      // Auto-fix decimal rates (0.08 -> 8)
      const taxMismatch = computeTaxRateMismatch(item);
      if (taxMismatch.hasMismatch) {
        derived = taxMismatch.expected;
      } else if (afterTax != null && beforeTax != null && beforeTax !== 0) {
        // tax% = ((after_tax / before_tax) - 1) * 100
        const d = Math.round(((afterTax / beforeTax) - 1) * 100);
        if (d >= 0 && d <= 100) derived = d;
      }
      current = tax;
      break;
    }

    case 'thanh_tien_truoc_thue': // before_tax = qty * price
      if (qty != null && price != null) {
        derived = Math.round(qty * price);
      }
      current = beforeTax;
      break;

    case 'thanh_tien': // after_tax = before_tax * (1 + tax/100)
      if (beforeTax != null && tax != null) {
        derived = Math.round(beforeTax * (1 + tax / 100));
      }
      current = afterTax;
      break;

    default:
      return null;
  }

  if (derived == null) return null;
  // Only return derived value if it differs from current
  // Use tolerance for VND amount fields only; exact match for qty/price/tax
  const isAmountField = fieldName === 'thanh_tien_truoc_thue' || fieldName === 'thanh_tien';
  const tol = isAmountField ? TOLERANCE : 0.001;
  if (current != null && Math.abs(current - derived) <= tol) return null;
  return derived;
}

