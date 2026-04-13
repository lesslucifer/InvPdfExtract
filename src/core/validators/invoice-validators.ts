import { DEFAULT_AMOUNT_TOLERANCE } from '../../shared/constants';

export interface ValidationWarning {
  type: string;
  message: string;
  expected?: number;
  actual?: number;
  missing?: string[];
  rate?: number;
}

export interface TaxBracket {
  rate: number;
  preTaxAmount: number;
  taxAmount: number;
}

/**
 * Validates that the sum of line item total_with_tax (after-tax) equals total_amount.
 */
export function validateLineItemSum(
  lineItems: { total_with_tax?: number }[],
  total: number,
  feeAmount?: number,
  tolerance?: number,
): ValidationWarning[] {
  const sum = lineItems.reduce((acc, item) => acc + (item.total_with_tax ?? 0), 0);
  const adjustedTotal = total - (feeAmount ?? 0);

  if (Math.abs(sum - adjustedTotal) > (tolerance ?? DEFAULT_AMOUNT_TOLERANCE)) {
    return [{
      type: 'line_item_sum_mismatch',
      message: `Sum of line items after-tax (${sum}) does not match total (${adjustedTotal})${feeAmount ? ` (total ${total} minus fee ${feeAmount})` : ''}`,
      expected: adjustedTotal,
      actual: sum,
    }];
  }

  return [];
}

/**
 * Validates that the sum of line item subtotal equals total_before_tax.
 */
export function validateLineItemSumBeforeTax(
  lineItems: { subtotal?: number }[],
  totalBeforeTax: number,
  tolerance?: number,
): ValidationWarning[] {
  const sum = lineItems.reduce((acc, item) => acc + (item.subtotal ?? 0), 0);

  if (Math.abs(sum - totalBeforeTax) > (tolerance ?? DEFAULT_AMOUNT_TOLERANCE)) {
    return [{
      type: 'line_item_sum_before_tax_mismatch',
      message: `Sum of line items before-tax (${sum}) does not match total before-tax (${totalBeforeTax})`,
      expected: totalBeforeTax,
      actual: sum,
    }];
  }

  return [];
}

/**
 * Detects gaps in sequential invoice numbers.
 * Handles numeric strings with optional leading zeros.
 */
export function detectInvoiceNumberGaps(
  invoiceNumbers: string[],
): ValidationWarning[] {
  if (invoiceNumbers.length <= 1) return [];

  // Try to parse all as numbers
  const parsed = invoiceNumbers
    .map((num) => {
      const n = parseInt(num, 10);
      return { original: num, numeric: n, isNumeric: !isNaN(n) };
    })
    .filter((p) => p.isNumeric);

  if (parsed.length <= 1) return [];

  // Sort by numeric value
  parsed.sort((a, b) => a.numeric - b.numeric);

  // Detect leading zeros pattern from the first number
  const padLength = invoiceNumbers.find((n) => /^\d+$/.test(n))?.length ?? 0;

  const warnings: ValidationWarning[] = [];
  for (let i = 0; i < parsed.length - 1; i++) {
    const current = parsed[i].numeric;
    const next = parsed[i + 1].numeric;

    if (next - current > 1) {
      const missing: string[] = [];
      for (let n = current + 1; n < next; n++) {
        const str = String(n);
        missing.push(padLength > str.length ? str.padStart(padLength, '0') : str);
      }
      warnings.push({
        type: 'invoice_number_gap',
        message: `Gap detected: missing invoice numbers ${missing.join(', ')}`,
        missing,
      });
    }
  }

  return warnings;
}

/**
 * Validates that tax amounts match the expected calculation per bracket.
 * Uses a 1 VND tolerance for rounding.
 */
export function validateTaxAmount(brackets: TaxBracket[], tolerance?: number): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const tol = tolerance ?? DEFAULT_AMOUNT_TOLERANCE;

  for (const bracket of brackets) {
    const expected = bracket.preTaxAmount * (bracket.rate / 100);
    const diff = Math.abs(expected - bracket.taxAmount);

    if (diff > tol) {
      warnings.push({
        type: 'tax_amount_mismatch',
        message: `Tax amount mismatch for ${bracket.rate}% rate: expected ${expected}, got ${bracket.taxAmount}`,
        expected: Math.round(expected),
        actual: bracket.taxAmount,
        rate: bracket.rate,
      });
    }
  }

  return warnings;
}
