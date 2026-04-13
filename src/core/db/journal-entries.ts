import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';
import { JournalEntry, JEEntryType, JESource, CashFlowType } from '../../shared/types';
import { log, LogModule } from '../logger';

// === CRUD ===

export function insertJournalEntry(
  recordId: string,
  lineItemId: string | null,
  entryType: JEEntryType,
  account: string | null,
  cashFlow: CashFlowType | null,
  source: JESource,
  similarityScore: number | null,
  matchedDescription: string | null,
  contraAccount: string | null = null,
): JournalEntry {
  const db = getDatabase();
  const id = uuid();
  db.prepare(`
    INSERT INTO journal_entries (id, record_id, line_item_id, entry_type, account, contra_account, cash_flow, source, similarity_score, matched_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, recordId, lineItemId, entryType, account, contraAccount, cashFlow, source, similarityScore, matchedDescription);

  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry;
  log.debug(LogModule.DB, `Inserted JE: ${entryType} (source=${source})`, { recordId, lineItemId, account });
  return entry;
}

export function getJournalEntriesByRecord(recordId: string): JournalEntry[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM journal_entries
    WHERE record_id = ?
    ORDER BY
      CASE entry_type WHEN 'invoice' THEN 0 WHEN 'line' THEN 1 WHEN 'tax' THEN 2 WHEN 'settlement' THEN 3 WHEN 'bank' THEN 4 END,
      line_item_id
  `).all(recordId) as JournalEntry[];
}

export function getJournalEntryById(id: string): JournalEntry | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry | undefined;
}

export function updateJournalEntry(
  id: string,
  account: string | null,
  cashFlow: CashFlowType | null,
  contraAccount?: string | null,
): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE journal_entries
    SET account = ?, cash_flow = ?, contra_account = ?, user_edited = 1, source = 'user', updated_at = datetime('now')
    WHERE id = ?
  `).run(account, cashFlow, contraAccount ?? null, id);
  log.debug(LogModule.DB, `Updated JE: account=${account}`, { jeId: id });
}

export function deleteJournalEntry(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
  log.debug(LogModule.DB, `Deleted JE`, { jeId: id });
}

export function deleteJournalEntriesByRecord(recordId: string, preserveUserEdited: boolean): void {
  const db = getDatabase();
  if (preserveUserEdited) {
    db.prepare('DELETE FROM journal_entries WHERE record_id = ? AND user_edited = 0').run(recordId);
  } else {
    db.prepare('DELETE FROM journal_entries WHERE record_id = ?').run(recordId);
  }
  log.debug(LogModule.DB, `Deleted JEs for record (preserveUserEdited=${preserveUserEdited})`, { recordId });
}

// === Similarity Cache Queries ===

export interface CacheEntry {
  description: string;
  record_id: string;
  line_item_id: string | null;
  account: string;
  contra_account: string | null;
  cash_flow: string | null;
  entry_type: string;
}

export function getRecentClassifiedLineItems(limit: number): CacheEntry[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      ili.description,
      je.record_id,
      je.line_item_id,
      je.account,
      je.contra_account,
      je.cash_flow,
      je.entry_type
    FROM journal_entries je
    JOIN invoice_line_items ili ON je.line_item_id = ili.id
    WHERE je.line_item_id IS NOT NULL
      AND je.entry_type = 'line'
      AND ili.description IS NOT NULL
      AND ili.deleted_at IS NULL
    GROUP BY LOWER(TRIM(ili.description)), je.account, COALESCE(je.contra_account, ''), je.cash_flow, je.entry_type
    ORDER BY MAX(je.created_at) DESC
    LIMIT ?
  `).all(limit) as CacheEntry[];
}

export function getRecentClassifiedBankItems(limit: number): CacheEntry[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      bsd.description,
      je.record_id,
      NULL as line_item_id,
      je.account,
      je.contra_account,
      je.cash_flow,
      je.entry_type
    FROM journal_entries je
    JOIN bank_statement_data bsd ON je.record_id = bsd.record_id
    WHERE je.line_item_id IS NULL
      AND je.entry_type = 'bank'
      AND bsd.description IS NOT NULL
    GROUP BY LOWER(TRIM(bsd.description)), je.account, COALESCE(je.contra_account, ''), je.cash_flow, je.entry_type
    ORDER BY MAX(je.created_at) DESC
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
