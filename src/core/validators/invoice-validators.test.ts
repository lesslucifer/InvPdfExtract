import { describe, it, expect } from 'vitest';
import {
  validateLineItemSum,
  validateLineItemSumBeforeTax,
  detectInvoiceNumberGaps,
  validateTaxAmount,
  type TaxBracket,
} from './invoice-validators';

describe('Invoice Validators', () => {
  // ── Line item sum validation (after-tax) ──

  describe('validateLineItemSum', () => {
    it('passes when sum of after-tax total_with_tax equals total_amount', () => {
      const warnings = validateLineItemSum(
        [{ total_with_tax: 351000 }],
        351000,
      );
      expect(warnings).toHaveLength(0);
    });

    it('passes for multi-item invoice', () => {
      const lineItems = [
        { total_with_tax: 1944000 },
        { total_with_tax: 1512000 },
        { total_with_tax: 1080000 },
        { total_with_tax: 1188000 },
        { total_with_tax: 1404000 },
        { total_with_tax: 432000 },
        { total_with_tax: 540000 },
      ];
      const sum = lineItems.reduce((a, b) => a + (b.total_with_tax ?? 0), 0);
      const warnings = validateLineItemSum(lineItems, sum);
      expect(warnings).toHaveLength(0);
    });

    it('returns warning when sum does not match total', () => {
      const lineItems = [
        { total_with_tax: 100000 },
        { total_with_tax: 200000 },
      ];
      const warnings = validateLineItemSum(lineItems, 400000);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].type).toBe('line_item_sum_mismatch');
      expect(warnings[0].expected).toBe(400000);
      expect(warnings[0].actual).toBe(300000);
    });

    it('passes when sum + fee_amount equals total', () => {
      const lineItems = [
        { total_with_tax: 37957000 },
      ];
      const warnings = validateLineItemSum(lineItems, 50475000, 12518000);
      expect(warnings).toHaveLength(0);
    });

    it('returns warning when sum + fee_amount does not match total', () => {
      const lineItems = [
        { total_with_tax: 100000 },
        { total_with_tax: 200000 },
      ];
      const warnings = validateLineItemSum(lineItems, 500000, 50000);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].type).toBe('line_item_sum_mismatch');
      expect(warnings[0].expected).toBe(450000);
      expect(warnings[0].actual).toBe(300000);
    });

    it('ignores undefined feeAmount (backward compatible)', () => {
      const warnings = validateLineItemSum(
        [{ total_with_tax: 351000 }],
        351000,
      );
      expect(warnings).toHaveLength(0);
    });

    it('handles missing total_with_tax values gracefully', () => {
      const lineItems = [
        { total_with_tax: 100000 },
        { total_with_tax: undefined },
        { total_with_tax: 200000 },
      ];
      const warnings = validateLineItemSum(lineItems, 300000);
      expect(warnings).toHaveLength(0);
    });
  });

  // ── Line item sum validation (before-tax) ──

  describe('validateLineItemSumBeforeTax', () => {
    it('passes when sum of before-tax amounts equals total before tax', () => {
      const warnings = validateLineItemSumBeforeTax(
        [{ subtotal: 325000 }],
        325000,
      );
      expect(warnings).toHaveLength(0);
    });

    it('returns warning when sum does not match', () => {
      const warnings = validateLineItemSumBeforeTax(
        [{ subtotal: 100000 }, { subtotal: 200000 }],
        400000,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].type).toBe('line_item_sum_before_tax_mismatch');
    });
  });

  // ── Sequential invoice number gap detection ──

  describe('detectInvoiceNumberGaps', () => {
    it('no gap for consecutive numbers', () => {
      const gaps = detectInvoiceNumberGaps(['1', '2', '3', '4']);
      expect(gaps).toHaveLength(0);
    });

    it('detects gap between 2 and 5', () => {
      const gaps = detectInvoiceNumberGaps(['1', '2', '5', '6']);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].missing).toEqual(['3', '4']);
    });

    it('handles invoice numbers with leading zeros', () => {
      const gaps = detectInvoiceNumberGaps(['00000054', '00000055', '00000056', '00000058']);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].missing).toContain('00000057');
    });

    it('handles non-numeric invoice numbers gracefully (no crash)', () => {
      expect(() => detectInvoiceNumberGaps(['A1', 'A2', 'A4'])).not.toThrow();
    });

    it('no gap for single invoice number', () => {
      const gaps = detectInvoiceNumberGaps(['911']);
      expect(gaps).toHaveLength(0);
    });

    it('no gap for empty array', () => {
      const gaps = detectInvoiceNumberGaps([]);
      expect(gaps).toHaveLength(0);
    });

    it('handles unsorted input correctly', () => {
      const gaps = detectInvoiceNumberGaps(['3', '1', '5']);
      expect(gaps).toHaveLength(2);
      expect(gaps[0].missing).toContain('2');
      expect(gaps[1].missing).toContain('4');
    });
  });

  // ── Tax amount cross-validation ──

  describe('validateTaxAmount', () => {
    it('passes for uniform 8% tax (In Ky Thuat So #911)', () => {
      const brackets: TaxBracket[] = [
        { rate: 8, preTaxAmount: 325000, taxAmount: 26000 },
      ];
      const warnings = validateTaxAmount(brackets);
      expect(warnings).toHaveLength(0);
    });

    it('passes for mixed rate brackets (Zion Restaurant)', () => {
      const brackets: TaxBracket[] = [
        { rate: 10, preTaxAmount: 1840000, taxAmount: 184000 },
        { rate: 8, preTaxAmount: 2345600, taxAmount: 187648 },
      ];
      const warnings = validateTaxAmount(brackets);
      expect(warnings).toHaveLength(0);
    });

    it('passes when tax difference is within 1 VND rounding tolerance', () => {
      const brackets: TaxBracket[] = [
        { rate: 8, preTaxAmount: 100001, taxAmount: 8000 },
      ];
      const warnings = validateTaxAmount(brackets);
      expect(warnings).toHaveLength(0);
    });

    it('flags discrepancy exceeding 1 VND tolerance', () => {
      const brackets: TaxBracket[] = [
        { rate: 8, preTaxAmount: 200000, taxAmount: 14000 },
      ];
      const warnings = validateTaxAmount(brackets);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].type).toBe('tax_amount_mismatch');
    });
  });
});
