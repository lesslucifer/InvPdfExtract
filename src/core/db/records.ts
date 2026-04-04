import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';
import {
  ExtractionBatch, Record, BankStatementData, InvoiceData,
  InvoiceLineItem, BatchStatus, DocType, ProcessingLog, LogLevel,
  FolderInfo,
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

export function updateLineItem(lineItemId: string, data: Partial<InvoiceLineItem>): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE invoice_line_items
    SET mo_ta = ?, don_gia = ?, so_luong = ?, thue_suat = ?, thanh_tien = ?
    WHERE id = ?
  `).run(data.mo_ta ?? null, data.don_gia ?? null, data.so_luong ?? null, data.thue_suat ?? null, data.thanh_tien ?? null, lineItemId);
}

export function softDeleteLineItem(lineItemId: string): void {
  const db = getDatabase();
  db.prepare("UPDATE invoice_line_items SET deleted_at = datetime('now') WHERE id = ?").run(lineItemId);
}

export function deleteLineItemsByRecord(recordId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM invoice_line_items WHERE record_id = ?').run(recordId);
}

export function deleteUnlockedLineItemsByRecord(recordId: string): string[] {
  const db = getDatabase();
  // Get all line items for this record
  const items = db.prepare('SELECT id FROM invoice_line_items WHERE record_id = ? AND deleted_at IS NULL').all(recordId) as { id: string }[];
  const kept: string[] = [];
  for (const item of items) {
    const hasLock = db.prepare(
      "SELECT COUNT(*) as cnt FROM field_overrides WHERE record_id = ? AND table_name = 'invoice_line_items' AND resolved_at IS NULL"
    ).get(item.id) as { cnt: number };
    if (hasLock.cnt > 0) {
      kept.push(item.id);
    } else {
      db.prepare('DELETE FROM invoice_line_items WHERE id = ?').run(item.id);
    }
  }
  return kept;
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

export function getErrorLogsWithPath(): Array<ProcessingLog & { relative_path: string | null }> {
  const db = getDatabase();
  return db.prepare(`
    SELECT pl.*, f.relative_path
    FROM processing_logs pl
    LEFT JOIN extraction_batches eb ON pl.batch_id = eb.id
    LEFT JOIN files f ON eb.file_id = f.id
    WHERE pl.level = 'error'
    ORDER BY pl.timestamp DESC
    LIMIT 100
  `).all() as any[];
}

export function getProcessedFilesWithStats(): Array<{
  id: string; relative_path: string; status: string; doc_type: string | null;
  updated_at: string; record_count: number; overall_confidence: number;
}> {
  const db = getDatabase();
  return db.prepare(`
    SELECT f.id, f.relative_path, f.status, f.doc_type, f.updated_at,
      COALESCE(eb.record_count, 0) as record_count,
      COALESCE(eb.overall_confidence, 0) as overall_confidence
    FROM files f
    LEFT JOIN (
      SELECT file_id, record_count, overall_confidence,
        ROW_NUMBER() OVER (PARTITION BY file_id ORDER BY processed_at DESC) as rn
      FROM extraction_batches
    ) eb ON eb.file_id = f.id AND eb.rn = 1
    WHERE f.status IN ('done', 'review') AND f.deleted_at IS NULL
    ORDER BY f.updated_at DESC
  `).all() as any[];
}

// === Field Overrides ===

export function getFieldOverrides(recordId: string): any[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM field_overrides WHERE record_id = ? AND resolved_at IS NULL'
  ).all(recordId) as any[];
}

export function getFieldOverridesByLineItemId(lineItemId: string): any[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM field_overrides WHERE line_item_id = ? AND resolved_at IS NULL'
  ).all(lineItemId) as any[];
}

export function getFieldOverrideByField(recordId: string, tableName: string, fieldName: string, lineItemId?: string): any | undefined {
  const db = getDatabase();
  if (lineItemId) {
    return db.prepare(
      'SELECT * FROM field_overrides WHERE record_id = ? AND table_name = ? AND field_name = ? AND line_item_id = ? AND resolved_at IS NULL'
    ).get(recordId, tableName, fieldName, lineItemId) as any | undefined;
  }
  return db.prepare(
    'SELECT * FROM field_overrides WHERE record_id = ? AND table_name = ? AND field_name = ? AND line_item_id IS NULL AND resolved_at IS NULL'
  ).get(recordId, tableName, fieldName) as any | undefined;
}

export function upsertFieldOverride(
  recordId: string, tableName: string, fieldName: string,
  userValue: string, aiValueAtLock: string, lineItemId?: string
): void {
  const db = getDatabase();
  const existing = getFieldOverrideByField(recordId, tableName, fieldName, lineItemId);

  if (existing) {
    db.prepare(`
      UPDATE field_overrides
      SET user_value = ?, ai_value_at_lock = ?, status = 'locked', locked_at = datetime('now'), conflict_at = NULL, ai_value_latest = NULL
      WHERE id = ?
    `).run(userValue, aiValueAtLock, existing.id);
  } else {
    const id = uuid();
    db.prepare(`
      INSERT INTO field_overrides (id, record_id, table_name, field_name, user_value, ai_value_at_lock, status, locked_at, line_item_id)
      VALUES (?, ?, ?, ?, ?, ?, 'locked', datetime('now'), ?)
    `).run(id, recordId, tableName, fieldName, userValue, aiValueAtLock, lineItemId ?? null);
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

// === Folder Queries ===

export function listRecentFolders(limit: number = 5): FolderInfo[] {
  const db = getDatabase();
  // Group files by their two-level parent directory, ordered by most recent activity
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN INSTR(SUBSTR(relative_path, 1, LENGTH(relative_path) - LENGTH(REPLACE(relative_path, '/', ''))), '/') > 0
        THEN SUBSTR(relative_path, 1, INSTR(SUBSTR(relative_path, INSTR(relative_path, '/') + 1), '/') + INSTR(relative_path, '/') - 1)
        ELSE SUBSTR(relative_path, 1, INSTR(relative_path, '/') - 1)
      END AS folder,
      COUNT(DISTINCT r.id) AS record_count,
      MAX(f.updated_at) AS last_active
    FROM files f
    JOIN records r ON r.file_id = f.id AND r.deleted_at IS NULL
    WHERE f.deleted_at IS NULL
      AND INSTR(f.relative_path, '/') > 0
    GROUP BY folder
    HAVING folder IS NOT NULL AND folder != ''
    ORDER BY last_active DESC
    LIMIT ?
  `).all(limit) as Array<{ folder: string; record_count: number; last_active: string }>;

  return rows.map(r => ({
    path: r.folder,
    recordCount: r.record_count,
    lastActive: r.last_active,
  }));
}

export function listTopFolders(): FolderInfo[] {
  const db = getDatabase();
  // Group by first path segment only
  const rows = db.prepare(`
    SELECT
      SUBSTR(relative_path, 1, INSTR(relative_path, '/') - 1) AS folder,
      COUNT(DISTINCT r.id) AS record_count,
      MAX(f.updated_at) AS last_active
    FROM files f
    JOIN records r ON r.file_id = f.id AND r.deleted_at IS NULL
    WHERE f.deleted_at IS NULL
      AND INSTR(f.relative_path, '/') > 0
    GROUP BY folder
    HAVING folder IS NOT NULL AND folder != ''
    ORDER BY record_count DESC
  `).all() as Array<{ folder: string; record_count: number; last_active: string }>;

  return rows.map(r => ({
    path: r.folder,
    recordCount: r.record_count,
    lastActive: r.last_active,
  }));
}

// === Search ===

import { parseSearchQuery, ParsedQuery } from '../../shared/parse-query';
import { SearchFilters, AggregateStats } from '../../shared/types';

/** Shared filter-building logic used by search and aggregation queries. */
function buildFilterClauses(parsed: ParsedQuery): { conditions: string[]; params: any[] } {
  const conditions: string[] = ['r.deleted_at IS NULL'];
  const params: any[] = [];

  if (parsed.text.trim()) {
    const q = parsed.text.trim();
    // Escape the query for FTS5: wrap in double-quotes to treat as a phrase,
    // escaping any embedded double-quotes. This prevents syntax errors from
    // special FTS5 characters like /, (, ), *, ^, etc.
    const ftsQuery = '"' + q.replace(/"/g, '""') + '"*';
    conditions.push(`(
      r.id IN (SELECT rowid FROM records_fts WHERE records_fts MATCH ?)
      OR id2.so_hoa_don LIKE ?
      OR id2.mst LIKE ?
      OR id2.ten_doi_tac LIKE ?
      OR bsd.ten_doi_tac LIKE ?
      OR bsd.stk LIKE ?
    )`);
    params.push(ftsQuery, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  if (parsed.docType) {
    conditions.push('r.doc_type = ?');
    params.push(parsed.docType);
  }

  if (parsed.status === 'conflict') {
    conditions.push("r.id IN (SELECT record_id FROM field_overrides WHERE status = 'conflict' AND resolved_at IS NULL)");
  } else if (parsed.status === 'review') {
    conditions.push("f.status = 'review'");
  }

  if (parsed.folder) {
    conditions.push('f.relative_path LIKE ?');
    params.push(`${parsed.folder}%`);
  }

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

  if (parsed.dateFilter) {
    conditions.push('r.ngay LIKE ?');
    params.push(`${parsed.dateFilter}%`);
  }

  return { conditions, params };
}

/** Convert SearchFilters (from renderer) to ParsedQuery (for DB layer). */
function filtersToParsed(filters: SearchFilters): ParsedQuery {
  return {
    text: filters.text || '',
    docType: filters.docType,
    status: filters.status,
    folder: filters.folder,
    amountMin: filters.amountMin,
    amountMax: filters.amountMax,
    dateFilter: filters.dateFilter,
  };
}

const BASE_JOINS = `
  FROM records r
  JOIN files f ON r.file_id = f.id
  LEFT JOIN invoice_data id2 ON r.id = id2.record_id
  LEFT JOIN bank_statement_data bsd ON r.id = bsd.record_id`;

export function searchRecords(query: string, limit: number = 50, offset: number = 0, folder?: string | null): any[] {
  const db = getDatabase();
  const parsed = parseSearchQuery(query);
  if (folder) parsed.folder = folder;
  const { conditions, params } = buildFilterClauses(parsed);

  params.push(limit, offset);

  const sql = `
    SELECT r.*, f.relative_path, f.status as file_status,
      COALESCE(id2.so_hoa_don, '') as so_hoa_don,
      COALESCE(id2.tong_tien, 0) as tong_tien,
      COALESCE(id2.mst, '') as mst,
      COALESCE(id2.ten_doi_tac, bsd.ten_doi_tac, '') as ten_doi_tac,
      COALESCE(id2.dia_chi_doi_tac, '') as dia_chi_doi_tac,
      COALESCE(bsd.ten_ngan_hang, '') as ten_ngan_hang,
      COALESCE(bsd.stk, '') as stk,
      COALESCE(bsd.so_tien, 0) as so_tien,
      COALESCE(bsd.mo_ta, '') as mo_ta
    ${BASE_JOINS}
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.updated_at DESC
    LIMIT ? OFFSET ?
  `;

  return db.prepare(sql).all(...params);
}

/** Returns aggregate stats (count + total amount) for the given filters. */
export function getAggregates(filters: SearchFilters): AggregateStats {
  const db = getDatabase();
  const parsed = filtersToParsed(filters);
  const { conditions, params } = buildFilterClauses(parsed);

  const sql = `
    SELECT
      COUNT(*) AS totalRecords,
      SUM(COALESCE(id2.tong_tien, bsd.so_tien, 0)) AS totalAmount
    ${BASE_JOINS}
    WHERE ${conditions.join(' AND ')}
  `;

  const row = db.prepare(sql).get(...params) as any;
  return {
    totalRecords: row?.totalRecords ?? 0,
    totalAmount: row?.totalAmount ?? 0,
  };
}

/** Gathers export data filtered by SearchFilters. */
export function gatherFilteredExportData(filters: SearchFilters): { bankStatements: any[]; invoiceHeaders: any[]; invoiceLineItems: any[] } {
  const db = getDatabase();
  const parsed = filtersToParsed(filters);
  const { conditions, params } = buildFilterClauses(parsed);

  const whereClause = conditions.join(' AND ');

  const bankStatements = db.prepare(`
    SELECT r.ngay, f.relative_path,
      bsd.ten_ngan_hang, bsd.stk, bsd.mo_ta, bsd.so_tien, bsd.ten_doi_tac,
      r.confidence
    ${BASE_JOINS}
    WHERE ${whereClause} AND r.doc_type = 'bank_statement'
  `).all(...params);

  const invoiceHeaders = db.prepare(`
    SELECT r.id as record_id, r.doc_type, r.ngay, f.relative_path,
      id2.so_hoa_don, id2.tong_tien, id2.mst, id2.ten_doi_tac, id2.dia_chi_doi_tac,
      r.confidence
    ${BASE_JOINS}
    WHERE ${whereClause} AND r.doc_type IN ('invoice_in', 'invoice_out')
  `).all(...params);

  const recordIds = invoiceHeaders.map((h: any) => h.record_id);
  let invoiceLineItems: any[] = [];
  if (recordIds.length > 0) {
    const placeholders = recordIds.map(() => '?').join(',');
    invoiceLineItems = db.prepare(`
      SELECT li.*, id2.so_hoa_don, r.doc_type, r.ngay
      FROM invoice_line_items li
      JOIN records r ON li.record_id = r.id
      JOIN invoice_data id2 ON r.id = id2.record_id
      WHERE li.record_id IN (${placeholders})
        AND li.deleted_at IS NULL
      ORDER BY r.doc_type, id2.so_hoa_don, li.line_number
    `).all(...recordIds);
  }

  return { bankStatements, invoiceHeaders, invoiceLineItems };
}
