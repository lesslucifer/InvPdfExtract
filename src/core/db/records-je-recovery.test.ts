import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createInMemoryDb } from '../../__tests__/helpers/mock-db';
import { DocType, BatchStatus } from '../../shared/types';

vi.mock('./database', () => ({
  getDatabase: () => _testDb,
}));

let _testDb: Database.Database;

import { insertFile } from './files';
import {
  createBatch,
  insertRecord,
  updateJeStatus,
  resetStaleJeProcessing,
  getPendingJeRecordIds,
} from './records';

function createTestRecord(fileId: string): string {
  const batch = createBatch(fileId, BatchStatus.Success, 1, 1, null, null);
  const record = insertRecord(batch.id, fileId, DocType.InvoiceIn, 'fp', 1, null, {}, {});
  return record.id;
}

describe('resetStaleJeProcessing', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('resets processing JE records back to pending', () => {
    const file = insertFile('a.pdf', 'hash1', 'pdf', 100);
    const r1 = createTestRecord(file.id);
    const r2 = createTestRecord(file.id);
    updateJeStatus([r1, r2], 'processing');

    const count = resetStaleJeProcessing();

    expect(count).toBe(2);
    const rows = _testDb.prepare("SELECT je_status FROM records WHERE id IN (?, ?)").all(r1, r2) as Array<{ je_status: string }>;
    expect(rows.every(r => r.je_status === 'pending')).toBe(true);
  });

  it('does not touch records in other JE statuses', () => {
    const file = insertFile('a.pdf', 'hash1', 'pdf', 100);
    const rDone = createTestRecord(file.id);
    const rError = createTestRecord(file.id);
    const rPending = createTestRecord(file.id);
    updateJeStatus([rDone], 'done');
    updateJeStatus([rError], 'error');
    updateJeStatus([rPending], 'pending');

    const count = resetStaleJeProcessing();

    expect(count).toBe(0);
  });

  it('does not touch soft-deleted records', () => {
    const file = insertFile('a.pdf', 'hash1', 'pdf', 100);
    const r1 = createTestRecord(file.id);
    updateJeStatus([r1], 'processing');
    _testDb.prepare("UPDATE records SET deleted_at = datetime('now') WHERE id = ?").run(r1);

    const count = resetStaleJeProcessing();

    expect(count).toBe(0);
  });

  it('returns 0 when no records exist', () => {
    expect(resetStaleJeProcessing()).toBe(0);
  });
});

describe('getPendingJeRecordIds', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('returns only pending JE record IDs', () => {
    const file = insertFile('a.pdf', 'hash1', 'pdf', 100);
    const rPending = createTestRecord(file.id);
    const rDone = createTestRecord(file.id);
    const rProcessing = createTestRecord(file.id);
    updateJeStatus([rPending], 'pending');
    updateJeStatus([rDone], 'done');
    updateJeStatus([rProcessing], 'processing');

    const ids = getPendingJeRecordIds();

    expect(ids).toEqual([rPending]);
  });

  it('excludes soft-deleted records', () => {
    const file = insertFile('a.pdf', 'hash1', 'pdf', 100);
    const r1 = createTestRecord(file.id);
    updateJeStatus([r1], 'pending');
    _testDb.prepare("UPDATE records SET deleted_at = datetime('now') WHERE id = ?").run(r1);

    expect(getPendingJeRecordIds()).toEqual([]);
  });

  it('returns empty array when no pending records', () => {
    expect(getPendingJeRecordIds()).toEqual([]);
  });
});
