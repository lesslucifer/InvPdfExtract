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
  _testDb.exec(`INSERT INTO invoice_data (record_id, so_hoa_don, mst, ten_doi_tac) VALUES ('rec-1', 'INV-001', '0123456789', 'Cong ty ABC')`);
  _testDb.exec(`INSERT INTO invoice_line_items (id, record_id, line_number, mo_ta, don_gia, so_luong, thue_suat, thanh_tien_truoc_thue, thanh_tien) VALUES ('li-1', 'rec-1', 1, 'Van phong pham', 50000, 10, 10, 500000, 550000)`);
  _testDb.exec(`INSERT INTO invoice_line_items (id, record_id, line_number, mo_ta, don_gia, so_luong, thue_suat, thanh_tien_truoc_thue, thanh_tien) VALUES ('li-2', 'rec-1', 2, 'Dich vu tu van', 200000, 1, 10, 200000, 220000)`);
}

describe('JEGenerator', () => {
  let similarityEngine: JESimilarityEngine;
  let generator: JEGenerator;

  beforeEach(() => {
    _testDb = createInMemoryDb();
    seedData();
    vi.clearAllMocks();

    similarityEngine = new JESimilarityEngine(0.9, 1000);
    // Don't call initialize — it would try to query DB for cache which has no JEs yet
    generator = new JEGenerator('/tmp/test-vault', similarityEngine, undefined);
  });

  afterEach(() => {
    similarityEngine.destroy();
    _testDb.close();
  });

  it('generates JEs for invoice line items via AI fallback', async () => {
    // No similarity matches (empty cache), so all items go to AI
    mockClassifyWithAI.mockResolvedValue(new Map([
      ['li-1', { lineItemId: 'li-1', entryType: 'line', tkNo: '6422', tkCo: '331', cashFlow: 'operating' }],
      ['li-2', { lineItemId: 'li-2', entryType: 'line', tkNo: '642', tkCo: '331', cashFlow: 'operating' }],
    ]));

    const count = await generator.generateForRecord('rec-1');

    // 2 line entries + 2 tax entries (both items have thue_suat = 10)
    expect(count).toBe(4);

    const entries = getJournalEntriesByRecord('rec-1');
    expect(entries).toHaveLength(4);

    const lineEntries = entries.filter(e => e.entry_type === 'line');
    expect(lineEntries).toHaveLength(2);

    const taxEntries = entries.filter(e => e.entry_type === 'tax');
    expect(taxEntries).toHaveLength(2);
    // Tax entries should use TK 1331 for invoice_in
    expect(taxEntries[0].tk_no).toBe('1331');
    expect(taxEntries[0].tk_co).toBe('331');
  });

  it('generates tax entries with correct amounts', async () => {
    mockClassifyWithAI.mockResolvedValue(new Map([
      ['li-1', { lineItemId: 'li-1', entryType: 'line', tkNo: '156', tkCo: '331', cashFlow: 'operating' }],
      ['li-2', { lineItemId: 'li-2', entryType: 'line', tkNo: '642', tkCo: '331', cashFlow: 'operating' }],
    ]));

    await generator.generateForRecord('rec-1');

    const entries = getJournalEntriesByRecord('rec-1');
    const taxEntries = entries.filter(e => e.entry_type === 'tax');

    // li-1: thanh_tien (550000) - thanh_tien_truoc_thue (500000) = 50000
    const li1Tax = taxEntries.find(e => e.line_item_id === 'li-1');
    expect(li1Tax!.amount).toBe(50000);

    // li-2: 220000 - 200000 = 20000
    const li2Tax = taxEntries.find(e => e.line_item_id === 'li-2');
    expect(li2Tax!.amount).toBe(20000);
  });

  it('preserves user-edited entries on regeneration', async () => {
    // First generation
    mockClassifyWithAI.mockResolvedValue(new Map([
      ['li-1', { lineItemId: 'li-1', entryType: 'line', tkNo: '156', tkCo: '331', cashFlow: 'operating' }],
      ['li-2', { lineItemId: 'li-2', entryType: 'line', tkNo: '642', tkCo: '331', cashFlow: 'operating' }],
    ]));
    await generator.generateForRecord('rec-1');

    // User edits li-1's JE
    const entries = getJournalEntriesByRecord('rec-1');
    const li1Entry = entries.find(e => e.line_item_id === 'li-1' && e.entry_type === 'line');
    _testDb.prepare('UPDATE journal_entries SET user_edited = 1, tk_no = ?, source = ? WHERE id = ?').run('6423', 'user', li1Entry!.id);

    // Second generation
    mockClassifyWithAI.mockResolvedValue(new Map([
      ['li-2', { lineItemId: 'li-2', entryType: 'line', tkNo: '642', tkCo: '331', cashFlow: 'operating' }],
    ]));
    await generator.generateForRecord('rec-1');

    const updated = getJournalEntriesByRecord('rec-1');
    const userEdited = updated.find(e => e.line_item_id === 'li-1' && e.entry_type === 'line');
    expect(userEdited).toBeTruthy();
    expect(userEdited!.tk_no).toBe('6423');
    expect(userEdited!.user_edited).toBe(1);
  });

  it('calls AI classifier with correct item data', async () => {
    mockClassifyWithAI.mockResolvedValue(new Map());

    await generator.generateForRecord('rec-1');

    expect(mockClassifyWithAI).toHaveBeenCalledTimes(1);
    const items = mockClassifyWithAI.mock.calls[0][0];
    expect(items).toHaveLength(2);
    expect(items[0].moTa).toBe('Van phong pham');
    expect(items[0].tenDoiTac).toBe('Cong ty ABC');
    expect(items[0].mst).toBe('0123456789');
    expect(items[0].thueSuat).toBe(10);
  });

  it('handles empty record gracefully', async () => {
    // Record with no line items
    _testDb.exec(`INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence) VALUES ('rec-empty', 'batch-1', 'file-1', 'invoice_in', 'fp-empty', 0.9)`);

    const count = await generator.generateForRecord('rec-empty');
    expect(count).toBe(0);
    expect(mockClassifyWithAI).not.toHaveBeenCalled();
  });

  it('handles bank statement records', async () => {
    _testDb.exec(`INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence) VALUES ('bank-1', 'batch-1', 'file-1', 'bank_statement', 'fp-bank', 0.9)`);
    _testDb.exec(`INSERT INTO bank_statement_data (record_id, mo_ta, so_tien, ten_doi_tac) VALUES ('bank-1', 'Thanh toan tien hang', 5000000, 'NCC XYZ')`);

    mockClassifyWithAI.mockResolvedValue(new Map([
      ['bank-1', { lineItemId: 'bank-1', entryType: 'bank', tkNo: '331', tkCo: '112', cashFlow: 'operating' }],
    ]));

    const count = await generator.generateForRecord('bank-1');
    expect(count).toBe(1);

    const entries = getJournalEntriesByRecord('bank-1');
    expect(entries[0].entry_type).toBe('bank');
    expect(entries[0].tk_no).toBe('331');
    expect(entries[0].tk_co).toBe('112');
    expect(entries[0].line_item_id).toBeNull();
  });

  it('skips records already being processed (concurrency guard)', async () => {
    // Simulate concurrent calls
    let resolveFirst: () => void;
    const blockingPromise = new Promise<Map<string, any>>(resolve => {
      resolveFirst = () => resolve(new Map());
    });
    mockClassifyWithAI.mockReturnValueOnce(blockingPromise as any);

    const first = generator.generateForRecord('rec-1');
    const second = await generator.generateForRecord('rec-1'); // Should return 0 immediately
    expect(second).toBe(0);

    resolveFirst!();
    await first;
  });
});
