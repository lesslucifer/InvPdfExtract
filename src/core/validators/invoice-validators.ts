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
 * Validates that the sum of line item thanh_tien (after-tax) equals tong_tien.
 */
export function validateLineItemSum(
  lineItems: { thanh_tien?: number }[],
  total: number,
): ValidationWarning[] {
  const sum = lineItems.reduce((acc, item) => acc + (item.thanh_tien ?? 0), 0);

  if (Math.abs(sum - total) > 1) {
    return [{
      type: 'line_item_sum_mismatch',
      message: `Sum of line items after-tax (${sum}) does not match total (${total})`,
      expected: total,
      actual: sum,
    }];
  }

  return [];
}

/**
 * Validates that the sum of line item thanh_tien_truoc_thue equals tong_tien_truoc_thue.
 */
export function validateLineItemSumBeforeTax(
  lineItems: { thanh_tien_truoc_thue?: number }[],
  totalBeforeTax: number,
): ValidationWarning[] {
  const sum = lineItems.reduce((acc, item) => acc + (item.thanh_tien_truoc_thue ?? 0), 0);

  if (Math.abs(sum - totalBeforeTax) > 1) {
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
export function validateTaxAmount(brackets: TaxBracket[]): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const TOLERANCE = 1000; // 1 VND rounding tolerance

  for (const bracket of brackets) {
    const expected = bracket.preTaxAmount * (bracket.rate / 100);
    const diff = Math.abs(expected - bracket.taxAmount);

    if (diff > TOLERANCE) {
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
