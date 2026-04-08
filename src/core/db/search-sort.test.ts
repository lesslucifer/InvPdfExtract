import { describe, expect, it } from 'vitest';
import { isIntegerLikeInvoiceNumber, buildInvoiceNumberOrderBy } from './search-sort';

describe('search-sort', () => {
  describe('isIntegerLikeInvoiceNumber', () => {
    it('accepts digit-only invoice numbers', () => {
      expect(isIntegerLikeInvoiceNumber('00012')).toBe(true);
      expect(isIntegerLikeInvoiceNumber('12')).toBe(true);
    });

    it('rejects mixed or empty invoice numbers', () => {
      expect(isIntegerLikeInvoiceNumber('INV-12')).toBe(false);
      expect(isIntegerLikeInvoiceNumber('12A')).toBe(false);
      expect(isIntegerLikeInvoiceNumber('')).toBe(false);
      expect(isIntegerLikeInvoiceNumber('   ')).toBe(false);
    });
  });

  describe('buildInvoiceNumberOrderBy', () => {
    it('builds invoice-code-first, then numeric-first ascending order', () => {
      const sql = buildInvoiceNumberOrderBy('asc');
      expect(sql).toContain('CAST');
      expect(sql).toContain('normalize_text');
      expect(sql).toContain('ASC');
      expect(sql).toContain('invoice_code');
    });

    it('builds invoice-code-first, then numeric-first descending order', () => {
      const sql = buildInvoiceNumberOrderBy('desc');
      expect(sql).toContain('DESC');
      expect(sql).toContain('invoice_code');
      expect(sql).toContain('r.updated_at DESC');
    });
  });
});
