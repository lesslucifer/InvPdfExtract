import { describe, it, expect } from 'vitest';
import { filenameFilter } from './filename-filter';
import { DEFAULT_FILTER_CONFIG } from '../../shared/constants';

const cfg = DEFAULT_FILTER_CONFIG;

describe('filenameFilter', () => {
  it('returns process decision for invoice keyword in filename', () => {
    const result = filenameFilter('docs/invoice_2024_001.pdf', 5000, cfg);
    expect(result.decision).toBe('process');
    expect(result.score).toBeGreaterThan(cfg.processThreshold);
    expect(result.layer).toBe(1);
  });

  it('returns process decision for hoadon keyword in filename', () => {
    const result = filenameFilter('accounting/hoadon_GTGT_001.pdf', 5000, cfg);
    expect(result.decision).toBe('process');
  });

  it('boosts score when path contains accounting folder', () => {
    const result = filenameFilter('ketoan/document.xlsx', 5000, cfg);
    // Path match adds 0.3, which alone doesn't exceed processThreshold (0.6)
    expect(result.score).toBeGreaterThan(0);
    expect(result.reason).toContain('ketoan');
  });

  it('returns uncertain for generic filename with no signals', () => {
    const result = filenameFilter('photo.jpg', 5000, cfg);
    expect(result.decision).toBe('uncertain');
    expect(result.score).toBe(0);
  });

  it('applies size penalty when file is too small', () => {
    const result = filenameFilter('invoice_test.pdf', 100, cfg); // < 1024 bytes
    expect(result.reason).toContain('too small');
  });

  it('applies size penalty when file is too large', () => {
    const result = filenameFilter('big_file.pdf', 100_000_000, cfg); // > 50MB
    expect(result.reason).toContain('too large');
  });

  it('returns uncertain (not skip) for zero-signal files — Layer 1 never skips', () => {
    const result = filenameFilter('vacation_photo.jpg', 5000, cfg);
    expect(result.decision).toBe('uncertain');
    expect(result.decision).not.toBe('skip');
  });

  it('date pattern in filename boosts score', () => {
    const result = filenameFilter('docs/2024-03-15.pdf', 5000, cfg);
    // Date regex matches 20YY-MM-DD pattern
    expect(result.score).toBeGreaterThan(0);
  });

  it('custom path pattern is respected', () => {
    const customCfg = { ...cfg, customPathPatterns: ['my_custom_folder'] };
    const result = filenameFilter('my_custom_folder/document.pdf', 5000, customCfg);
    expect(result.score).toBeGreaterThan(0);
  });

  it('score is clamped to [0, 1]', () => {
    // Trigger all bonuses: path + filename pattern + keyword
    const result = filenameFilter('ketoan/inv_hoadon_2024-01-15.pdf', 5000, cfg);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
