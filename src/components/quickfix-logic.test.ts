import { describe, it, expect } from 'vitest';
import { computeTotalMismatch, computeLineItemMismatch, getMismatchedLineItems, computeTaxRateMismatch, getItemsWithBadTaxRate } from './quickfix-logic';
import { InvoiceLineItem } from '../shared/types';

describe('computeTotalMismatch', () => {
  it('returns no mismatch when after-tax sum matches total', () => {
    // thanh_tien is now after-tax, so direct sum comparison
    const result = computeTotalMismatch(1000, [
      { thanh_tien: 400 },
      { thanh_tien: 600 },
    ]);
    expect(result.hasMismatch).toBe(false);
    expect(result.sum).toBe(1000);
  });

  it('returns mismatch when after-tax sum differs', () => {
    const result = computeTotalMismatch(1000, [
      { thanh_tien: 400 },
      { thanh_tien: 500 },
    ]);
    expect(result.hasMismatch).toBe(true);
    expect(result.sum).toBe(900);
  });

  it('tolerates 1 VND rounding difference', () => {
    const result = computeTotalMismatch(1001, [
      { thanh_tien: 500 },
      { thanh_tien: 500 },
    ]);
    expect(result.hasMismatch).toBe(false);
  });

  it('returns no mismatch for empty line items', () => {
    const result = computeTotalMismatch(1000, []);
    expect(result.hasMismatch).toBe(false);
    expect(result.sum).toBe(0);
  });

  it('returns no mismatch when tongTien is 0', () => {
    const result = computeTotalMismatch(0, [{ thanh_tien: 500 }]);
    expect(result.hasMismatch).toBe(false);
  });

  it('handles null thanh_tien in items', () => {
    const result = computeTotalMismatch(500, [{ thanh_tien: 500 }, { thanh_tien: null }]);
    expect(result.hasMismatch).toBe(false);
    expect(result.sum).toBe(500);
  });
});

describe('computeLineItemMismatch', () => {
  it('returns no mismatch when product equals thanh_tien_truoc_thue', () => {
    const result = computeLineItemMismatch({ don_gia: 100, so_luong: 5, thanh_tien_truoc_thue: 500 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBe(500);
  });

  it('returns mismatch when product differs', () => {
    const result = computeLineItemMismatch({ don_gia: 100, so_luong: 5, thanh_tien_truoc_thue: 600 });
    expect(result.hasMismatch).toBe(true);
    expect(result.expected).toBe(500);
  });

  it('tolerates 1 VND rounding difference', () => {
    const result = computeLineItemMismatch({ don_gia: 33.33, so_luong: 3, thanh_tien_truoc_thue: 100 });
    // 33.33 * 3 = 99.99, rounded = 100
    expect(result.hasMismatch).toBe(false);
  });

  it('returns no mismatch when don_gia is null', () => {
    const result = computeLineItemMismatch({ don_gia: null, so_luong: 5, thanh_tien_truoc_thue: 500 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });

  it('returns no mismatch when so_luong is null', () => {
    const result = computeLineItemMismatch({ don_gia: 100, so_luong: null, thanh_tien_truoc_thue: 500 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });

  it('returns no mismatch when thanh_tien_truoc_thue is null', () => {
    const result = computeLineItemMismatch({ don_gia: 100, so_luong: 5, thanh_tien_truoc_thue: null });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });
});

describe('computeTaxRateMismatch', () => {
  it('detects decimal tax rate (0.08 should be 8)', () => {
    const result = computeTaxRateMismatch({ thue_suat: 0.08 });
    expect(result.hasMismatch).toBe(true);
    expect(result.expected).toBe(8);
  });

  it('detects decimal tax rate (0.1 should be 10)', () => {
    const result = computeTaxRateMismatch({ thue_suat: 0.1 });
    expect(result.hasMismatch).toBe(true);
    expect(result.expected).toBe(10);
  });

  it('does not flag correct percentage rate', () => {
    const result = computeTaxRateMismatch({ thue_suat: 8 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });

  it('does not flag 10%', () => {
    const result = computeTaxRateMismatch({ thue_suat: 10 });
    expect(result.hasMismatch).toBe(false);
  });

  it('does not flag 0% tax', () => {
    const result = computeTaxRateMismatch({ thue_suat: 0 });
    expect(result.hasMismatch).toBe(false);
  });

  it('does not flag null tax', () => {
    const result = computeTaxRateMismatch({ thue_suat: null });
    expect(result.hasMismatch).toBe(false);
  });
});

describe('getMismatchedLineItems', () => {
  const makeItem = (id: string, don_gia: number | null, so_luong: number | null, thanh_tien_truoc_thue: number | null): InvoiceLineItem => ({
    id,
    record_id: 'r1',
    line_number: 1,
    mo_ta: null,
    don_gia,
    so_luong,
    thue_suat: null,
    thanh_tien_truoc_thue,
    thanh_tien: null,
    deleted_at: null,
  });

  it('returns items where thanh_tien_truoc_thue differs from don_gia * so_luong', () => {
    const items = [
      makeItem('a', 100, 5, 500),   // match
      makeItem('b', 100, 5, 600),   // mismatch
      makeItem('c', 200, 3, 700),   // mismatch (expected 600)
    ];
    const result = getMismatchedLineItems(items);
    expect(result).toHaveLength(2);
    expect(result[0].item.id).toBe('b');
    expect(result[0].expected).toBe(500);
    expect(result[1].item.id).toBe('c');
    expect(result[1].expected).toBe(600);
  });

  it('excludes items with null fields', () => {
    const items = [
      makeItem('a', null, 5, 500),
      makeItem('b', 100, null, 500),
      makeItem('c', 100, 5, null),
    ];
    const result = getMismatchedLineItems(items);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for matching items', () => {
    const items = [
      makeItem('a', 100, 5, 500),
      makeItem('b', 200, 3, 600),
    ];
    const result = getMismatchedLineItems(items);
    expect(result).toHaveLength(0);
  });
});

describe('getItemsWithBadTaxRate', () => {
  const makeItem = (id: string, thue_suat: number | null): InvoiceLineItem => ({
    id,
    record_id: 'r1',
    line_number: 1,
    mo_ta: null,
    don_gia: 100,
    so_luong: 1,
    thue_suat,
    thanh_tien_truoc_thue: 100,
    thanh_tien: 100,
    deleted_at: null,
  });

  it('returns items with decimal tax rates', () => {
    const items = [
      makeItem('a', 0.08),  // bad
      makeItem('b', 10),    // good
      makeItem('c', 0.1),   // bad
    ];
    const result = getItemsWithBadTaxRate(items);
    expect(result).toHaveLength(2);
    expect(result[0].item.id).toBe('a');
    expect(result[0].expected).toBe(8);
    expect(result[1].item.id).toBe('c');
    expect(result[1].expected).toBe(10);
  });

  it('returns empty for correct rates', () => {
    const items = [
      makeItem('a', 8),
      makeItem('b', 10),
      makeItem('c', 0),
      makeItem('d', null),
    ];
    const result = getItemsWithBadTaxRate(items);
    expect(result).toHaveLength(0);
  });
});
