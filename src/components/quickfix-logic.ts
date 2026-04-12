import { InvoiceLineItem } from '../shared/types';

const TOLERANCE = 1; // 1 VND rounding tolerance for line item calculations
export const TOTAL_TOLERANCE = 1000; // 1000 VND tolerance for invoice-level totals

/**
 * Check if total_amount (after-tax) matches the sum of line item total_with_tax (after-tax).
 */
export function computeTotalMismatch(
  totalAmount: number,
  lineItems: { total_with_tax?: number | null }[],
  feeAmount?: number | null,
): { hasMismatch: boolean; sum: number } {
  if (lineItems.length === 0 || !totalAmount) {
    return { hasMismatch: false, sum: 0 };
  }
  const sum = lineItems.reduce((acc, item) => acc + (item.total_with_tax ?? 0), 0);
  const adjustedTotal = totalAmount - (feeAmount ?? 0);
  const hasMismatch = Math.abs(sum - adjustedTotal) > TOTAL_TOLERANCE;
  return { hasMismatch, sum };
}

/**
 * Check if total_before_tax matches the sum of line item subtotal.
 */
export function computeBeforeTaxTotalMismatch(
  totalBeforeTax: number,
  lineItems: { subtotal?: number | null }[],
): { hasMismatch: boolean; sum: number } {
  if (lineItems.length === 0 || !totalBeforeTax) {
    return { hasMismatch: false, sum: 0 };
  }
  const sum = lineItems.reduce((acc, item) => acc + (item.subtotal ?? 0), 0);
  const hasMismatch = Math.abs(sum - totalBeforeTax) > TOTAL_TOLERANCE;
  return { hasMismatch, sum };
}

/**
 * Check if subtotal matches unit_price * quantity (both pre-tax).
 */
export function computeLineItemMismatch(
  item: { unit_price?: number | null; quantity?: number | null; subtotal?: number | null },
): { hasMismatch: boolean; expected: number | null } {
  if (!item.unit_price || !item.quantity || item.subtotal == null) {
    return { hasMismatch: false, expected: null };
  }
  const expected = Math.round(item.unit_price * item.quantity);
  const hasMismatch = Math.abs(item.subtotal - expected) > TOLERANCE;
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
 * Check if total_with_tax (after-tax) matches subtotal * (1 + tax_rate/100).
 */
export function computeAfterTaxMismatch(
  item: { subtotal?: number | null; tax_rate?: number | null; total_with_tax?: number | null },
): { hasMismatch: boolean; expected: number | null } {
  if (item.subtotal == null || item.tax_rate == null || item.total_with_tax == null) {
    return { hasMismatch: false, expected: null };
  }
  const expected = Math.round(item.subtotal * (1 + item.tax_rate / 100));
  const hasMismatch = Math.abs(item.total_with_tax - expected) > TOLERANCE;
  return { hasMismatch, expected };
}

/**
 * Detect if tax_rate was likely extracted as a decimal (e.g. 0.08) instead of
 * percentage (e.g. 8). Values < 1 are almost certainly decimals that need *100.
 */
export function computeTaxRateMismatch(
  item: { tax_rate?: number | null },
): { hasMismatch: boolean; expected: number | null } {
  if (item.tax_rate == null || item.tax_rate === 0) {
    return { hasMismatch: false, expected: null };
  }
  if (item.tax_rate > 0 && item.tax_rate < 1) {
    return { hasMismatch: true, expected: Math.round(item.tax_rate * 100) };
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
  const qty = item.quantity;
  const price = item.unit_price;
  const tax = item.tax_rate;
  const beforeTax = item.subtotal;
  const afterTax = item.total_with_tax;

  let derived: number | null = null;
  let current: number | null = null;

  switch (fieldName) {
    case 'quantity': // qty = subtotal / price
      if (beforeTax != null && price != null && price !== 0) {
        derived = Math.round((beforeTax / price) * 1e6) / 1e6;
      }
      current = qty;
      break;

    case 'unit_price': // price = subtotal / qty
      if (beforeTax != null && qty != null && qty !== 0) {
        derived = Math.round((beforeTax / qty) * 1e6) / 1e6;
      }
      current = price;
      break;

    case 'tax_rate': {
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

    case 'subtotal': // subtotal = qty * price
      if (qty != null && price != null) {
        derived = Math.round(qty * price);
      }
      current = beforeTax;
      break;

    case 'total_with_tax': // after_tax = subtotal * (1 + tax/100)
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
  const isAmountField = fieldName === 'subtotal' || fieldName === 'total_with_tax';
  const tol = isAmountField ? TOLERANCE : 0.001;
  if (current != null && Math.abs(current - derived) <= tol) return null;
  return derived;
}
