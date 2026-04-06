import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createInMemoryDb } from '../__tests__/helpers/mock-db';

vi.mock('./db/database', () => ({
  getDatabase: () => _testDb,
}));

vi.mock('./je-ai-classifier', () => ({
  classifyWithAI: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('./event-bus', () => ({
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));

vi.mock('./je-instructions', () => ({
  readInstructions: vi.fn().mockReturnValue('test instructions'),
}));

let _testDb: Database.Database;

import { JEGenerator } from './je-generator';
import { JESimilarityEngine } from './je-similarity';
import { classifyWithAI } from './je-ai-classifier';
import { getJournalEntriesByRecord } from './db/journal-entries';

const mockClassifyWithAI = vi.mocked(classifyWithAI);

function seedData() {
  _testDb.exec(`INSERT INTO files (id, relative_path, file_hash, file_type, status) VALUES ('file-1', 'test.pdf', 'hash1', 'pdf', 'done')`);
  _testDb.exec(`INSERT INTO extraction_batches (id, file_id, status, record_count, overall_confidence) VALUES ('batch-1', 'file-1', 'success', 1, 0.9)`);
  _testDb.exec(`INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence) VALUES ('rec-1', 'batch-1', 'file-1', 'invoice_in', 'fp-1', 0.9)`);
  _testDb.exec(`INSERT INTO invoice_data (record_id, invoice_number, tax_id, counterparty_name, total_amount) VALUES ('rec-1', 'INV-001', '0123456789', 'Cong ty ABC', 770000)`);
  _testDb.exec(`INSERT INTO invoice_line_items (id, record_id, line_number, description, unit_price, quantity, tax_rate, subtotal, total_with_tax) VALUES ('li-1', 'rec-1', 1, 'Van phong pham', 50000, 10, 10, 500000, 550000)`);
  _testDb.exec(`INSERT INTO invoice_line_items (id, record_id, line_number, description, unit_price, quantity, tax_rate, subtotal, total_with_tax) VALUES ('li-2', 'rec-1', 2, 'Dich vu tu van', 200000, 1, 10, 200000, 220000)`);
}

describe('JEGenerator', () => {
  let similarityEngine: JESimilarityEngine;
  let generator: JEGenerator;

  beforeEach(() => {
    _testDb = createInMemoryDb();
    seedData();
    vi.clearAllMocks();

    similarityEngine = new JESimilarityEngine(0.9, 1000);
    generator = new JEGenerator('/tmp/test-vault', similarityEngine, undefined);
  });

  afterEach(() => {
    similarityEngine.destroy();
    _testDb.close();
  });

  it('generates line entries + auto tax + settlement via AI fallback', async () => {
    mockClassifyWithAI.mockResolvedValue(new Map([
      ['li-1', { lineItemId: 'li-1', account: '6422', cashFlow: 'operating' }],
      ['li-2', { lineItemId: 'li-2', account: '642', cashFlow: 'operating' }],
    ]));

    const count = await generator.generateForRecord('rec-1');

    // 2 line entries + 1 tax entry + 1 settlement entry = 4
    expect(count).toBe(4);

    const entries = getJournalEntriesByRecord('rec-1');
    expect(entries).toHaveLength(4);

    const lineEntries = entries.filter(e => e.entry_type === 'line');
    expect(lineEntries).toHaveLength(2);
    expect(lineEntries[0].account).toBe('6422');
    expect(lineEntries[1].account).toBe('642');

    // Single combined tax entry (invoice_in → 1331)
    const taxEntries = entries.filter(e => e.entry_type === 'tax');
    expect(taxEntries).toHaveLength(1);
    expect(taxEntries[0].account).toBe('1331');
    expect(taxEntries[0].line_item_id).toBeNull();

    // Settlement entry (invoice_in → 331)
    const settlementEntries = entries.filter(e => e.entry_type === 'settlement');
    expect(settlementEntries).toHaveLength(1);
    expect(settlementEntries[0].account).toBe('331');
    expect(settlementEntries[0].line_item_id).toBeNull();
  });

  it('preserves user-edited entries on regeneration', async () => {
    // First generation
    mockClassifyWithAI.mockResolvedValue(new Map([
      ['li-1', { lineItemId: 'li-1', account: '156', cashFlow: 'operating' }],
      ['li-2', { lineItemId: 'li-2', account: '642', cashFlow: 'operating' }],
    ]));
    await generator.generateForRecord('rec-1');

    // User edits li-1's JE
    const entries = getJournalEntriesByRecord('rec-1');
    const li1Entry = entries.find(e => e.line_item_id === 'li-1' && e.entry_type === 'line');
    _testDb.prepare('UPDATE journal_entries SET user_edited = 1, account = ?, source = ? WHERE id = ?').run('6423', 'user', li1Entry!.id);

    // Second generation
    mockClassifyWithAI.mockResolvedValue(new Map([
      ['li-2', { lineItemId: 'li-2', account: '642', cashFlow: 'operating' }],
    ]));
    await generator.generateForRecord('rec-1');

    const updated = getJournalEntriesByRecord('rec-1');
    const userEdited = updated.find(e => e.line_item_id === 'li-1' && e.entry_type === 'line');
    expect(userEdited).toBeTruthy();
    expect(userEdited!.account).toBe('6423');
    expect(userEdited!.user_edited).toBe(1);
  });

  it('calls AI classifier with correct item data', async () => {
    mockClassifyWithAI.mockResolvedValue(new Map());

    await generator.generateForRecord('rec-1');

    expect(mockClassifyWithAI).toHaveBeenCalledTimes(1);
    const items = mockClassifyWithAI.mock.calls[0][0];
    expect(items).toHaveLength(2);
    expect(items[0].description).toBe('Van phong pham');
    expect(items[0].counterpartyName).toBe('Cong ty ABC');
    expect(items[0].taxId).toBe('0123456789');
    expect(items[0].taxRate).toBe(10);
  });

  it('handles empty record gracefully', async () => {
    _testDb.exec(`INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence) VALUES ('rec-empty', 'batch-1', 'file-1', 'invoice_in', 'fp-empty', 0.9)`);

    const count = await generator.generateForRecord('rec-empty');
    expect(count).toBe(0);
    expect(mockClassifyWithAI).not.toHaveBeenCalled();
  });

  it('handles bank statement records', async () => {
    _testDb.exec(`INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence) VALUES ('bank-1', 'batch-1', 'file-1', 'bank_statement', 'fp-bank', 0.9)`);
    _testDb.exec(`INSERT INTO bank_statement_data (record_id, description, amount, counterparty_name) VALUES ('bank-1', 'Thanh toan tien hang', 5000000, 'NCC XYZ')`);

    mockClassifyWithAI.mockResolvedValue(new Map([
      ['bank-1', { lineItemId: 'bank-1', account: '331', cashFlow: 'operating' }],
    ]));

    const count = await generator.generateForRecord('bank-1');
    expect(count).toBe(1);

    const entries = getJournalEntriesByRecord('bank-1');
    expect(entries[0].entry_type).toBe('bank');
    expect(entries[0].account).toBe('331');
    expect(entries[0].line_item_id).toBeNull();
  });

  it('skips records already being processed (concurrency guard)', async () => {
    let resolveFirst: () => void;
    const blockingPromise = new Promise<Map<string, any>>(resolve => {
      resolveFirst = () => resolve(new Map());
    });
    mockClassifyWithAI.mockReturnValueOnce(blockingPromise as any);

    const first = generator.generateForRecord('rec-1');
    const second = await generator.generateForRecord('rec-1');
    expect(second).toBe(0);

    resolveFirst!();
    await first;
  });

  it('generates invoice_out entries with correct default accounts', async () => {
    _testDb.exec(`INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence) VALUES ('rec-out', 'batch-1', 'file-1', 'invoice_out', 'fp-out', 0.9)`);
    _testDb.exec(`INSERT INTO invoice_data (record_id, invoice_number, total_amount) VALUES ('rec-out', 'OUT-001', 550000)`);
    _testDb.exec(`INSERT INTO invoice_line_items (id, record_id, line_number, description, unit_price, quantity, tax_rate, subtotal, total_with_tax) VALUES ('li-out', 'rec-out', 1, 'Ban hang', 500000, 1, 10, 500000, 550000)`);

    mockClassifyWithAI.mockResolvedValue(new Map([
      ['li-out', { lineItemId: 'li-out', account: '511', cashFlow: 'operating' }],
    ]));

    await generator.generateForRecord('rec-out');

    const entries = getJournalEntriesByRecord('rec-out');
    const tax = entries.find(e => e.entry_type === 'tax');
    const settlement = entries.find(e => e.entry_type === 'settlement');

    // invoice_out: tax → 3331, settlement → 131
    expect(tax!.account).toBe('3331');
    expect(settlement!.account).toBe('131');
  });

  it('does not create tax entry when no taxable line items', async () => {
    _testDb.exec(`INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence) VALUES ('rec-notax', 'batch-1', 'file-1', 'invoice_in', 'fp-notax', 0.9)`);
    _testDb.exec(`INSERT INTO invoice_data (record_id, invoice_number, total_amount) VALUES ('rec-notax', 'NT-001', 100000)`);
    _testDb.exec(`INSERT INTO invoice_line_items (id, record_id, line_number, description, unit_price, quantity, tax_rate, subtotal, total_with_tax) VALUES ('li-notax', 'rec-notax', 1, 'Hang hoa', 100000, 1, 0, 100000, 100000)`);

    mockClassifyWithAI.mockResolvedValue(new Map([
      ['li-notax', { lineItemId: 'li-notax', account: '156', cashFlow: 'operating' }],
    ]));

    await generator.generateForRecord('rec-notax');

    const entries = getJournalEntriesByRecord('rec-notax');
    const taxEntries = entries.filter(e => e.entry_type === 'tax');
    expect(taxEntries).toHaveLength(0);

    // Should still have settlement
    const settlement = entries.filter(e => e.entry_type === 'settlement');
    expect(settlement).toHaveLength(1);
  });
});
