import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../shared/format';

describe('formatCurrency (used by StickyFooter)', () => {
  it('formats zero as dash', () => {
    expect(formatCurrency(0)).toBe('-');
  });

  it('formats small amounts', () => {
    expect(formatCurrency(1000)).toBe('1.000');
  });

  it('formats millions', () => {
    expect(formatCurrency(5000000)).toBe('5.000.000');
  });

  it('formats large amounts', () => {
    expect(formatCurrency(128500000)).toBe('128.500.000');
  });

  it('formats with decimal-like amounts', () => {
    expect(formatCurrency(1234567)).toBe('1.234.567');
  });
});
