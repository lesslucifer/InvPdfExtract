import { describe, it, expect } from 'vitest';

/**
 * Tests for ResultRow path logic — extracted as pure functions.
 */

// === Extracted from ResultRow.tsx ===

function middleEllipsis(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const dotIdx = text.lastIndexOf('.');
  if (dotIdx > 0 && text.length - dotIdx <= 6) {
    const ext = text.slice(dotIdx);
    const nameMax = maxLen - ext.length - 3;
    if (nameMax < 4) return text.slice(0, maxLen - 3) + '...';
    return text.slice(0, nameMax) + '...' + ext;
  }
  const half = Math.floor((maxLen - 3) / 2);
  return text.slice(0, half) + '...' + text.slice(text.length - half);
}

function splitPath(relativePath: string): { folder: string; folderFull: string; filename: string } {
  const parts = relativePath.split('/');
  const filename = parts.pop() || '';
  const folderFull = parts.join('/');
  const folder = parts.length > 0 ? parts[parts.length - 1] : '';
  return { folder, folderFull, filename };
}

// === Tests ===

describe('ResultRow path logic', () => {
  describe('splitPath', () => {
    it('returns parent folder and filename for nested path', () => {
      const { folder, folderFull, filename } = splitPath('2024/Q1/scan.pdf');
      expect(filename).toBe('scan.pdf');
      expect(folder).toBe('Q1');
      expect(folderFull).toBe('2024/Q1');
    });

    it('returns parent folder for single-level path', () => {
      const { folder, folderFull, filename } = splitPath('invoices/doc.pdf');
      expect(filename).toBe('doc.pdf');
      expect(folder).toBe('invoices');
      expect(folderFull).toBe('invoices');
    });

    it('handles file in root (no folders)', () => {
      const { folder, folderFull, filename } = splitPath('scan.pdf');
      expect(filename).toBe('scan.pdf');
      expect(folder).toBe('');
      expect(folderFull).toBe('');
    });

    it('returns only immediate parent for deeply nested path', () => {
      const { folder, folderFull, filename } = splitPath('2024/Q1/invoices/vendor/doc.pdf');
      expect(filename).toBe('doc.pdf');
      expect(folder).toBe('vendor');
      expect(folderFull).toBe('2024/Q1/invoices/vendor');
    });
  });

  describe('middleEllipsis', () => {
    it('returns text unchanged when within limit', () => {
      expect(middleEllipsis('short.pdf', 20)).toBe('short.pdf');
    });

    it('truncates long folder name preserving start and end', () => {
      const long = 'verylongverylongverylongverylongpath';
      const result = middleEllipsis(long, 20);
      expect(result.length).toBeLessThanOrEqual(20);
      expect(result).toContain('...');
      expect(result.startsWith('verylong')).toBe(true);
      expect(result.endsWith('longpath')).toBe(true);
    });

    it('preserves file extension for long filenames', () => {
      const long = 'filenameisverylongcrazilylonginsanelylongfilename.xml';
      const result = middleEllipsis(long, 30);
      expect(result.length).toBeLessThanOrEqual(30);
      expect(result).toContain('...');
      expect(result.endsWith('.xml')).toBe(true);
    });

    it('handles exact max length', () => {
      const text = 'exactlength';
      expect(middleEllipsis(text, text.length)).toBe(text);
    });

    it('handles very short max length gracefully', () => {
      const result = middleEllipsis('longfilename.pdf', 8);
      expect(result.length).toBeLessThanOrEqual(8);
      expect(result).toContain('...');
    });
  });
});
