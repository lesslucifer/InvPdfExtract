import { describe, it, expect } from 'vitest';
import { computeTotalMismatch, computeLineItemMismatch, getMismatchedLineItems, computeTaxRateMismatch, getItemsWithBadTaxRate, computeAfterTaxMismatch, deriveFieldValue, computeBeforeTaxTotalMismatch } from './quickfix-logic';
import { InvoiceLineItem } from '../shared/types';

describe('computeTotalMismatch', () => {
  it('returns no mismatch when after-tax sum matches total', () => {
    const result = computeTotalMismatch(1000, [
      { total_with_tax: 400 },
      { total_with_tax: 600 },
    ]);
    expect(result.hasMismatch).toBe(false);
    expect(result.sum).toBe(1000);
  });

  it('returns mismatch when after-tax sum differs by more than 1000 VND', () => {
    const result = computeTotalMismatch(100000, [
      { total_with_tax: 40000 },
      { total_with_tax: 50000 },
    ]);
    expect(result.hasMismatch).toBe(true);
    expect(result.sum).toBe(90000);
  });

  it('tolerates up to 1000 VND difference', () => {
    const result = computeTotalMismatch(1001000, [
      { total_with_tax: 500000 },
      { total_with_tax: 500000 },
    ]);
    expect(result.hasMismatch).toBe(false);
  });

  it('flags mismatch when difference exceeds 1000 VND', () => {
    const result = computeTotalMismatch(1002000, [
      { total_with_tax: 500000 },
      { total_with_tax: 500000 },
    ]);
    expect(result.hasMismatch).toBe(true);
  });

  it('returns no mismatch for empty line items', () => {
    const result = computeTotalMismatch(1000, []);
    expect(result.hasMismatch).toBe(false);
    expect(result.sum).toBe(0);
  });

  it('returns no mismatch when totalAmount is 0', () => {
    const result = computeTotalMismatch(0, [{ total_with_tax: 500 }]);
    expect(result.hasMismatch).toBe(false);
  });

  it('handles null total_with_tax in items', () => {
    const result = computeTotalMismatch(500, [{ total_with_tax: 500 }, { total_with_tax: null }]);
    expect(result.hasMismatch).toBe(false);
    expect(result.sum).toBe(500);
  });

  it('accounts for fee_amount when computing mismatch', () => {
    const result = computeTotalMismatch(50475000, [
      { total_with_tax: 37957000 },
    ], 12518000);
    expect(result.hasMismatch).toBe(false);
    expect(result.sum).toBe(37957000);
  });

  it('detects mismatch even with fee_amount', () => {
    const result = computeTotalMismatch(50475000, [
      { total_with_tax: 30000000 },
    ], 12518000);
    expect(result.hasMismatch).toBe(true);
  });

  it('ignores null fee_amount', () => {
    const result = computeTotalMismatch(1000, [
      { total_with_tax: 400 },
      { total_with_tax: 600 },
    ], null);
    expect(result.hasMismatch).toBe(false);
  });
});

describe('computeLineItemMismatch', () => {
  it('returns no mismatch when product equals subtotal', () => {
    const result = computeLineItemMismatch({ unit_price: 100, quantity: 5, subtotal: 500 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBe(500);
  });

  it('returns mismatch when product differs', () => {
    const result = computeLineItemMismatch({ unit_price: 100, quantity: 5, subtotal: 600 });
    expect(result.hasMismatch).toBe(true);
    expect(result.expected).toBe(500);
  });

  it('tolerates 1 VND rounding difference', () => {
    const result = computeLineItemMismatch({ unit_price: 33.33, quantity: 3, subtotal: 100 });
    expect(result.hasMismatch).toBe(false);
  });

  it('returns no mismatch when unit_price is null', () => {
    const result = computeLineItemMismatch({ unit_price: null, quantity: 5, subtotal: 500 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });

  it('returns no mismatch when unit_price is 0 (no price data)', () => {
    const result = computeLineItemMismatch({ unit_price: 0, quantity: 5, subtotal: 500 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });

  it('returns no mismatch when quantity is null', () => {
    const result = computeLineItemMismatch({ unit_price: 100, quantity: null, subtotal: 500 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });

  it('returns no mismatch when quantity is 0 (no qty data)', () => {
    const result = computeLineItemMismatch({ unit_price: 100, quantity: 0, subtotal: 500 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });

  it('returns no mismatch when subtotal is null', () => {
    const result = computeLineItemMismatch({ unit_price: 100, quantity: 5, subtotal: null });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });
});

describe('computeBeforeTaxTotalMismatch', () => {
  it('returns no mismatch when subtotal sum matches total_before_tax', () => {
    const result = computeBeforeTaxTotalMismatch(1000, [{ subtotal: 400 }, { subtotal: 600 }]);
    expect(result.hasMismatch).toBe(false);
  });

  it('tolerates up to 1000 VND difference', () => {
    const result = computeBeforeTaxTotalMismatch(1001000, [{ subtotal: 500000 }, { subtotal: 500000 }]);
    expect(result.hasMismatch).toBe(false);
  });

  it('flags mismatch when difference exceeds 1000 VND', () => {
    const result = computeBeforeTaxTotalMismatch(1002000, [{ subtotal: 500000 }, { subtotal: 500000 }]);
    expect(result.hasMismatch).toBe(true);
  });

  it('returns no mismatch for empty line items', () => {
    const result = computeBeforeTaxTotalMismatch(1000, []);
    expect(result.hasMismatch).toBe(false);
  });
});

describe('computeAfterTaxMismatch', () => {
  it('returns mismatch when after_tax != before_tax * (1 + tax/100)', () => {
    const result = computeAfterTaxMismatch({ subtotal: 1000, tax_rate: 10, total_with_tax: 1200 });
    expect(result.hasMismatch).toBe(true);
    expect(result.expected).toBe(1100);
  });

  it('returns no mismatch when values are consistent', () => {
    const result = computeAfterTaxMismatch({ subtotal: 1000, tax_rate: 10, total_with_tax: 1100 });
    expect(result.hasMismatch).toBe(false);
  });

  it('returns no mismatch when fields are null', () => {
    expect(computeAfterTaxMismatch({ subtotal: null, tax_rate: 10, total_with_tax: 1100 }).hasMismatch).toBe(false);
    expect(computeAfterTaxMismatch({ subtotal: 1000, tax_rate: null, total_with_tax: 1100 }).hasMismatch).toBe(false);
    expect(computeAfterTaxMismatch({ subtotal: 1000, tax_rate: 10, total_with_tax: null }).hasMismatch).toBe(false);
  });
});

describe('computeTaxRateMismatch', () => {
  it('detects decimal tax rate (0.08 should be 8)', () => {
    const result = computeTaxRateMismatch({ tax_rate: 0.08 });
    expect(result.hasMismatch).toBe(true);
    expect(result.expected).toBe(8);
  });

  it('detects decimal tax rate (0.1 should be 10)', () => {
    const result = computeTaxRateMismatch({ tax_rate: 0.1 });
    expect(result.hasMismatch).toBe(true);
    expect(result.expected).toBe(10);
  });

  it('does not flag correct percentage rate', () => {
    const result = computeTaxRateMismatch({ tax_rate: 8 });
    expect(result.hasMismatch).toBe(false);
    expect(result.expected).toBeNull();
  });

  it('does not flag 10%', () => {
    const result = computeTaxRateMismatch({ tax_rate: 10 });
    expect(result.hasMismatch).toBe(false);
  });

  it('does not flag 0% tax', () => {
    const result = computeTaxRateMismatch({ tax_rate: 0 });
    expect(result.hasMismatch).toBe(false);
  });

  it('does not flag null tax', () => {
    const result = computeTaxRateMismatch({ tax_rate: null });
    expect(result.hasMismatch).toBe(false);
  });
});

describe('getMismatchedLineItems', () => {
  const makeItem = (id: string, unit_price: number | null, quantity: number | null, subtotal: number | null): InvoiceLineItem => ({
    id,
    record_id: 'r1',
    line_number: 1,
    description: null,
    unit_price,
    quantity,
    tax_rate: null,
    subtotal,
    total_with_tax: null,
    deleted_at: null,
  });

  it('returns items where subtotal differs from unit_price * quantity', () => {
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
  const makeItem = (id: string, tax_rate: number | null): InvoiceLineItem => ({
    id,
    record_id: 'r1',
    line_number: 1,
    description: null,
    unit_price: 100,
    quantity: 1,
    tax_rate,
    subtotal: 100,
    total_with_tax: 100,
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

// === Tests for deriveFieldValue ===

const makeFullItem = (overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem => ({
  id: 'item1',
  record_id: 'r1',
  line_number: 1,
  description: null,
  unit_price: 100,
  quantity: 5,
  tax_rate: 10,
  subtotal: 500,
  total_with_tax: 550,
  deleted_at: null,
  ...overrides,
});

describe('deriveFieldValue', () => {
  it('derives quantity = subtotal / unit_price', () => {
    const item = makeFullItem({ unit_price: 200, quantity: 2, subtotal: 600 });
    // derived = 600/200 = 3, current = 2 → mismatch
    expect(deriveFieldValue('quantity', item)).toBe(3);
  });

  it('derives unit_price = subtotal / quantity', () => {
    const item = makeFullItem({ quantity: 4, unit_price: 100, subtotal: 800 });
    // derived = 800/4 = 200, current = 100 → mismatch
    expect(deriveFieldValue('unit_price', item)).toBe(200);
  });

  it('derives tax_rate from after/before tax ratio', () => {
    const item = makeFullItem({ subtotal: 1000, total_with_tax: 1100, tax_rate: 8 });
    // derived = (1100/1000 - 1) * 100 = 10, current = 8 → mismatch
    expect(deriveFieldValue('tax_rate', item)).toBe(10);
  });

  it('fixes decimal tax_rate (0.08 -> 8)', () => {
    const item = makeFullItem({ tax_rate: 0.08 });
    expect(deriveFieldValue('tax_rate', item)).toBe(8);
  });

  it('derives subtotal = quantity * unit_price', () => {
    const item = makeFullItem({ unit_price: 150, quantity: 4, subtotal: 500 });
    // derived = 150*4 = 600, current = 500 → mismatch
    expect(deriveFieldValue('subtotal', item)).toBe(600);
  });

  it('derives total_with_tax = subtotal * (1 + tax_rate/100)', () => {
    const item = makeFullItem({ subtotal: 1000, tax_rate: 10, total_with_tax: 1000 });
    // derived = 1000 * 1.1 = 1100, current = 1000 → mismatch
    expect(deriveFieldValue('total_with_tax', item)).toBe(1100);
  });

  it('returns null when value already matches derived', () => {
    const item = makeFullItem({ unit_price: 100, quantity: 5, subtotal: 500 });
    // derived = 100*5 = 500, current = 500 → no mismatch
    expect(deriveFieldValue('subtotal', item)).toBeNull();
  });

  it('returns null when inputs are missing for quantity', () => {
    const item = makeFullItem({ unit_price: null });
    expect(deriveFieldValue('quantity', item)).toBeNull();
  });

  it('returns null when inputs are missing for unit_price', () => {
    const item = makeFullItem({ quantity: null });
    expect(deriveFieldValue('unit_price', item)).toBeNull();
  });

  it('returns null for unknown field', () => {
    const item = makeFullItem();
    expect(deriveFieldValue('description', item)).toBeNull();
  });

  it('returns null when unit_price is 0 (division by zero)', () => {
    const item = makeFullItem({ unit_price: 0 });
    expect(deriveFieldValue('quantity', item)).toBeNull();
  });
});

