import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';
import {
  ExtractionBatch, Record, BankStatementData, InvoiceData,
  InvoiceLineItem, BatchStatus, DocType, ProcessingLog, LogLevel,
} from '../../shared/types';

// === Extraction Batches ===

export function createBatch(fileId: string, status: BatchStatus, recordCount: number, confidence: number, sessionLog: string | null, scriptId: string | null): ExtractionBatch {
  const db = getDatabase();
  const id = uuid();
  db.prepare(`
    INSERT INTO extraction_batches (id, file_id, status, record_count, overall_confidence, claude_session_log, script_id, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, fileId, status, recordCount, confidence, sessionLog, scriptId);

  return db.prepare('SELECT * FROM extraction_batches WHERE id = ?').get(id) as ExtractionBatch;
}

// === Records ===

export function insertRecord(
  batchId: string, fileId: string, docType: DocType, fingerprint: string,
  confidence: number, ngay: string | null, fieldConfidence: object, rawExtraction: object
): Record {
  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence, ngay, field_confidence, raw_extraction, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, batchId, fileId, docType, fingerprint, confidence, ngay, JSON.stringify(fieldConfidence), JSON.stringify(rawExtraction), now, now);

  return db.prepare('SELECT * FROM records WHERE id = ?').get(id) as Record;
}

export function updateRecord(
  recordId: string, batchId: string, confidence: number, ngay: string | null,
  fieldConfidence: object, rawExtraction: object
): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE records SET batch_id = ?, confidence = ?, ngay = ?, field_confidence = ?, raw_extraction = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(batchId, confidence, ngay, JSON.stringify(fieldConfidence), JSON.stringify(rawExtraction), recordId);
}

export function getRecordsByFileId(fileId: string): Record[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM records WHERE file_id = ? AND deleted_at IS NULL').all(fileId) as Record[];
}

export function getRecordByFingerprint(fileId: string, fingerprint: string): Record | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM records WHERE file_id = ? AND fingerprint = ? AND deleted_at IS NULL').get(fileId, fingerprint) as Record | undefined;
}

export function softDeleteRecord(recordId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare('UPDATE records SET deleted_at = ? WHERE id = ?').run(now, recordId);
  db.prepare('UPDATE invoice_line_items SET deleted_at = ? WHERE record_id = ?').run(now, recordId);
}

// === Bank Statement Data ===

export function upsertBankStatementData(recordId: string, data: Partial<BankStatementData>): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO bank_statement_data (record_id, ten_ngan_hang, stk, mo_ta, so_tien, ten_doi_tac)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET
      ten_ngan_hang = excluded.ten_ngan_hang,
      stk = excluded.stk,
      mo_ta = excluded.mo_ta,
      so_tien = excluded.so_tien,
      ten_doi_tac = excluded.ten_doi_tac
  `).run(recordId, data.ten_ngan_hang ?? null, data.stk ?? null, data.mo_ta ?? null, data.so_tien ?? null, data.ten_doi_tac ?? null);
}

// === Invoice Data ===

export function upsertInvoiceData(recordId: string, data: Partial<InvoiceData>): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO invoice_data (record_id, so_hoa_don, tong_tien, mst, ten_doi_tac, dia_chi_doi_tac)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET
      so_hoa_don = excluded.so_hoa_don,
      tong_tien = excluded.tong_tien,
      mst = excluded.mst,
      ten_doi_tac = excluded.ten_doi_tac,
      dia_chi_doi_tac = excluded.dia_chi_doi_tac
  `).run(recordId, data.so_hoa_don ?? null, data.tong_tien ?? null, data.mst ?? null, data.ten_doi_tac ?? null, data.dia_chi_doi_tac ?? null);
}

// === Invoice Line Items ===

export function insertLineItem(recordId: string, lineNumber: number, data: Partial<InvoiceLineItem>): InvoiceLineItem {
  const db = getDatabase();
  const id = uuid();
  db.prepare(`
    INSERT INTO invoice_line_items (id, record_id, line_number, mo_ta, don_gia, so_luong, thue_suat, thanh_tien)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, recordId, lineNumber, data.mo_ta ?? null, data.don_gia ?? null, data.so_luong ?? null, data.thue_suat ?? null, data.thanh_tien ?? null);

  return db.prepare('SELECT * FROM invoice_line_items WHERE id = ?').get(id) as InvoiceLineItem;
}

export function deleteLineItemsByRecord(recordId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM invoice_line_items WHERE record_id = ?').run(recordId);
}

export function getLineItemsByRecord(recordId: string): InvoiceLineItem[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM invoice_line_items WHERE record_id = ? AND deleted_at IS NULL ORDER BY line_number').all(recordId) as InvoiceLineItem[];
}

// === FTS Index ===

export function updateFtsIndex(recordId: string, data: {
  so_hoa_don?: string; mst?: string; ten_doi_tac?: string; dia_chi_doi_tac?: string;
  mo_ta?: string; ten_ngan_hang?: string; stk?: string;
}): void {
  const db = getDatabase();
  // Delete old entry if exists
  db.prepare('DELETE FROM records_fts WHERE rowid = (SELECT rowid FROM records_fts WHERE so_hoa_don = ? OR mst = ? LIMIT 1)').run(data.so_hoa_don ?? '', data.mst ?? '');
  // Insert new
  db.prepare(`
    INSERT INTO records_fts (rowid, so_hoa_don, mst, ten_doi_tac, dia_chi_doi_tac, mo_ta, ten_ngan_hang, stk)
    VALUES ((SELECT rowid FROM records WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)
  `).run(recordId, data.so_hoa_don ?? '', data.mst ?? '', data.ten_doi_tac ?? '', data.dia_chi_doi_tac ?? '', data.mo_ta ?? '', data.ten_ngan_hang ?? '', data.stk ?? '');
}

// === Processing Logs ===

export function addLog(batchId: string | null, level: LogLevel, message: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO processing_logs (id, batch_id, level, message, timestamp)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(uuid(), batchId, level, message);
}

export function getRecentLogs(limit: number = 50): ProcessingLog[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM processing_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as ProcessingLog[];
}

// === Search ===

export function searchRecords(query: string, limit: number = 50): any[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT r.*, f.relative_path,
      COALESCE(id2.so_hoa_don, '') as so_hoa_don,
      COALESCE(id2.tong_tien, 0) as tong_tien,
      COALESCE(id2.mst, '') as mst,
      COALESCE(id2.ten_doi_tac, bsd.ten_doi_tac, '') as ten_doi_tac,
      COALESCE(bsd.stk, '') as stk,
      COALESCE(bsd.so_tien, 0) as so_tien
    FROM records r
    JOIN files f ON r.file_id = f.id
    LEFT JOIN invoice_data id2 ON r.id = id2.record_id
    LEFT JOIN bank_statement_data bsd ON r.id = bsd.record_id
    WHERE r.deleted_at IS NULL
      AND (
        r.id IN (SELECT rowid FROM records_fts WHERE records_fts MATCH ?)
        OR id2.so_hoa_don LIKE ?
        OR id2.mst LIKE ?
        OR id2.ten_doi_tac LIKE ?
        OR bsd.ten_doi_tac LIKE ?
        OR bsd.stk LIKE ?
      )
    ORDER BY r.updated_at DESC
    LIMIT ?
  `).all(query + '*', `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, limit);
}
