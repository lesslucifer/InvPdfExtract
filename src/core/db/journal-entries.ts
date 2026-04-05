import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';
import { JournalEntry, JEEntryType, JESource, CashFlowType } from '../../shared/types';

// === CRUD ===

export function insertJournalEntry(
  recordId: string,
  lineItemId: string | null,
  entryType: JEEntryType,
  tkNo: string | null,
  tkCo: string | null,
  amount: number | null,
  cashFlow: CashFlowType | null,
  source: JESource,
  similarityScore: number | null,
  matchedDescription: string | null,
): JournalEntry {
  const db = getDatabase();
  const id = uuid();
  db.prepare(`
    INSERT INTO journal_entries (id, record_id, line_item_id, entry_type, tk_no, tk_co, amount, cash_flow, source, similarity_score, matched_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, recordId, lineItemId, entryType, tkNo, tkCo, amount, cashFlow, source, similarityScore, matchedDescription);

  return db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry;
}

export function getJournalEntriesByRecord(recordId: string): JournalEntry[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM journal_entries
    WHERE record_id = ?
    ORDER BY
      CASE entry_type WHEN 'line' THEN 0 WHEN 'tax' THEN 1 WHEN 'total' THEN 2 WHEN 'bank' THEN 3 END,
      line_item_id
  `).all(recordId) as JournalEntry[];
}

export function getJournalEntryById(id: string): JournalEntry | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry | undefined;
}

export function updateJournalEntry(
  id: string,
  tkNo: string | null,
  tkCo: string | null,
  amount: number | null,
  cashFlow: CashFlowType | null,
): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE journal_entries
    SET tk_no = ?, tk_co = ?, amount = ?, cash_flow = ?, user_edited = 1, source = 'user', updated_at = datetime('now')
    WHERE id = ?
  `).run(tkNo, tkCo, amount, cashFlow, id);
}

export function deleteJournalEntry(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
}

export function deleteJournalEntriesByRecord(recordId: string, preserveUserEdited: boolean): void {
  const db = getDatabase();
  if (preserveUserEdited) {
    db.prepare('DELETE FROM journal_entries WHERE record_id = ? AND user_edited = 0').run(recordId);
  } else {
    db.prepare('DELETE FROM journal_entries WHERE record_id = ?').run(recordId);
  }
}

// === Similarity Cache Queries ===

export interface CacheEntry {
  mo_ta: string;
  record_id: string;
  line_item_id: string | null;
  tk_no: string;
  tk_co: string;
  cash_flow: string | null;
  entry_type: string;
}

export function getRecentClassifiedLineItems(limit: number): CacheEntry[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT ili.mo_ta, je.record_id, je.line_item_id, je.tk_no, je.tk_co, je.cash_flow, je.entry_type
    FROM journal_entries je
    JOIN invoice_line_items ili ON je.line_item_id = ili.id
    WHERE je.line_item_id IS NOT NULL
      AND je.entry_type = 'line'
      AND ili.mo_ta IS NOT NULL
      AND ili.deleted_at IS NULL
    ORDER BY je.created_at DESC
    LIMIT ?
  `).all(limit) as CacheEntry[];
}

export function getRecentClassifiedBankItems(limit: number): CacheEntry[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT bsd.mo_ta, je.record_id, NULL as line_item_id, je.tk_no, je.tk_co, je.cash_flow, je.entry_type
    FROM journal_entries je
    JOIN bank_statement_data bsd ON je.record_id = bsd.record_id
    WHERE je.line_item_id IS NULL
      AND je.entry_type = 'bank'
      AND bsd.mo_ta IS NOT NULL
    ORDER BY je.created_at DESC
    LIMIT ?
  `).all(limit) as CacheEntry[];
}

// === Query helpers ===

export function findExistingEntry(recordId: string, lineItemId: string | null, entryType: JEEntryType): JournalEntry | undefined {
  const db = getDatabase();
  if (lineItemId) {
    return db.prepare(
      'SELECT * FROM journal_entries WHERE record_id = ? AND line_item_id = ? AND entry_type = ?'
    ).get(recordId, lineItemId, entryType) as JournalEntry | undefined;
  }
  return db.prepare(
    'SELECT * FROM journal_entries WHERE record_id = ? AND line_item_id IS NULL AND entry_type = ?'
  ).get(recordId, entryType) as JournalEntry | undefined;
}
