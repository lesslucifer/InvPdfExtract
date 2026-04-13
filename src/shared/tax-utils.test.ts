import { describe, it, expect } from 'vitest';
import { computeMissingTaxField, normalizeTaxRate } from './tax-utils';

describe('computeMissingTaxField', () => {
  it('returns both as-is when all three provided', () => {
    const result = computeMissingTaxField({ beforeTax: 10000, afterTax: 11000, taxRate: 10 });
    expect(result).toEqual({ beforeTax: 10000, afterTax: 11000 });
  });

  it('returns both as-is even if values are inconsistent (mismatch detection handles that)', () => {
    const result = computeMissingTaxField({ beforeTax: 10000, afterTax: 99999, taxRate: 10 });
    expect(result).toEqual({ beforeTax: 10000, afterTax: 99999 });
  });

  it('computes afterTax from beforeTax + rate', () => {
    const result = computeMissingTaxField({ beforeTax: 10000000, taxRate: 10 });
    expect(result).toEqual({ beforeTax: 10000000, afterTax: 11000000 });
  });

  it('computes afterTax from beforeTax + rate (8%)', () => {
    const result = computeMissingTaxField({ beforeTax: 325000, taxRate: 8 });
    expect(result).toEqual({ beforeTax: 325000, afterTax: 351000 });
  });

  it('does NOT back-compute beforeTax from afterTax + rate', () => {
    const result = computeMissingTaxField({ afterTax: 11000000, taxRate: 10 });
    expect(result).toEqual({ beforeTax: null, afterTax: 11000000 });
  });

  it('does NOT back-compute beforeTax from afterTax + rate (8%)', () => {
    const result = computeMissingTaxField({ afterTax: 351000, taxRate: 8 });
    expect(result).toEqual({ beforeTax: null, afterTax: 351000 });
  });

  it('handles rate=0 — beforeTax equals afterTax', () => {
    const result = computeMissingTaxField({ beforeTax: 5000, taxRate: 0 });
    expect(result).toEqual({ beforeTax: 5000, afterTax: 5000 });
  });

  it('computes afterTax using 0% when beforeTax provided but no rate', () => {
    const result = computeMissingTaxField({ beforeTax: 10000 });
    expect(result).toEqual({ beforeTax: 10000, afterTax: 10000 });
  });

  it('returns both as-is when beforeTax + afterTax but no rate', () => {
    const result = computeMissingTaxField({ beforeTax: 10000, afterTax: 11000 });
    expect(result).toEqual({ beforeTax: 10000, afterTax: 11000 });
  });

  it('returns only afterTax when only afterTax provided (no back-computation)', () => {
    const result = computeMissingTaxField({ afterTax: 11000 });
    expect(result).toEqual({ beforeTax: null, afterTax: 11000 });
  });

  it('returns nulls when nothing provided', () => {
    const result = computeMissingTaxField({});
    expect(result).toEqual({ beforeTax: null, afterTax: null });
  });

  it('returns nulls when all null', () => {
    const result = computeMissingTaxField({ beforeTax: null, afterTax: null, taxRate: null });
    expect(result).toEqual({ beforeTax: null, afterTax: null });
  });

  it('returns nulls when only rate provided — no amounts', () => {
    const result = computeMissingTaxField({ taxRate: 10 });
    expect(result).toEqual({ beforeTax: null, afterTax: null });
  });

  it('handles negative amounts (credit notes)', () => {
    const result = computeMissingTaxField({ beforeTax: -10000, taxRate: 10 });
    expect(result).toEqual({ beforeTax: -10000, afterTax: -11000 });
  });

  it('treats string tax rate (KCT) as 0% — afterTax equals beforeTax', () => {
    const result = computeMissingTaxField({ beforeTax: 10000, taxRate: 'KCT' });
    expect(result).toEqual({ beforeTax: 10000, afterTax: 10000 });
  });

  it('treats string tax rate (KKKNT) as 0%', () => {
    const result = computeMissingTaxField({ beforeTax: 50000, taxRate: 'KKKNT' });
    expect(result).toEqual({ beforeTax: 50000, afterTax: 50000 });
  });

  it('returns both as-is when string rate + both amounts provided', () => {
    const result = computeMissingTaxField({ beforeTax: 10000, afterTax: 10000, taxRate: 'KCT' });
    expect(result).toEqual({ beforeTax: 10000, afterTax: 10000 });
  });
});

describe('normalizeTaxRate', () => {
  it('converts 0.08 to 8', () => {
    expect(normalizeTaxRate(0.08)).toBe(8);
  });

  it('converts 0.1 to 10', () => {
    expect(normalizeTaxRate(0.1)).toBe(10);
  });

  it('converts 0.05 to 5', () => {
    expect(normalizeTaxRate(0.05)).toBe(5);
  });

  it('leaves 8 as-is', () => {
    expect(normalizeTaxRate(8)).toBe(8);
  });

  it('leaves 10 as-is', () => {
    expect(normalizeTaxRate(10)).toBe(10);
  });

  it('leaves 0 as-is', () => {
    expect(normalizeTaxRate(0)).toBe(0);
  });

  it('returns null for null', () => {
    expect(normalizeTaxRate(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeTaxRate(undefined)).toBeNull();
  });

  it('handles edge case 0.005 (0.5%) → 1', () => {
    expect(normalizeTaxRate(0.005)).toBe(1);
  });

  it('returns string tax rate as-is (KCT)', () => {
    expect(normalizeTaxRate('KCT')).toBe('KCT');
  });

  it('returns string tax rate as-is (KKKNT)', () => {
    expect(normalizeTaxRate('KKKNT')).toBe('KKKNT');
  });
});
