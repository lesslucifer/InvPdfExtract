import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractMetadata } from './spreadsheet-metadata';
import { XLSX_FILES } from '../../__tests__/helpers/fixtures';
import { METADATA_SAMPLE_ROWS } from '../../shared/constants';

describe('SpreadsheetMetadataExtractor', () => {
  // ── XLSX extraction ──

  describe('XLSX extraction', () => {
    it('extracts correct number of sheets from multi-sheet XLSX', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      expect(meta.sheets).toHaveLength(3);
    });

    it('extracts sheet names in order', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      expect(meta.sheets.map(s => s.name)).toEqual([
        'Hóa đơn',
        'Chi tiết hàng hóa',
        'Chi tiết thuế suất',
      ]);
    });

    it('extracts headers from first row of each sheet', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);

      // "Hóa đơn" sheet — all 25 columns preserved with defval
      const invoiceSheet = meta.sheets[0];
      expect(invoiceSheet.headers.length).toBe(25);
      expect(invoiceSheet.headers).toContain('STT');
      expect(invoiceSheet.headers).toContain('Ngày lập');
      expect(invoiceSheet.headers).toContain('MST người bán');
      expect(invoiceSheet.headers).toContain('Tổng tiền thanh toán');

      // "Chi tiết hàng hóa" sheet — all 20 columns preserved
      const lineItemSheet = meta.sheets[1];
      expect(lineItemSheet.headers.length).toBe(20);
      expect(lineItemSheet.headers).toContain('Tên hàng hóa/dịch vụ');
      expect(lineItemSheet.headers).toContain('Đơn giá');
      expect(lineItemSheet.headers).toContain('Số lượng');
    });

    it('extracts correct row counts per sheet (excluding header)', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      // "Hóa đơn": 1 data row, "Chi tiết hàng hóa": 55 data rows, "Chi tiết thuế suất": 1 data row
      expect(meta.sheets[0].rowCount).toBe(1);
      expect(meta.sheets[1].rowCount).toBe(55);
      expect(meta.sheets[2].rowCount).toBe(1);
    });

    it('extracts column count matching header count', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      for (const sheet of meta.sheets) {
        expect(sheet.colCount).toBe(sheet.headers.length);
      }
    });

    it('extracts sample rows up to METADATA_SAMPLE_ROWS', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);

      // "Hóa đơn" has only 1 data row
      expect(meta.sheets[0].sampleRows.length).toBe(1);
      expect(meta.sheets[0].sampleRows.length).toBeLessThanOrEqual(METADATA_SAMPLE_ROWS);

      // "Chi tiết hàng hóa" has 55 data rows, sample should be capped
      expect(meta.sheets[1].sampleRows.length).toBe(METADATA_SAMPLE_ROWS);

      // "Chi tiết thuế suất" has 1 data row
      expect(meta.sheets[2].sampleRows.length).toBe(1);
    });

    it('sample rows have keys matching headers', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      for (const sheet of meta.sheets) {
        for (const row of sheet.sampleRows) {
          const keys = Object.keys(row);
          for (const key of keys) {
            expect(sheet.headers).toContain(key);
          }
        }
      }
    });

    it('infers column types correctly', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      const lineItemSheet = meta.sheets[1];

      // "Số lượng" should be inferred as number
      const soLuong = lineItemSheet.columnTypes.find(c => c.header === 'Số lượng');
      expect(soLuong).toBeTruthy();
      expect(soLuong!.inferredType).toBe('number');

      // "Tên hàng hóa/dịch vụ" should be inferred as string
      const tenHang = lineItemSheet.columnTypes.find(c => c.header === 'Tên hàng hóa/dịch vụ');
      expect(tenHang).toBeTruthy();
      expect(tenHang!.inferredType).toBe('string');
    });

    it('computes emptyRate of 0 for columns with no gaps', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      const lineItemSheet = meta.sheets[1];

      // "Tên hàng hóa/dịch vụ" has a value in every row
      const tenHang = lineItemSheet.columnTypes.find(c => c.header === 'Tên hàng hóa/dịch vụ');
      expect(tenHang).toBeTruthy();
      expect(tenHang!.emptyRate).toBe(0);
    });

    it('reports totalRows as sum across sheets', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      expect(meta.totalRows).toBe(1 + 55 + 1);
    });

    it('sets fileType to xlsx', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      expect(meta.fileType).toBe('xlsx');
    });

    it('sets fileName from file path', () => {
      const meta = extractMetadata(XLSX_FILES.hoadonSold);
      expect(meta.fileName).toBe('hoadon_sold_2026-03-22.xlsx');
    });
  });

  // ── CSV extraction ──

  describe('CSV extraction', () => {
    const tempFiles: string[] = [];

    function createTempCsv(content: string, name?: string): string {
      const tmpFile = path.join(os.tmpdir(), name || `test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
      fs.writeFileSync(tmpFile, content);
      tempFiles.push(tmpFile);
      return tmpFile;
    }

    afterEach(() => {
      for (const f of tempFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
      tempFiles.length = 0;
    });

    it('extracts single-sheet metadata from CSV', () => {
      const csv = createTempCsv('Name,Amount,Date\nAlice,100,2026-01-01\nBob,200,2026-01-02\n');
      const meta = extractMetadata(csv);
      expect(meta.sheets).toHaveLength(1);
      expect(meta.fileType).toBe('csv');
    });

    it('detects headers from first row', () => {
      const csv = createTempCsv('Name,Amount,Date\nAlice,100,2026-01-01\n');
      const meta = extractMetadata(csv);
      expect(meta.sheets[0].headers).toEqual(['Name', 'Amount', 'Date']);
    });

    it('infers numeric columns correctly', () => {
      const csv = createTempCsv('Name,Amount,Count\nAlice,100,5\nBob,200,10\nCharlie,300,15\n');
      const meta = extractMetadata(csv);
      const amount = meta.sheets[0].columnTypes.find(c => c.header === 'Amount');
      expect(amount).toBeTruthy();
      expect(amount!.inferredType).toBe('number');
    });

    it('extracts correct row count excluding header', () => {
      const csv = createTempCsv('A,B\n1,2\n3,4\n5,6\n');
      const meta = extractMetadata(csv);
      expect(meta.sheets[0].rowCount).toBe(3);
      expect(meta.totalRows).toBe(3);
    });
  });

  // ── Edge cases ──

  describe('Edge cases', () => {
    const tempFiles: string[] = [];

    afterEach(() => {
      for (const f of tempFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
      tempFiles.length = 0;
    });

    it('throws for non-existent file', () => {
      expect(() => extractMetadata('/no/such/file.xlsx')).toThrow();
    });

    it('handles CSV with partial empty values', () => {
      const tmpFile = path.join(os.tmpdir(), `test-empty-${Date.now()}.csv`);
      // B has values in row 1 and 3 but not row 2
      fs.writeFileSync(tmpFile, 'A,B,C\n1,x,3\n2,,6\n4,y,9\n');
      tempFiles.push(tmpFile);

      const meta = extractMetadata(tmpFile);
      const colB = meta.sheets[0].columnTypes.find(c => c.header === 'B');
      expect(colB).toBeTruthy();
      expect(colB!.emptyRate).toBeGreaterThan(0);
    });
  });
});
