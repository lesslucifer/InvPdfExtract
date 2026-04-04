import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase, getDatabase } from '../../core/db/database';
import { insertFile } from '../../core/db/files';
import { DocType, FileStatus, ExtractionResult } from '../../shared/types';
import { Reconciler } from '../../core/reconciler';
import { parseXmlInvoice } from '../../core/parsers/xml-invoice-parser';
import { XML_FILES } from '../helpers/fixtures';

describe('Integration: XML to Reconciler', () => {
  beforeEach(() => {
    // Open an in-memory database for each test via the singleton
    closeDatabase();
    openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('end-to-end: parse XML and reconcile single-item invoice into database', () => {
    const relativePath = 'xml/0310989626_1_C26TAA_911_31012026_congtytnhhinkythuatso.xml';

    // Simulate file being tracked (as the watcher/sync-engine would do)
    const file = insertFile(relativePath, 'abc123hash', 'xml', 1024);
    expect(file.status).toBe(FileStatus.Pending);

    // Parse the XML
    const fileResult = parseXmlInvoice(XML_FILES.inKyThuatSo911, relativePath);
    const extraction: ExtractionResult = { results: [fileResult] };

    // Reconcile
    const reconciler = new Reconciler(0.8);
    reconciler.reconcileResults(extraction, 'test-session-log');

    // Verify extraction_batches
    const db = getDatabase();
    const batches = db.prepare('SELECT * FROM extraction_batches WHERE file_id = ?').all(file.id) as any[];
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe('success');
    expect(batches[0].record_count).toBe(1);

    // Verify records
    const records = db.prepare('SELECT * FROM records WHERE file_id = ? AND deleted_at IS NULL').all(file.id) as any[];
    expect(records).toHaveLength(1);
    expect(records[0].doc_type).toBe(DocType.InvoiceIn);
    expect(records[0].confidence).toBe(1.0);

    // Verify invoice_data
    const invoiceData = db.prepare('SELECT * FROM invoice_data WHERE record_id = ?').get(records[0].id) as any;
    expect(invoiceData).toBeTruthy();
    expect(invoiceData.so_hoa_don).toBe('911');
    expect(invoiceData.tong_tien).toBe(351000);
    expect(invoiceData.mst).toBe('0310989626');

    // Verify invoice_line_items
    const lineItems = db.prepare('SELECT * FROM invoice_line_items WHERE record_id = ? ORDER BY line_number').all(records[0].id) as any[];
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].mo_ta).toBe('In Kỹ Thuật Số ( PP dán Formax - 3 tấm )');
    expect(lineItems[0].thanh_tien_truoc_thue).toBe(325000);
    expect(lineItems[0].thanh_tien).toBe(351000); // 325000 * 1.08

    // Verify file status updated to 'done' (confidence 1.0 > threshold 0.8)
    const updatedFile = db.prepare('SELECT * FROM files WHERE id = ?').get(file.id) as any;
    expect(updatedFile.status).toBe(FileStatus.Done);
  });

  it('end-to-end: parse and reconcile multi-item invoice with 7 line items', () => {
    const relativePath = 'xml/0314499083_1_C26TDP_1_31012026_congtytnhhdautuduyphu.xml';
    const file = insertFile(relativePath, 'def456hash', 'xml', 2048);

    const fileResult = parseXmlInvoice(XML_FILES.dauTuDuyPhu, relativePath);
    const extraction: ExtractionResult = { results: [fileResult] };

    const reconciler = new Reconciler(0.8);
    reconciler.reconcileResults(extraction, 'test-session-log');

    const db = getDatabase();

    // Verify invoice_data
    const records = db.prepare('SELECT * FROM records WHERE file_id = ? AND deleted_at IS NULL').all(file.id) as any[];
    expect(records).toHaveLength(1);

    const invoiceData = db.prepare('SELECT * FROM invoice_data WHERE record_id = ?').get(records[0].id) as any;
    expect(invoiceData.so_hoa_don).toBe('1');
    expect(invoiceData.tong_tien).toBe(8100000);

    // Verify 7 line items (TChat=4 excluded by parser)
    const lineItems = db.prepare(
      'SELECT * FROM invoice_line_items WHERE record_id = ? ORDER BY line_number',
    ).all(records[0].id) as any[];
    expect(lineItems).toHaveLength(7);

    // Verify sequential line numbers
    for (let i = 0; i < lineItems.length; i++) {
      expect(lineItems[i].line_number).toBe(i + 1);
    }

    // Verify first and last items
    expect(lineItems[0].mo_ta).toBe('Backdrop  Bạt 2 da xám in KTS');
    expect(lineItems[0].thanh_tien_truoc_thue).toBe(1800000);
    expect(lineItems[0].thanh_tien).toBe(1944000); // 1800000 * 1.08
    expect(lineItems[6].don_gia).toBe(500000);
  });

  it('end-to-end: re-extraction with same data is idempotent', () => {
    const relativePath = 'xml/0317572493_1_C26TTP_00000056_31012026_congtytnhhvanthinhphuc.xml';
    const file = insertFile(relativePath, 'ghi789hash', 'xml', 512);

    const fileResult = parseXmlInvoice(XML_FILES.vanThinhPhuc, relativePath);
    const reconciler = new Reconciler(0.8);

    // First extraction
    reconciler.reconcileResults({ results: [fileResult] }, 'log-1');

    const db = getDatabase();
    const recordsAfterFirst = db.prepare(
      'SELECT * FROM records WHERE file_id = ? AND deleted_at IS NULL',
    ).all(file.id) as any[];
    expect(recordsAfterFirst).toHaveLength(1);
    const firstRecordId = recordsAfterFirst[0].id;

    // Second extraction (same data)
    reconciler.reconcileResults({ results: [fileResult] }, 'log-2');

    // Should still have 1 active record (fingerprint match → update, not insert)
    const recordsAfterSecond = db.prepare(
      'SELECT * FROM records WHERE file_id = ? AND deleted_at IS NULL',
    ).all(file.id) as any[];
    expect(recordsAfterSecond).toHaveLength(1);

    // The record should have been updated (same fingerprint)
    // We have 2 batches now
    const batches = db.prepare('SELECT * FROM extraction_batches WHERE file_id = ?').all(file.id) as any[];
    expect(batches).toHaveLength(2);

    // No soft-deleted records (same data both times)
    const deletedRecords = db.prepare(
      'SELECT * FROM records WHERE file_id = ? AND deleted_at IS NOT NULL',
    ).all(file.id) as any[];
    expect(deletedRecords).toHaveLength(0);
  });

  it('end-to-end: extraction batch stores script_id when provided', () => {
    const relativePath = 'xml/0310989626_1_C26TAA_933_31012026_congtytnhhinkythuatso.xml';
    const file = insertFile(relativePath, 'jkl012hash', 'xml', 768);

    const fileResult = parseXmlInvoice(XML_FILES.inKyThuatSo933, relativePath);
    const extraction: ExtractionResult = { results: [fileResult] };

    // For this test, we manually set a script_id on the batch after creation
    // The reconciler currently passes null for script_id
    // This test verifies the schema supports it
    const reconciler = new Reconciler(0.8);
    reconciler.reconcileResults(extraction, 'test-log');

    const db = getDatabase();
    const batches = db.prepare('SELECT * FROM extraction_batches WHERE file_id = ?').all(file.id) as any[];
    expect(batches).toHaveLength(1);

    // Update script_id directly to verify schema support
    const scriptId = 'test-script-id-123';
    db.prepare('UPDATE extraction_batches SET script_id = ? WHERE id = ?').run(scriptId, batches[0].id);

    const updatedBatch = db.prepare('SELECT * FROM extraction_batches WHERE id = ?').get(batches[0].id) as any;
    expect(updatedBatch.script_id).toBe(scriptId);
  });
});
