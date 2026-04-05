import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createInMemoryDb } from '../../__tests__/helpers/mock-db';

vi.mock('./database', () => ({
  getDatabase: () => _testDb,
}));

let _testDb: Database.Database;

import {
  insertJournalEntry,
  getJournalEntriesByRecord,
  getJournalEntryById,
  updateJournalEntry,
  deleteJournalEntry,
  deleteJournalEntriesByRecord,
  getRecentClassifiedLineItems,
  getRecentClassifiedBankItems,
  findExistingEntry,
} from './journal-entries';

// Helper to insert a record with required foreign keys
function seedRecord(id = 'rec-1', fileId = 'file-1'): void {
  _testDb.exec(`INSERT OR IGNORE INTO files (id, relative_path, file_hash, file_type, status) VALUES ('${fileId}', 'test.pdf', 'hash1', 'pdf', 'done')`);
  _testDb.exec(`INSERT OR IGNORE INTO extraction_batches (id, file_id, status, record_count, overall_confidence) VALUES ('batch-1', '${fileId}', 'success', 1, 0.9)`);
  _testDb.exec(`INSERT OR IGNORE INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence) VALUES ('${id}', 'batch-1', '${fileId}', 'invoice_in', 'fp-${id}', 0.9)`);
}

function seedLineItem(id: string, recordId: string, moTa: string): void {
  _testDb.exec(`INSERT OR IGNORE INTO invoice_line_items (id, record_id, line_number, mo_ta) VALUES ('${id}', '${recordId}', 1, '${moTa}')`);
}

function seedBankData(recordId: string, moTa: string): void {
  _testDb.exec(`INSERT OR IGNORE INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence) VALUES ('${recordId}', 'batch-1', 'file-1', 'bank_statement', 'fp-bank-${recordId}', 0.9)`);
  _testDb.exec(`INSERT OR IGNORE INTO bank_statement_data (record_id, mo_ta, so_tien) VALUES ('${recordId}', '${moTa}', 1000000)`);
}

describe('journal-entries DB layer', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
    seedRecord();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('inserts and retrieves a journal entry', () => {
    const je = insertJournalEntry('rec-1', null, 'line', '156', '331', 500000, 'operating', 'ai', null, null);

    expect(je.id).toBeTruthy();
    expect(je.record_id).toBe('rec-1');
    expect(je.tk_no).toBe('156');
    expect(je.tk_co).toBe('331');
    expect(je.amount).toBe(500000);
    expect(je.cash_flow).toBe('operating');
    expect(je.source).toBe('ai');
    expect(je.user_edited).toBe(0);

    const entries = getJournalEntriesByRecord('rec-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(je.id);
  });

  it('getJournalEntryById returns the entry', () => {
    const je = insertJournalEntry('rec-1', null, 'line', '156', '331', null, null, 'ai', null, null);
    const found = getJournalEntryById(je.id);
    expect(found).toBeTruthy();
    expect(found!.tk_no).toBe('156');
  });

  it('getJournalEntryById returns undefined for missing', () => {
    expect(getJournalEntryById('nonexistent')).toBeUndefined();
  });

  it('updates a journal entry and marks user_edited', () => {
    const je = insertJournalEntry('rec-1', null, 'line', '156', '331', 500000, 'operating', 'ai', null, null);

    updateJournalEntry(je.id, '642', '331', 500000, 'operating');

    const updated = getJournalEntryById(je.id);
    expect(updated!.tk_no).toBe('642');
    expect(updated!.user_edited).toBe(1);
    expect(updated!.source).toBe('user');
  });

  it('deletes a single journal entry', () => {
    const je = insertJournalEntry('rec-1', null, 'line', '156', '331', null, null, 'ai', null, null);
    deleteJournalEntry(je.id);
    expect(getJournalEntriesByRecord('rec-1')).toHaveLength(0);
  });

  it('deleteJournalEntriesByRecord removes all entries', () => {
    insertJournalEntry('rec-1', null, 'line', '156', '331', null, null, 'ai', null, null);
    insertJournalEntry('rec-1', null, 'tax', '1331', '331', null, null, 'ai', null, null);
    insertJournalEntry('rec-1', null, 'total', '156', '331', null, null, 'user', null, null);

    deleteJournalEntriesByRecord('rec-1', false);
    expect(getJournalEntriesByRecord('rec-1')).toHaveLength(0);
  });

  it('deleteJournalEntriesByRecord preserves user-edited entries', () => {
    insertJournalEntry('rec-1', null, 'line', '156', '331', null, null, 'ai', null, null);
    const userJe = insertJournalEntry('rec-1', null, 'tax', '1331', '331', null, null, 'user', null, null);
    // Mark as user-edited
    updateJournalEntry(userJe.id, '1331', '331', null, null);

    deleteJournalEntriesByRecord('rec-1', true);

    const remaining = getJournalEntriesByRecord('rec-1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].user_edited).toBe(1);
  });

  it('getRecentClassifiedLineItems returns items with JEs', () => {
    seedLineItem('li-1', 'rec-1', 'Van phong pham');
    insertJournalEntry('rec-1', 'li-1', 'line', '6422', '331', null, 'operating', 'ai', null, null);

    const items = getRecentClassifiedLineItems(100);
    expect(items).toHaveLength(1);
    expect(items[0].mo_ta).toBe('Van phong pham');
    expect(items[0].tk_no).toBe('6422');
  });

  it('getRecentClassifiedLineItems respects limit', () => {
    seedRecord('rec-2');
    seedLineItem('li-1', 'rec-1', 'Item 1');
    seedLineItem('li-2', 'rec-2', 'Item 2');
    insertJournalEntry('rec-1', 'li-1', 'line', '156', '331', null, null, 'ai', null, null);
    insertJournalEntry('rec-2', 'li-2', 'line', '642', '331', null, null, 'ai', null, null);

    const items = getRecentClassifiedLineItems(1);
    expect(items).toHaveLength(1);
  });

  it('getRecentClassifiedBankItems returns bank records with JEs', () => {
    seedBankData('bank-1', 'Thanh toan tien hang');
    insertJournalEntry('bank-1', null, 'bank', '331', '112', 1000000, 'operating', 'ai', null, null);

    const items = getRecentClassifiedBankItems(100);
    expect(items).toHaveLength(1);
    expect(items[0].mo_ta).toBe('Thanh toan tien hang');
    expect(items[0].tk_no).toBe('331');
  });

  it('findExistingEntry finds by record + lineItem + entryType', () => {
    seedLineItem('li-1', 'rec-1', 'Test');
    insertJournalEntry('rec-1', 'li-1', 'line', '156', '331', null, null, 'ai', null, null);

    const found = findExistingEntry('rec-1', 'li-1', 'line');
    expect(found).toBeTruthy();
    expect(found!.tk_no).toBe('156');

    const notFound = findExistingEntry('rec-1', 'li-1', 'tax');
    expect(notFound).toBeUndefined();
  });

  it('findExistingEntry finds by record + null lineItem', () => {
    insertJournalEntry('rec-1', null, 'bank', '112', '131', null, null, 'ai', null, null);

    const found = findExistingEntry('rec-1', null, 'bank');
    expect(found).toBeTruthy();
  });

  it('orders results by entry_type then line_item_id', () => {
    seedLineItem('li-a', 'rec-1', 'A');
    seedLineItem('li-b', 'rec-1', 'B');
    insertJournalEntry('rec-1', 'li-b', 'tax', '1331', '331', null, null, 'ai', null, null);
    insertJournalEntry('rec-1', 'li-a', 'line', '156', '331', null, null, 'ai', null, null);
    insertJournalEntry('rec-1', 'li-b', 'line', '642', '331', null, null, 'ai', null, null);

    const entries = getJournalEntriesByRecord('rec-1');
    expect(entries).toHaveLength(3);
    // line entries first, then tax
    expect(entries[0].entry_type).toBe('line');
    expect(entries[2].entry_type).toBe('tax');
  });
});
