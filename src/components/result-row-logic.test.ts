import { describe, it, expect } from 'vitest';

/**
 * Tests for ResultRow clickable path logic — extracted as pure functions.
 */

// === Extracted from ResultRow.tsx ===

interface PathSegment {
  label: string;
  folder: string;
}

function splitPath(relativePath: string): { segments: PathSegment[]; filename: string } {
  const parts = relativePath.split('/');
  const filename = parts.pop() || '';
  const segments: PathSegment[] = parts.map((label, i) => ({
    label,
    folder: parts.slice(0, i + 1).join('/'),
  }));
  return { segments, filename };
}

// === Tests ===

describe('ResultRow path splitting', () => {
  describe('splitPath', () => {
    it('splits path with two folder segments', () => {
      const { segments, filename } = splitPath('2024/Q1/scan.pdf');
      expect(filename).toBe('scan.pdf');
      expect(segments).toEqual([
        { label: '2024', folder: '2024' },
        { label: 'Q1', folder: '2024/Q1' },
      ]);
    });

    it('splits path with single folder', () => {
      const { segments, filename } = splitPath('invoices/doc.pdf');
      expect(filename).toBe('doc.pdf');
      expect(segments).toEqual([
        { label: 'invoices', folder: 'invoices' },
      ]);
    });

    it('handles file in root (no folders)', () => {
      const { segments, filename } = splitPath('scan.pdf');
      expect(filename).toBe('scan.pdf');
      expect(segments).toEqual([]);
    });

    it('splits deeply nested path', () => {
      const { segments, filename } = splitPath('2024/Q1/invoices/vendor/doc.pdf');
      expect(filename).toBe('doc.pdf');
      expect(segments).toHaveLength(4);
      expect(segments[0]).toEqual({ label: '2024', folder: '2024' });
      expect(segments[1]).toEqual({ label: 'Q1', folder: '2024/Q1' });
      expect(segments[2]).toEqual({ label: 'invoices', folder: '2024/Q1/invoices' });
      expect(segments[3]).toEqual({ label: 'vendor', folder: '2024/Q1/invoices/vendor' });
    });

    it('clicking segment 1 of "2024/Q1/scan.pdf" gives folder "2024"', () => {
      const { segments } = splitPath('2024/Q1/scan.pdf');
      expect(segments[0].folder).toBe('2024');
    });

    it('clicking segment 2 of "2024/Q1/scan.pdf" gives folder "2024/Q1"', () => {
      const { segments } = splitPath('2024/Q1/scan.pdf');
      expect(segments[1].folder).toBe('2024/Q1');
    });
  });
});
