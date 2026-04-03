import { describe, it, expect } from 'vitest';
import {
  validateLineItemSum,
  detectInvoiceNumberGaps,
  validateTaxAmount,
  type ValidationWarning,
  type TaxBracket,
} from './invoice-validators';

describe('Invoice Validators', () => {
  // ── Line item sum validation ──

  describe('validateLineItemSum', () => {
    it('passes when sum of thanh_tien equals pre-tax total (single item)', () => {
      const warnings = validateLineItemSum(
        [{ thanh_tien: 325000 }],
        325000,
      );
      expect(warnings).toHaveLength(0);
    });

    it('passes for multi-item invoice (Dau Tu Duy Phu: 7 items)', () => {
      const lineItems = [
        { thanh_tien: 1800000 },
        { thanh_tien: 1400000 },
        { thanh_tien: 1000000 },
        { thanh_tien: 1100000 },
        { thanh_tien: 1300000 },
        { thanh_tien: 400000 },
        { thanh_tien: 500000 },
      ];
      const warnings = validateLineItemSum(lineItems, 7500000);
      expect(warnings).toHaveLength(0);
    });

    it('passes for mixed-rate invoice (Zion Restaurant: 6 items)', () => {
      const lineItems = [
        { thanh_tien: 320000 },
        { thanh_tien: 600000 },
        { thanh_tien: 2000000 },
        { thanh_tien: 640000 },
        { thanh_tien: 280000 },
        { thanh_tien: 345600 },
      ];
      const warnings = validateLineItemSum(lineItems, 4185600);
      expect(warnings).toHaveLength(0);
    });

    it('returns warning when sum does not match total', () => {
      const lineItems = [
        { thanh_tien: 100000 },
        { thanh_tien: 200000 },
      ];
      const warnings = validateLineItemSum(lineItems, 400000);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].type).toBe('line_item_sum_mismatch');
      expect(warnings[0].expected).toBe(400000);
      expect(warnings[0].actual).toBe(300000);
    });

    it('handles missing thanh_tien values gracefully', () => {
      const lineItems = [
        { thanh_tien: 100000 },
        { thanh_tien: undefined },
        { thanh_tien: 200000 },
      ];
      // Sum = 300000 (undefined treated as 0)
      const warnings = validateLineItemSum(lineItems, 300000);
      expect(warnings).toHaveLength(0);
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
      // Sorted: [1, 3, 5] → gap between 1-3 (missing 2) and gap between 3-5 (missing 4)
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
      // 100001 * 0.08 = 8000.08, diff = 0.08 < 1 VND tolerance → passes
      const brackets: TaxBracket[] = [
        { rate: 8, preTaxAmount: 100001, taxAmount: 8000 },
      ];
      const warnings = validateTaxAmount(brackets);
      expect(warnings).toHaveLength(0);
    });

    it('flags discrepancy exceeding 1 VND tolerance', () => {
      // 200000 * 0.08 = 16000, but we claim tax = 14000 → diff = 2000 → fails
      const brackets: TaxBracket[] = [
        { rate: 8, preTaxAmount: 200000, taxAmount: 14000 },
      ];
      const warnings = validateTaxAmount(brackets);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].type).toBe('tax_amount_mismatch');
    });
  });
});
