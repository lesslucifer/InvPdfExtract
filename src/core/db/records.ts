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

// === Field Overrides ===

export function getFieldOverrides(recordId: string): any[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM field_overrides WHERE record_id = ? AND resolved_at IS NULL'
  ).all(recordId) as any[];
}

export function getFieldOverrideByField(recordId: string, tableName: string, fieldName: string): any | undefined {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM field_overrides WHERE record_id = ? AND table_name = ? AND field_name = ? AND resolved_at IS NULL'
  ).get(recordId, tableName, fieldName) as any | undefined;
}

export function upsertFieldOverride(
  recordId: string, tableName: string, fieldName: string,
  userValue: string, aiValueAtLock: string
): void {
  const db = getDatabase();
  const existing = getFieldOverrideByField(recordId, tableName, fieldName);

  if (existing) {
    db.prepare(`
      UPDATE field_overrides
      SET user_value = ?, ai_value_at_lock = ?, status = 'locked', locked_at = datetime('now'), conflict_at = NULL, ai_value_latest = NULL
      WHERE id = ?
    `).run(userValue, aiValueAtLock, existing.id);
  } else {
    const id = uuid();
    db.prepare(`
      INSERT INTO field_overrides (id, record_id, table_name, field_name, user_value, ai_value_at_lock, status, locked_at)
      VALUES (?, ?, ?, ?, ?, ?, 'locked', datetime('now'))
    `).run(id, recordId, tableName, fieldName, userValue, aiValueAtLock);
  }
}

export function setFieldConflict(recordId: string, tableName: string, fieldName: string, aiValueLatest: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE field_overrides
    SET ai_value_latest = ?, status = 'conflict', conflict_at = datetime('now')
    WHERE record_id = ? AND table_name = ? AND field_name = ? AND resolved_at IS NULL
  `).run(aiValueLatest, recordId, tableName, fieldName);
}

export function resolveConflictKeep(recordId: string, fieldName: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE field_overrides
    SET status = 'locked', ai_value_latest = NULL, conflict_at = NULL
    WHERE record_id = ? AND field_name = ? AND resolved_at IS NULL
  `).run(recordId, fieldName);
}

export function resolveConflictAccept(recordId: string, fieldName: string): void {
  const db = getDatabase();
  const override = db.prepare(
    'SELECT * FROM field_overrides WHERE record_id = ? AND field_name = ? AND resolved_at IS NULL'
  ).get(recordId, fieldName) as any;

  if (!override) return;

  // Mark as resolved
  db.prepare(`
    UPDATE field_overrides
    SET status = 'locked', resolved_at = datetime('now')
    WHERE id = ?
  `).run(override.id);

  // Update the actual field value in the extension table with the AI value
  if (override.ai_value_latest !== null) {
    const tableName = override.table_name;
    const aiValue = override.ai_value_latest;

    // Determine if the value is numeric
    const numValue = parseFloat(aiValue);
    const isNumeric = !isNaN(numValue) && isFinite(numValue);
    const finalValue = isNumeric ? numValue : aiValue;

    db.prepare(`UPDATE ${tableName} SET ${fieldName} = ? WHERE record_id = ?`).run(finalValue, recordId);
  }
}

export function resolveAllConflictsForRecord(recordId: string, action: 'keep' | 'accept'): void {
  const db = getDatabase();
  const conflicts = db.prepare(
    "SELECT * FROM field_overrides WHERE record_id = ? AND status = 'conflict' AND resolved_at IS NULL"
  ).all(recordId) as any[];

  for (const override of conflicts) {
    if (action === 'keep') {
      resolveConflictKeep(recordId, override.field_name);
    } else {
      resolveConflictAccept(recordId, override.field_name);
    }
  }
}

export function getLockedFieldsForRecord(recordId: string): Map<string, { tableName: string; userValue: string; aiValueAtLock: string }> {
  const db = getDatabase();
  const overrides = db.prepare(
    "SELECT * FROM field_overrides WHERE record_id = ? AND resolved_at IS NULL AND status IN ('locked', 'conflict')"
  ).all(recordId) as any[];

  const map = new Map<string, { tableName: string; userValue: string; aiValueAtLock: string }>();
  for (const o of overrides) {
    map.set(o.field_name, { tableName: o.table_name, userValue: o.user_value, aiValueAtLock: o.ai_value_at_lock });
  }
  return map;
}

// === Search ===

interface ParsedQuery {
  text: string;
  docType?: string;
  status?: string;
  folder?: string;
  amountMin?: number;
  amountMax?: number;
  dateFilter?: string;
}

function parseSearchQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = { text: '' };
  const tokens: string[] = [];

  const parts = raw.split(/\s+/);
  for (const part of parts) {
    const lower = part.toLowerCase();

    // type: filter
    if (lower.startsWith('type:')) {
      const val = lower.slice(5);
      if (val === 'bank' || val === 'saoke') result.docType = 'bank_statement';
      else if (val === 'hdra' || val === 'out') result.docType = 'invoice_out';
      else if (val === 'hdv' || val === 'in') result.docType = 'invoice_in';
      continue;
    }

    // status: filter
    if (lower.startsWith('status:')) {
      result.status = lower.slice(7);
      continue;
    }

    // in: folder filter
    if (lower.startsWith('in:')) {
      result.folder = part.slice(3);
      continue;
    }

    // Amount range: >N, <N, N-M, Ntr-Mtr
    const trMatch = lower.match(/^(\d+)tr-(\d+)tr$/);
    if (trMatch) {
      result.amountMin = parseInt(trMatch[1]) * 1_000_000;
      result.amountMax = parseInt(trMatch[2]) * 1_000_000;
      continue;
    }
    if (lower.startsWith('>') && !isNaN(Number(lower.slice(1)))) {
      result.amountMin = Number(lower.slice(1));
      continue;
    }
    if (lower.startsWith('<') && !isNaN(Number(lower.slice(1)))) {
      result.amountMax = Number(lower.slice(1));
      continue;
    }

    // Date filter: YYYY-MM or YYYY-MM-DD
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(part)) {
      result.dateFilter = part;
      continue;
    }

    tokens.push(part);
  }

  result.text = tokens.join(' ');
  return result;
}

export function searchRecords(query: string, limit: number = 50): any[] {
  const db = getDatabase();
  const parsed = parseSearchQuery(query);

  const conditions: string[] = ['r.deleted_at IS NULL'];
  const params: any[] = [];

  // Text search
  if (parsed.text.trim()) {
    const q = parsed.text.trim();
    conditions.push(`(
      r.id IN (SELECT rowid FROM records_fts WHERE records_fts MATCH ?)
      OR id2.so_hoa_don LIKE ?
      OR id2.mst LIKE ?
      OR id2.ten_doi_tac LIKE ?
      OR bsd.ten_doi_tac LIKE ?
      OR bsd.stk LIKE ?
    )`);
    params.push(q + '*', `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  // Doc type filter
  if (parsed.docType) {
    conditions.push('r.doc_type = ?');
    params.push(parsed.docType);
  }

  // Status filter
  if (parsed.status === 'conflict') {
    conditions.push("r.id IN (SELECT record_id FROM field_overrides WHERE status = 'conflict' AND resolved_at IS NULL)");
  } else if (parsed.status === 'review') {
    conditions.push("f.status = 'review'");
  }

  // Folder filter
  if (parsed.folder) {
    conditions.push('f.relative_path LIKE ?');
    params.push(`${parsed.folder}%`);
  }

  // Amount range
  if (parsed.amountMin != null || parsed.amountMax != null) {
    if (parsed.amountMin != null && parsed.amountMax != null) {
      conditions.push('(COALESCE(id2.tong_tien, bsd.so_tien, 0) BETWEEN ? AND ?)');
      params.push(parsed.amountMin, parsed.amountMax);
    } else if (parsed.amountMin != null) {
      conditions.push('COALESCE(id2.tong_tien, bsd.so_tien, 0) > ?');
      params.push(parsed.amountMin);
    } else {
      conditions.push('COALESCE(id2.tong_tien, bsd.so_tien, 0) < ?');
      params.push(parsed.amountMax!);
    }
  }

  // Date filter
  if (parsed.dateFilter) {
    conditions.push('r.ngay LIKE ?');
    params.push(`${parsed.dateFilter}%`);
  }

  params.push(limit);

  const sql = `
    SELECT r.*, f.relative_path,
      COALESCE(id2.so_hoa_don, '') as so_hoa_don,
      COALESCE(id2.tong_tien, 0) as tong_tien,
      COALESCE(id2.mst, '') as mst,
      COALESCE(id2.ten_doi_tac, bsd.ten_doi_tac, '') as ten_doi_tac,
      COALESCE(id2.dia_chi_doi_tac, '') as dia_chi_doi_tac,
      COALESCE(bsd.ten_ngan_hang, '') as ten_ngan_hang,
      COALESCE(bsd.stk, '') as stk,
      COALESCE(bsd.so_tien, 0) as so_tien,
      COALESCE(bsd.mo_ta, '') as mo_ta
    FROM records r
    JOIN files f ON r.file_id = f.id
    LEFT JOIN invoice_data id2 ON r.id = id2.record_id
    LEFT JOIN bank_statement_data bsd ON r.id = bsd.record_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.updated_at DESC
    LIMIT ?
  `;

  return db.prepare(sql).all(...params);
}
