import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { openDatabase, closeDatabase, setActiveDatabase, getDatabase } from '../../core/db/database';
import { insertFile } from '../../core/db/files';
import { DocType, FileStatus, ExtractionResult } from '../../shared/types';
import { Reconciler } from '../../core/reconciler';
import { extractMetadata } from '../../core/parsers/spreadsheet-metadata';
import { executeScript } from '../../core/script-sandbox';
import { XLSX_FILES } from '../helpers/fixtures';

// Hand-written parser script for the known fixture format
const HOADON_SOLD_PARSER = `
const XLSX = require('xlsx');
const filePath = process.argv[2];
const wb = XLSX.readFile(filePath, { type: 'file' });

// Sheet 1: "Hóa đơn" — invoice headers
const invoiceSheet = wb.Sheets['Hóa đơn'];
const invoiceRows = XLSX.utils.sheet_to_json(invoiceSheet);

// Sheet 2: "Chi tiết hàng hóa" — line items
const lineItemSheet = wb.Sheets['Chi tiết hàng hóa'];
const lineItemRows = XLSX.utils.sheet_to_json(lineItemSheet);

const records = invoiceRows.map(row => {
  // Parse date from "DD/MM/YYYY HH:mm:ss" format
  const rawDate = String(row['Ngày lập'] || '');
  const dateParts = rawDate.split(' ')[0].split('/');
  const ngay = dateParts.length === 3
    ? dateParts[2] + '-' + dateParts[1] + '-' + dateParts[0]
    : null;

  const soHD = String(row['Số HĐ'] || '');
  const kyHieu = String(row['Ký hiệu HĐ'] || '');

  // Get line items for this invoice
  const items = lineItemRows
    .filter(li => String(li['Số HĐ']) === soHD && String(li['Ký hiệu HĐ']) === kyHieu)
    .map(li => ({
      mo_ta: li['Tên hàng hóa/dịch vụ'] || null,
      don_gia: typeof li['Đơn giá'] === 'number' ? li['Đơn giá'] : null,
      so_luong: typeof li['Số lượng'] === 'number' ? li['Số lượng'] : null,
      thue_suat: null,
      thanh_tien_truoc_thue: typeof li['Thành tiền (chưa thuế)'] === 'number' ? li['Thành tiền (chưa thuế)'] : null,
      thanh_tien: null,
    }));

  return {
    confidence: 1.0,
    field_confidence: {
      so_hoa_don: 1.0,
      ngay: 1.0,
      tong_tien: 1.0,
      mst: 1.0,
      ten_doi_tac: 1.0,
      dia_chi_doi_tac: 1.0,
    },
    ngay: ngay,
    data: {
      so_hoa_don: soHD,
      tong_tien: typeof row['Tổng tiền thanh toán'] === 'number' ? row['Tổng tiền thanh toán'] : 0,
      mst: String(row['MST người bán'] || ''),
      ten_doi_tac: String(row['Tên người bán'] || ''),
      dia_chi_doi_tac: String(row['Địa chỉ người bán'] || ''),
    },
    line_items: items,
  };
});

const result = {
  relative_path: filePath,
  doc_type: 'invoice_out',
  records: records,
};

console.log(JSON.stringify(result));
`;

describe('Integration: XLSX to Reconciler', () => {
  let tmpDir: string;
  let parserPath: string;

  beforeEach(() => {
    closeDatabase();
    const db = openDatabase(':memory:');
    setActiveDatabase(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-integ-'));
    parserPath = path.join(tmpDir, 'hoadon-sold-parser.js');
    fs.writeFileSync(parserPath, HOADON_SOLD_PARSER);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('end-to-end: extract metadata from XLSX file', () => {
    const metadata = extractMetadata(XLSX_FILES.hoadonSold);

    expect(metadata.sheets).toHaveLength(3);
    expect(metadata.sheets[0].name).toBe('Hóa đơn');
    expect(metadata.sheets[1].name).toBe('Chi tiết hàng hóa');
    expect(metadata.sheets[2].name).toBe('Chi tiết thuế suất');
    expect(metadata.totalRows).toBe(57);
    expect(metadata.fileType).toBe('xlsx');
  });

  it('end-to-end: execute parser script on XLSX and reconcile into database', async () => {
    const relativePath = 'xlsx/hoadon_sold_2026-03-22 (1).xlsx';
    const file = insertFile(relativePath, 'xlsxhash123', 'xlsx', 13302);
    expect(file.status).toBe(FileStatus.Pending);

    // Execute the hand-written parser script on the real XLSX file
    // modulePaths needed so the forked process can resolve require('xlsx') from project node_modules
    const projectRoot = path.resolve(__dirname, '../../..');
    const nodeModules = path.join(projectRoot, 'node_modules');
    const fileResult = await executeScript(parserPath, XLSX_FILES.hoadonSold, {
      timeoutMs: 10000,
      modulePaths: [nodeModules],
    });
    // Fix relative_path (script receives absolute path)
    fileResult.relative_path = relativePath;

    const extraction: ExtractionResult = { results: [fileResult] };

    // Reconcile
    const reconciler = new Reconciler(0.8);
    reconciler.reconcileResults(extraction, 'xlsx-test-session');

    // Verify extraction_batches
    const db = getDatabase();
    const batches = db.prepare('SELECT * FROM extraction_batches WHERE file_id = ?').all(file.id) as any[];
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe('success');
    expect(batches[0].record_count).toBe(1);

    // Verify records
    const records = db.prepare('SELECT * FROM records WHERE file_id = ? AND deleted_at IS NULL').all(file.id) as any[];
    expect(records).toHaveLength(1);
    expect(records[0].doc_type).toBe(DocType.InvoiceOut);
    expect(records[0].confidence).toBe(1.0);

    // Verify invoice_data
    const invoiceData = db.prepare('SELECT * FROM invoice_data WHERE record_id = ?').get(records[0].id) as any;
    expect(invoiceData).toBeTruthy();
    expect(invoiceData.so_hoa_don).toBe('8');
    expect(invoiceData.mst).toBe('0305008980');
    expect(invoiceData.ten_doi_tac).toBe('CÔNG TY TNHH GINKGO');

    // Verify invoice_line_items — should have 55 items from "Chi tiết hàng hóa" sheet
    const lineItems = db.prepare(
      'SELECT * FROM invoice_line_items WHERE record_id = ? ORDER BY line_number',
    ).all(records[0].id) as any[];
    expect(lineItems).toHaveLength(55);

    // Verify first line item
    expect(lineItems[0].mo_ta).toBe('Khăn Twilly hoạ tiết An Tư Công chúa - 6x130');
    expect(lineItems[0].so_luong).toBe(10);

    // Verify last line item
    expect(lineItems[54].mo_ta).toBe('Postcard');
    expect(lineItems[54].so_luong).toBe(60);

    // Verify file status updated to 'done'
    const updatedFile = db.prepare('SELECT * FROM files WHERE id = ?').get(file.id) as any;
    expect(updatedFile.status).toBe(FileStatus.Done);
  });

  it('end-to-end: metadata contains accurate column types for AI prompt', () => {
    const metadata = extractMetadata(XLSX_FILES.hoadonSold);

    // The invoice header sheet should have date-like and numeric columns
    const invoiceSheet = metadata.sheets[0];
    const ngayLap = invoiceSheet.columnTypes.find(c => c.header === 'Ngày lập');
    expect(ngayLap).toBeTruthy();
    // "21/03/2026 01:00:00" matches date pattern
    expect(ngayLap!.inferredType).toBe('date');

    const tongTien = invoiceSheet.columnTypes.find(c => c.header === 'Tổng tiền thanh toán');
    expect(tongTien).toBeTruthy();
    expect(tongTien!.inferredType).toBe('number');

    // Line item sheet should have numeric quantity column
    const lineItemSheet = metadata.sheets[1];
    const soLuong = lineItemSheet.columnTypes.find(c => c.header === 'Số lượng');
    expect(soLuong).toBeTruthy();
    expect(soLuong!.inferredType).toBe('number');
  });
});
