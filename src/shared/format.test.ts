import { describe, it, expect } from 'vitest';
import { formatCurrency } from './format';

describe('formatCurrency', () => {
  it('returns dash for zero', () => {
    expect(formatCurrency(0)).toBe('-');
  });

  it('returns dash for null-ish falsy values', () => {
    expect(formatCurrency(0)).toBe('-');
  });

  it('formats small amounts with vi-VN locale', () => {
    expect(formatCurrency(1000)).toBe('1.000');
  });

  it('formats millions', () => {
    expect(formatCurrency(5_000_000)).toBe('5.000.000');
  });

  it('formats large amounts', () => {
    expect(formatCurrency(128_500_000)).toBe('128.500.000');
  });

  it('formats non-round amounts', () => {
    expect(formatCurrency(1_234_567)).toBe('1.234.567');
  });

  describe('abbreviated mode', () => {
    const abbr = { abbreviated: true };

    it('formats thousands as k', () => {
      expect(formatCurrency(100_000, abbr)).toBe('100k');
      expect(formatCurrency(5_000, abbr)).toBe('5k');
    });

    it('formats millions as tr', () => {
      expect(formatCurrency(5_000_000, abbr)).toBe('5tr');
      expect(formatCurrency(100_000_000, abbr)).toBe('100tr');
    });

    it('formats billions as t', () => {
      expect(formatCurrency(1_000_000_000, abbr)).toBe('1t');
      expect(formatCurrency(100_000_000_000, abbr)).toBe('100t');
    });

    it('prefers largest clean suffix', () => {
      expect(formatCurrency(2_000_000_000, abbr)).toBe('2t');
      expect(formatCurrency(3_000_000, abbr)).toBe('3tr');
    });

    it('falls back to full format for non-round amounts', () => {
      expect(formatCurrency(1_234_567, abbr)).toBe('1.234.567');
    });

    it('returns dash for zero even in abbreviated mode', () => {
      expect(formatCurrency(0, abbr)).toBe('-');
    });
  });

  describe('negative amounts', () => {
    it('formats negative amounts', () => {
      const result = formatCurrency(-5_000_000);
      expect(result).toMatch(/-5[.,]000[.,]000/);
    });
  });
});
