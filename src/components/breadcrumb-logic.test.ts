import { describe, it, expect } from 'vitest';

/**
 * Tests for BreadcrumbBar logic — extracted as pure functions.
 */

// === Extracted from BreadcrumbBar.tsx ===

interface Segment {
  label: string;
  path: string;
}

function splitSegments(folder: string): Segment[] {
  const parts = folder.split('/').filter(Boolean);
  return parts.map((label, i) => ({
    label,
    path: parts.slice(0, i + 1).join('/'),
  }));
}

function extractFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

// === Tests ===

describe('BreadcrumbBar logic', () => {
  describe('splitSegments', () => {
    it('splits single segment', () => {
      const segments = splitSegments('2024');
      expect(segments).toEqual([
        { label: '2024', path: '2024' },
      ]);
    });

    it('splits two segments', () => {
      const segments = splitSegments('2024/Q1');
      expect(segments).toEqual([
        { label: '2024', path: '2024' },
        { label: 'Q1', path: '2024/Q1' },
      ]);
    });

    it('splits three segments', () => {
      const segments = splitSegments('2024/Q1/invoices');
      expect(segments).toEqual([
        { label: '2024', path: '2024' },
        { label: 'Q1', path: '2024/Q1' },
        { label: 'invoices', path: '2024/Q1/invoices' },
      ]);
    });

    it('handles trailing slash', () => {
      const segments = splitSegments('2024/Q1/');
      expect(segments).toEqual([
        { label: '2024', path: '2024' },
        { label: 'Q1', path: '2024/Q1' },
      ]);
    });

    it('handles empty string', () => {
      expect(splitSegments('')).toEqual([]);
    });
  });

  describe('extractFileName', () => {
    it('extracts filename from path', () => {
      expect(extractFileName('2024/Q1/invoice.pdf')).toBe('invoice.pdf');
    });

    it('handles file in root', () => {
      expect(extractFileName('invoice.pdf')).toBe('invoice.pdf');
    });

    it('handles deeply nested path', () => {
      expect(extractFileName('a/b/c/d/report.xlsx')).toBe('report.xlsx');
    });
  });
});
