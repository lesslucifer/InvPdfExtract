import { describe, it, expect } from 'vitest';
import { formatVND } from './StickyFooter';

describe('formatVND', () => {
  it('formats zero', () => {
    expect(formatVND(0)).toBe('0');
  });

  it('formats small amounts', () => {
    expect(formatVND(1000)).toBe('1.000');
  });

  it('formats millions', () => {
    expect(formatVND(5000000)).toBe('5.000.000');
  });

  it('formats large amounts', () => {
    expect(formatVND(128500000)).toBe('128.500.000');
  });

  it('formats with decimal-like amounts', () => {
    expect(formatVND(1234567)).toBe('1.234.567');
  });
});
