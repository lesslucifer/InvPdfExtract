import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';
import {
  ExtractionBatch, DbRecord, BankStatementData, InvoiceData,
  InvoiceLineItem, BatchStatus, DocType, ProcessingLog, LogLevel,
  FolderInfo, JEClassificationStatus, JeQueueItem, JeErrorItem,
  FieldOverrideInfo, SearchFilters, AggregateStats, SearchResult,
} from '../../shared/types';

interface ProcessingLogWithPath extends ProcessingLog {
  relative_path: string | null;
}

interface ProcessedFileWithStats {
  id: string;
  relative_path: string;
  status: string;
  doc_type: string | null;
  updated_at: string;
  record_count: number;
  overall_confidence: number;
}

interface FieldOverrideRow extends FieldOverrideInfo {
  id: string;
  record_id: string;
  table_name: string;
  locked_at: string | null;
  conflict_at: string | null;
  resolved_at: string | null;
  line_item_id: string | null;
}

interface AggregateRow {
  totalRecords: number | null;
  totalAmount: number | null;
}

type SqlParam = string | number | null;

interface ExportBankStatementRow {
  doc_date: string | null;
  relative_path: string;
  bank_name: string | null;
  account_number: string | null;
  description: string | null;
  amount: number | null;
  counterparty_name: string | null;
  confidence: number;
}

interface ExportInvoiceHeaderRow {
  record_id: string;
  doc_type: DocType;
  doc_date: string | null;
  relative_path: string;
  invoice_number: string | null;
  total_before_tax: number | null;
  total_amount: number | null;
  tax_id: string | null;
  counterparty_name: string | null;
  counterparty_address: string | null;
  confidence: number;
}

interface ExportInvoiceLineItemRow extends InvoiceLineItem {
  invoice_number: string | null;
  doc_type: DocType;
  doc_date: string | null;
}

export interface JEExportRow {
  doc_date: string | null;
  doc_type: string;
  relative_path: string;
  invoice_number: string | null;
  bank_description: string | null;
  counterparty_name: string | null;
  total_amount: number | null;
  li_description: string | null;
  li_subtotal: number | null;
  li_tax_amount: number | null;
  li_total_with_tax: number | null;
  total_before_tax: number | null;
  entry_type: string;
  account: string | null;
  cash_flow: string | null;
  bank_amount: number | null;
}

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
  confidence: number, docDate: string | null, fieldConfidence: object, rawExtraction: object
): DbRecord {
  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence, doc_date, field_confidence, raw_extraction, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, batchId, fileId, docType, fingerprint, confidence, docDate, JSON.stringify(fieldConfidence), JSON.stringify(rawExtraction), now, now);

  return db.prepare('SELECT * FROM records WHERE id = ?').get(id) as DbRecord;
}

export function updateRecord(
  recordId: string, batchId: string, confidence: number, docDate: string | null,
  fieldConfidence: object, rawExtraction: object
): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE records SET batch_id = ?, confidence = ?, doc_date = ?, field_confidence = ?, raw_extraction = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(batchId, confidence, docDate, JSON.stringify(fieldConfidence), JSON.stringify(rawExtraction), recordId);
}

export function getRecordsByFileId(fileId: string): DbRecord[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM records WHERE file_id = ? AND deleted_at IS NULL').all(fileId) as DbRecord[];
}

export function updateJeStatus(recordIds: string[], status: JEClassificationStatus): void {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE records SET je_status = ?, updated_at = datetime(\'now\') WHERE id = ?');
  const tx = db.transaction(() => {
    for (const id of recordIds) stmt.run(status, id);
  });
  tx();
}

export function getJeQueueItems(): JeQueueItem[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT r.id AS record_id, r.je_status, r.doc_type, r.created_at,
      COALESCE(id2.invoice_number, bsd.description, '') AS description,
      f.relative_path
    FROM records r
    LEFT JOIN invoice_data id2 ON r.id = id2.record_id
    LEFT JOIN bank_statement_data bsd ON r.id = bsd.record_id
    JOIN files f ON r.file_id = f.id
    WHERE r.je_status IN ('pending', 'processing')
      AND r.deleted_at IS NULL
    ORDER BY r.updated_at DESC
  `).all() as JeQueueItem[];
}

export function getJeErrorItems(): JeErrorItem[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT r.id AS record_id, r.doc_type, r.updated_at,
      COALESCE(id2.invoice_number, bsd.description, '') AS description,
      f.relative_path
    FROM records r
    LEFT JOIN invoice_data id2 ON r.id = id2.record_id
    LEFT JOIN bank_statement_data bsd ON r.id = bsd.record_id
    JOIN files f ON r.file_id = f.id
    WHERE r.je_status = 'error'
      AND r.deleted_at IS NULL
    ORDER BY r.updated_at DESC
  `).all() as JeErrorItem[];
}

export function getRecordByFingerprint(fileId: string, fingerprint: string): DbRecord | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM records WHERE file_id = ? AND fingerprint = ? AND deleted_at IS NULL').get(fileId, fingerprint) as DbRecord | undefined;
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
    INSERT INTO bank_statement_data (record_id, bank_name, account_number, description, amount, counterparty_name)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET
      bank_name = excluded.bank_name,
      account_number = excluded.account_number,
      description = excluded.description,
      amount = excluded.amount,
      counterparty_name = excluded.counterparty_name
  `).run(recordId, data.bank_name ?? null, data.account_number ?? null, data.description ?? null, data.amount ?? null, data.counterparty_name ?? null);
}

// === Invoice Data ===

export function upsertInvoiceData(recordId: string, data: Partial<InvoiceData>): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO invoice_data (record_id, invoice_number, total_before_tax, total_amount, tax_id, counterparty_name, counterparty_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET
      invoice_number = excluded.invoice_number,
      total_before_tax = excluded.total_before_tax,
      total_amount = excluded.total_amount,
      tax_id = excluded.tax_id,
      counterparty_name = excluded.counterparty_name,
      counterparty_address = excluded.counterparty_address
  `).run(recordId, data.invoice_number ?? null, data.total_before_tax ?? null, data.total_amount ?? null, data.tax_id ?? null, data.counterparty_name ?? null, data.counterparty_address ?? null);
}

// === Invoice Line Items ===

export function insertLineItem(recordId: string, lineNumber: number, data: Partial<InvoiceLineItem>): InvoiceLineItem {
  const db = getDatabase();
  const id = uuid();
  db.prepare(`
    INSERT INTO invoice_line_items (id, record_id, line_number, description, unit_price, quantity, tax_rate, subtotal, total_with_tax)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, recordId, lineNumber, data.description ?? null, data.unit_price ?? null, data.quantity ?? null, data.tax_rate ?? null, data.subtotal ?? null, data.total_with_tax ?? null);

  return db.prepare('SELECT * FROM invoice_line_items WHERE id = ?').get(id) as InvoiceLineItem;
}

export function updateLineItem(lineItemId: string, data: Partial<InvoiceLineItem>): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE invoice_line_items
    SET description = ?, unit_price = ?, quantity = ?, tax_rate = ?, subtotal = ?, total_with_tax = ?
    WHERE id = ?
  `).run(data.description ?? null, data.unit_price ?? null, data.quantity ?? null, data.tax_rate ?? null, data.subtotal ?? null, data.total_with_tax ?? null, lineItemId);
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
  invoice_number?: string; tax_id?: string; counterparty_name?: string; counterparty_address?: string;
  description?: string; bank_name?: string; account_number?: string;
}): void {
  const db = getDatabase();
  // Delete old entry if exists
  db.prepare('DELETE FROM records_fts WHERE rowid = (SELECT rowid FROM records_fts WHERE invoice_number = ? OR tax_id = ? LIMIT 1)').run(data.invoice_number ?? '', data.tax_id ?? '');
  // Insert new
  db.prepare(`
    INSERT INTO records_fts (rowid, invoice_number, tax_id, counterparty_name, counterparty_address, description, bank_name, account_number)
    VALUES ((SELECT rowid FROM records WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)
  `).run(recordId, data.invoice_number ?? '', data.tax_id ?? '', data.counterparty_name ?? '', data.counterparty_address ?? '', data.description ?? '', data.bank_name ?? '', data.account_number ?? '');
}

// === Processing Logs ===

export function addLog(batchId: string | null, level: LogLevel, message: string, detail?: string, fileId?: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO processing_logs (id, batch_id, level, message, detail, file_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(uuid(), batchId, level, message, detail ?? null, fileId ?? null);
}

export function getRecentLogs(limit: number = 50): ProcessingLog[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM processing_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as ProcessingLog[];
}

export function getErrorLogsWithPath(): Array<ProcessingLog & { relative_path: string | null }> {
  const db = getDatabase();
  return db.prepare(`
    SELECT pl.*, COALESCE(f1.relative_path, f2.relative_path) as relative_path
    FROM processing_logs pl
    LEFT JOIN extraction_batches eb ON pl.batch_id = eb.id
    LEFT JOIN files f1 ON eb.file_id = f1.id
    LEFT JOIN files f2 ON pl.file_id = f2.id
    WHERE pl.level = 'error'
    ORDER BY pl.timestamp DESC
    LIMIT 100
  `).all() as ProcessingLogWithPath[];
}

export function getSessionLogForFile(fileId: string): string | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT claude_session_log FROM extraction_batches
    WHERE file_id = ? AND claude_session_log IS NOT NULL
    ORDER BY processed_at DESC LIMIT 1
  `).get(fileId) as { claude_session_log: string } | undefined;
  return row?.claude_session_log ?? null;
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
  `).all() as ProcessedFileWithStats[];
}

// === Field Overrides ===

export function getFieldOverrides(recordId: string): FieldOverrideRow[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM field_overrides WHERE record_id = ? AND resolved_at IS NULL'
  ).all(recordId) as FieldOverrideRow[];
}

export function getFieldOverridesByLineItemId(lineItemId: string): FieldOverrideRow[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM field_overrides WHERE line_item_id = ? AND resolved_at IS NULL'
  ).all(lineItemId) as FieldOverrideRow[];
}

export function getFieldOverrideByField(recordId: string, tableName: string, fieldName: string, lineItemId?: string): FieldOverrideRow | undefined {
  const db = getDatabase();
  if (lineItemId) {
    return db.prepare(
      'SELECT * FROM field_overrides WHERE record_id = ? AND table_name = ? AND field_name = ? AND line_item_id = ? AND resolved_at IS NULL'
    ).get(recordId, tableName, fieldName, lineItemId) as FieldOverrideRow | undefined;
  }
  return db.prepare(
    'SELECT * FROM field_overrides WHERE record_id = ? AND table_name = ? AND field_name = ? AND line_item_id IS NULL AND resolved_at IS NULL'
  ).get(recordId, tableName, fieldName) as FieldOverrideRow | undefined;
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
  ).get(recordId, fieldName) as FieldOverrideRow | undefined;

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
  ).all(recordId) as FieldOverrideRow[];

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
  ).all(recordId) as FieldOverrideRow[];

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

import { parseSearchQuery, ParsedQuery, SortField, SORT_DEFAULT_DIRECTIONS } from '../../shared/parse-query';

/** Shared filter-building logic used by search and aggregation queries. */
function buildFilterClauses(parsed: ParsedQuery): { conditions: string[]; params: SqlParam[] } {
  const conditions: string[] = ['r.deleted_at IS NULL'];
  const params: SqlParam[] = [];

  if (parsed.text.trim()) {
    const q = parsed.text.trim();
    // Escape the query for FTS5: wrap in double-quotes to treat as a phrase,
    // escaping any embedded double-quotes. This prevents syntax errors from
    // special FTS5 characters like /, (, ), *, ^, etc.
    const ftsQuery = '"' + q.replace(/"/g, '""') + '"*';
    conditions.push(`(
      r.id IN (SELECT rowid FROM records_fts WHERE records_fts MATCH ?)
      OR id2.invoice_number LIKE ?
      OR id2.tax_id LIKE ?
      OR id2.counterparty_name LIKE ?
      OR bsd.counterparty_name LIKE ?
      OR bsd.account_number LIKE ?
    )`);
    params.push(ftsQuery, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  if (parsed.docType) {
    conditions.push('r.doc_type = ?');
    params.push(parsed.docType);
  }

  if (parsed.status === 'conflict') {
    conditions.push("r.id IN (SELECT record_id FROM field_overrides WHERE status = 'conflict' AND resolved_at IS NULL)");
  } else if (parsed.status === 'mismatch') {
    conditions.push(`r.doc_type IN ('invoice_in', 'invoice_out')
      AND ABS(COALESCE(id2.total_amount, 0) - COALESCE(
        (SELECT SUM(total_with_tax) FROM invoice_line_items WHERE record_id = r.id AND deleted_at IS NULL), 0)) > 1000
      AND (SELECT COUNT(*) FROM invoice_line_items WHERE record_id = r.id AND deleted_at IS NULL) > 0`);
  } else if (parsed.status === 'review') {
    conditions.push("f.status = 'review'");
  }

  if (parsed.filePath) {
    conditions.push('f.relative_path = ?');
    params.push(parsed.filePath);
  } else if (parsed.folder) {
    conditions.push('f.relative_path LIKE ?');
    params.push(`${parsed.folder}%`);
  }

  if (parsed.amountMin != null || parsed.amountMax != null) {
    if (parsed.amountMin != null && parsed.amountMax != null) {
      conditions.push('(COALESCE(id2.total_amount, bsd.amount, 0) BETWEEN ? AND ?)');
      params.push(parsed.amountMin, parsed.amountMax);
    } else if (parsed.amountMin != null) {
      conditions.push('COALESCE(id2.total_amount, bsd.amount, 0) > ?');
      params.push(parsed.amountMin);
    } else {
      conditions.push('COALESCE(id2.total_amount, bsd.amount, 0) < ?');
      params.push(parsed.amountMax!);
    }
  }

  if (parsed.dateFilter) {
    conditions.push('r.doc_date LIKE ?');
    params.push(`${parsed.dateFilter}%`);
  }

  if (parsed.taxId) {
    conditions.push('id2.tax_id = ?');
    params.push(parsed.taxId);
  }

  return { conditions, params };
}

/** Convert SearchFilters (from renderer) to ParsedQuery (for DB layer). */
function filtersToParsed(filters: SearchFilters): ParsedQuery {
  return {
    text: filters.text || '',
    docType: filters.docType,
    status: filters.status,
    taxId: filters.taxId,
    folder: filters.folder,
    filePath: filters.filePath,
    amountMin: filters.amountMin,
    amountMax: filters.amountMax,
    dateFilter: filters.dateFilter,
    sortField: filters.sortField,
    sortDirection: filters.sortDirection,
  };
}

const SORT_FIELD_SQL: Record<SortField, string> = {
  time: 'r.updated_at',
  date: 'r.doc_date',
  path: 'f.relative_path',
  amount: 'COALESCE(id2.total_amount, bsd.amount, 0)',
  confidence: 'r.confidence',
  shd: 'COALESCE(id2.invoice_number, \'\')',
};

function buildOrderByClause(parsed: ParsedQuery): string {
  if (!parsed.sortField) return 'ORDER BY r.updated_at DESC';
  const col = SORT_FIELD_SQL[parsed.sortField];
  if (!col) return 'ORDER BY r.updated_at DESC';
  const dir = (parsed.sortDirection || SORT_DEFAULT_DIRECTIONS[parsed.sortField]).toUpperCase();
  // Push NULLs to end for date sort
  if (parsed.sortField === 'date') {
    return `ORDER BY (r.doc_date IS NULL) ASC, r.doc_date ${dir}`;
  }
  return `ORDER BY ${col} ${dir}`;
}

const BASE_JOINS = `
  FROM records r
  JOIN files f ON r.file_id = f.id
  LEFT JOIN invoice_data id2 ON r.id = id2.record_id
  LEFT JOIN bank_statement_data bsd ON r.id = bsd.record_id`;

export function searchRecords(query: string, limit: number = 50, offset: number = 0, folder?: string | null, filePath?: string | null): SearchResult[] {
  const db = getDatabase();
  const parsed = parseSearchQuery(query);
  if (filePath) parsed.filePath = filePath;
  else if (folder) parsed.folder = folder;
  const { conditions, params } = buildFilterClauses(parsed);

  params.push(limit, offset);

  const sql = `
    SELECT r.*, f.relative_path, f.status as file_status, r.je_status,
      COALESCE(id2.invoice_number, '') as invoice_number,
      COALESCE(id2.total_before_tax, 0) as total_before_tax,
      COALESCE(id2.total_amount, 0) as total_amount,
      COALESCE(id2.tax_id, '') as tax_id,
      COALESCE(id2.counterparty_name, bsd.counterparty_name, '') as counterparty_name,
      COALESCE(id2.counterparty_address, '') as counterparty_address,
      COALESCE(bsd.bank_name, '') as bank_name,
      COALESCE(bsd.account_number, '') as account_number,
      COALESCE(bsd.amount, 0) as amount,
      COALESCE(bsd.description, '') as description,
      (SELECT SUM(total_with_tax) FROM invoice_line_items WHERE record_id = r.id AND deleted_at IS NULL) as line_item_sum,
      (SELECT SUM(subtotal) FROM invoice_line_items WHERE record_id = r.id AND deleted_at IS NULL) as line_item_sum_before_tax
    ${BASE_JOINS}
    WHERE ${conditions.join(' AND ')}
    ${buildOrderByClause(parsed)}
    LIMIT ? OFFSET ?
  `;

  return db.prepare(sql).all(...params) as SearchResult[];
}

/** Returns aggregate stats (count + total amount) for the given filters. */
export function getAggregates(filters: SearchFilters): AggregateStats {
  const db = getDatabase();
  const parsed = filtersToParsed(filters);
  const { conditions, params } = buildFilterClauses(parsed);

  const sql = `
    SELECT
      COUNT(*) AS totalRecords,
      SUM(COALESCE(id2.total_amount, bsd.amount, 0)) AS totalAmount
    ${BASE_JOINS}
    WHERE ${conditions.join(' AND ')}
  `;

  const row = db.prepare(sql).get(...params) as AggregateRow | undefined;
  return {
    totalRecords: row?.totalRecords ?? 0,
    totalAmount: row?.totalAmount ?? 0,
  };
}

/** Gathers export data filtered by SearchFilters. */
export function gatherFilteredExportData(filters: SearchFilters): {
  bankStatements: ExportBankStatementRow[];
  invoiceHeaders: ExportInvoiceHeaderRow[];
  invoiceLineItems: ExportInvoiceLineItemRow[];
} {
  const db = getDatabase();
  const parsed = filtersToParsed(filters);
  const { conditions, params } = buildFilterClauses(parsed);

  const whereClause = conditions.join(' AND ');

  const bankStatements = db.prepare(`
    SELECT r.doc_date, f.relative_path,
      bsd.bank_name, bsd.account_number, bsd.description, bsd.amount, bsd.counterparty_name,
      r.confidence
    ${BASE_JOINS}
    WHERE ${whereClause} AND r.doc_type = 'bank_statement'
  `).all(...params) as ExportBankStatementRow[];

  const invoiceHeaders = db.prepare(`
    SELECT r.id as record_id, r.doc_type, r.doc_date, f.relative_path,
      id2.invoice_number, id2.total_before_tax, id2.total_amount, id2.tax_id, id2.counterparty_name, id2.counterparty_address,
      r.confidence
    ${BASE_JOINS}
    WHERE ${whereClause} AND r.doc_type IN ('invoice_in', 'invoice_out')
  `).all(...params) as ExportInvoiceHeaderRow[];

  const recordIds = invoiceHeaders.map(h => h.record_id);
  let invoiceLineItems: ExportInvoiceLineItemRow[] = [];
  if (recordIds.length > 0) {
    const placeholders = recordIds.map(() => '?').join(',');
    invoiceLineItems = db.prepare(`
      SELECT li.*, id2.invoice_number, r.doc_type, r.doc_date
      FROM invoice_line_items li
      JOIN records r ON li.record_id = r.id
      JOIN invoice_data id2 ON r.id = id2.record_id
      WHERE li.record_id IN (${placeholders})
        AND li.deleted_at IS NULL
      ORDER BY r.doc_type, id2.invoice_number, li.line_number
    `).all(...recordIds) as ExportInvoiceLineItemRow[];
  }

  return { bankStatements, invoiceHeaders, invoiceLineItems };
}

/** Gathers JE export data filtered by SearchFilters. One row per journal entry. */
export function gatherJEExportData(filters: SearchFilters): JEExportRow[] {
  const db = getDatabase();
  const parsed = filtersToParsed(filters);
  const { conditions, params } = buildFilterClauses(parsed);
  const whereClause = conditions.join(' AND ');

  return db.prepare(`
    SELECT
      r.doc_date,
      r.doc_type,
      f.relative_path,
      id2.invoice_number,
      bsd.description        AS bank_description,
      COALESCE(id2.counterparty_name, bsd.counterparty_name) AS counterparty_name,
      id2.total_amount,
      id2.total_before_tax,
      li.description         AS li_description,
      li.subtotal            AS li_subtotal,
      (COALESCE(li.total_with_tax, 0) - COALESCE(li.subtotal, 0)) AS li_tax_amount,
      li.total_with_tax      AS li_total_with_tax,
      je.entry_type,
      je.account,
      je.cash_flow,
      bsd.amount             AS bank_amount
    ${BASE_JOINS}
    JOIN journal_entries je ON je.record_id = r.id
    LEFT JOIN invoice_line_items li
           ON li.id = je.line_item_id AND li.deleted_at IS NULL
    WHERE ${whereClause}
    ORDER BY
      (r.doc_date IS NULL) ASC,
      r.doc_date ASC,
      r.id,
      CASE je.entry_type
        WHEN 'invoice'    THEN 0
        WHEN 'line'       THEN 1
        WHEN 'tax'        THEN 2
        WHEN 'settlement' THEN 3
        WHEN 'bank'       THEN 4
        ELSE 5
      END,
      je.line_item_id
  `).all(...params) as JEExportRow[];
}
