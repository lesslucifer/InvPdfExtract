import { describe, it, expect } from 'vitest';
import {
  validateLineItemSum,
  validateLineItemSumBeforeTax,
  detectInvoiceNumberGaps,
  validateTaxAmount,
  type ValidationWarning,
  type TaxBracket,
} from './invoice-validators';

describe('Invoice Validators', () => {
  // ── Line item sum validation (after-tax) ──

  describe('validateLineItemSum', () => {
    it('passes when sum of after-tax thanh_tien equals tong_tien', () => {
      const warnings = validateLineItemSum(
        [{ thanh_tien: 351000 }],
        351000,
      );
      expect(warnings).toHaveLength(0);
    });

    it('passes for multi-item invoice', () => {
      const lineItems = [
        { thanh_tien: 1944000 },
        { thanh_tien: 1512000 },
        { thanh_tien: 1080000 },
        { thanh_tien: 1188000 },
        { thanh_tien: 1404000 },
        { thanh_tien: 432000 },
        { thanh_tien: 540000 },
      ];
      const sum = lineItems.reduce((a, b) => a + (b.thanh_tien ?? 0), 0);
      const warnings = validateLineItemSum(lineItems, sum);
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
      const warnings = validateLineItemSum(lineItems, 300000);
      expect(warnings).toHaveLength(0);
    });
  });

  // ── Line item sum validation (before-tax) ──

  describe('validateLineItemSumBeforeTax', () => {
    it('passes when sum of before-tax amounts equals total before tax', () => {
      const warnings = validateLineItemSumBeforeTax(
        [{ thanh_tien_truoc_thue: 325000 }],
        325000,
      );
      expect(warnings).toHaveLength(0);
    });

    it('returns warning when sum does not match', () => {
      const warnings = validateLineItemSumBeforeTax(
        [{ thanh_tien_truoc_thue: 100000 }, { thanh_tien_truoc_thue: 200000 }],
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
