import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createInMemoryDb } from '../../__tests__/helpers/mock-db';
import { BatchStatus, DocType, FileStatus } from '../../shared/types';

// Mock getDatabase to return our in-memory db
vi.mock('./database', () => ({
  getDatabase: () => _testDb,
}));

let _testDb: Database.Database;

// Import after mock is set up
import {
  insertFile,
  getFilesByStatus,
  getFilesByStatuses,
  getFileById,
  updateFileStatus,
  updateFileHash,
  resetStaleProcessingFiles,
  cancelQueueItem,
  clearPendingQueue,
  updateFileFilterResult,
  getSkippedFiles,
  getFolderStatuses,
} from './files';
import { createBatch, insertRecord, getRecordsByFileId } from './records';

describe('resetStaleProcessingFiles', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('resets processing files back to pending', () => {
    const f1 = insertFile('a.pdf', 'hash1', 'pdf', 100);
    const f2 = insertFile('b.pdf', 'hash2', 'pdf', 200);
    updateFileStatus(f1.id, FileStatus.Processing);
    updateFileStatus(f2.id, FileStatus.Processing);

    const count = resetStaleProcessingFiles();

    expect(count).toBe(2);
    expect(getFilesByStatus(FileStatus.Pending)).toHaveLength(2);
    expect(getFilesByStatus(FileStatus.Processing)).toHaveLength(0);
  });

  it('does not touch files in other statuses', () => {
    const f1 = insertFile('a.pdf', 'hash1', 'pdf', 100);
    const f2 = insertFile('b.pdf', 'hash2', 'pdf', 200);
    insertFile('c.pdf', 'hash3', 'pdf', 300);
    updateFileStatus(f1.id, FileStatus.Done);
    updateFileStatus(f2.id, FileStatus.Error);
    // f3 stays unfiltered

    const count = resetStaleProcessingFiles();

    expect(count).toBe(0);
    expect(getFilesByStatus(FileStatus.Done)).toHaveLength(1);
    expect(getFilesByStatus(FileStatus.Error)).toHaveLength(1);
    expect(getFilesByStatus(FileStatus.Unfiltered)).toHaveLength(1);
  });

  it('does not touch soft-deleted processing files', () => {
    const f1 = insertFile('a.pdf', 'hash1', 'pdf', 100);
    updateFileStatus(f1.id, FileStatus.Processing);
    // Soft-delete
    _testDb.prepare("UPDATE files SET deleted_at = datetime('now') WHERE id = ?").run(f1.id);

    const count = resetStaleProcessingFiles();

    expect(count).toBe(0);
  });

  it('returns 0 when no files exist', () => {
    const count = resetStaleProcessingFiles();
    expect(count).toBe(0);
  });
});

describe('cancelQueueItem', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('soft-deletes a brand-new pending file with no records', () => {
    const file = insertFile('new.pdf', 'hash1', 'pdf', 100);
    // file starts as Unfiltered, no records linked

    const result = cancelQueueItem(file.id);

    expect(result).toBe(true);
    const after = getFileById(file.id);
    expect(after?.deleted_at).not.toBeNull();
    expect(getFilesByStatus(FileStatus.Pending)).toHaveLength(0);
  });

  it('reverts a re-queued file with records back to Done instead of deleting', () => {
    // Simulate: file was processed, has records, then re-queued
    const file = insertFile('processed.pdf', 'hash1', 'pdf', 100);
    updateFileStatus(file.id, FileStatus.Done);
    const batch = createBatch(file.id, BatchStatus.Success,  1, 0.95, null, null);
    const record = insertRecord(batch.id, file.id, DocType.InvoiceIn, 'fp1', 0.95, '2026-01-01', {}, {});

    // File content changed — re-queued
    updateFileHash(file.id, 'hash2', 100);
    expect(getFilesByStatus(FileStatus.Unfiltered)).toHaveLength(1);

    // User cancels from queue
    const result = cancelQueueItem(file.id);

    expect(result).toBe(true);
    const after = getFileById(file.id);
    expect(after?.status).toBe(FileStatus.Done);
    expect(after?.deleted_at).toBeNull();

    // Records must still be intact
    const records = getRecordsByFileId(file.id);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(record.id);
  });

  it('returns false for a non-pending file', () => {
    const file = insertFile('done.pdf', 'hash1', 'pdf', 100);
    updateFileStatus(file.id, FileStatus.Done);

    const result = cancelQueueItem(file.id);

    expect(result).toBe(false);
    expect(getFileById(file.id)?.status).toBe(FileStatus.Done);
  });

  it('returns false for a non-existent file', () => {
    expect(cancelQueueItem('non-existent-id')).toBe(false);
  });
});

describe('clearPendingQueue', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('handles mixed pending files: reverts those with records, deletes those without', () => {
    // File with records (previously processed, re-queued)
    const processed = insertFile('processed.pdf', 'hash1', 'pdf', 100);
    updateFileStatus(processed.id, FileStatus.Done);
    const batch = createBatch(processed.id, BatchStatus.Success, 1, 0.9, null, null);
    insertRecord(batch.id, processed.id, DocType.InvoiceIn, 'fp1', 0.9, '2026-01-01', {}, {});
    updateFileHash(processed.id, 'hash1b', 100); // re-queue

    // Brand new file (no records)
    const brandNew = insertFile('new.pdf', 'hash2', 'pdf', 200);

    expect(getFilesByStatuses([FileStatus.Unfiltered, FileStatus.Pending])).toHaveLength(2);

    const count = clearPendingQueue();

    expect(count).toBe(2);
    expect(getFilesByStatus(FileStatus.Pending)).toHaveLength(0);

    // Processed file reverted to Done with records intact
    const processedAfter = getFileById(processed.id);
    expect(processedAfter?.status).toBe(FileStatus.Done);
    expect(processedAfter?.deleted_at).toBeNull();
    expect(getRecordsByFileId(processed.id)).toHaveLength(1);

    // Brand new file soft-deleted
    const newAfter = getFileById(brandNew.id);
    expect(newAfter?.deleted_at).not.toBeNull();
  });

  it('returns 0 when no pending files exist', () => {
    const file = insertFile('done.pdf', 'hash1', 'pdf', 100);
    updateFileStatus(file.id, FileStatus.Done);

    expect(clearPendingQueue()).toBe(0);
  });
});

describe('updateFileFilterResult', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('sets status, filter_score, filter_reason, and filter_layer', () => {
    const file = insertFile('a.pdf', 'hash1', 'pdf', 1024);

    updateFileFilterResult(file.id, FileStatus.Skipped, 0.25, 'No relevant keywords found', 2);

    const updated = getFileById(file.id)!;
    expect(updated.status).toBe(FileStatus.Skipped);
    expect(updated.filter_score).toBeCloseTo(0.25);
    expect(updated.filter_reason).toBe('No relevant keywords found');
    expect(updated.filter_layer).toBe(2);
  });

  it('can set status to Pending when file passes filter', () => {
    const file = insertFile('hoa_don.pdf', 'hash2', 'pdf', 2048);

    updateFileFilterResult(file.id, FileStatus.Pending, 0.85, 'Filename matches invoice pattern', 1);

    const updated = getFileById(file.id)!;
    expect(updated.status).toBe(FileStatus.Pending);
    expect(updated.filter_score).toBeCloseTo(0.85);
    expect(updated.filter_layer).toBe(1);
  });
});

describe('getSkippedFiles', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('returns only skipped, non-deleted files', () => {
    const f1 = insertFile('a.pdf', 'hash1', 'pdf', 1024);
    const f2 = insertFile('b.pdf', 'hash2', 'pdf', 1024);
    const f3 = insertFile('c.pdf', 'hash3', 'pdf', 1024);

    updateFileFilterResult(f1.id, FileStatus.Skipped, 0.2, 'irrelevant', 1);
    updateFileFilterResult(f2.id, FileStatus.Skipped, 0.3, 'irrelevant', 2);
    updateFileStatus(f3.id, FileStatus.Done);

    const skipped = getSkippedFiles();
    expect(skipped).toHaveLength(2);
    expect(skipped.map(f => f.id)).toEqual(expect.arrayContaining([f1.id, f2.id]));
  });

  it('excludes soft-deleted skipped files', () => {
    const file = insertFile('a.pdf', 'hash1', 'pdf', 1024);
    updateFileFilterResult(file.id, FileStatus.Skipped, 0.1, 'irrelevant', 1);
    _testDb.prepare("UPDATE files SET deleted_at = datetime('now') WHERE id = ?").run(file.id);

    expect(getSkippedFiles()).toHaveLength(0);
  });

  it('returns empty array when no skipped files', () => {
    insertFile('a.pdf', 'hash1', 'pdf', 1024);
    expect(getSkippedFiles()).toHaveLength(0);
  });
});

describe('STATUS_PRIORITY includes Skipped', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('skipped file does not override done in folder aggregation', () => {
    const f1 = insertFile('folder/done.pdf', 'hash1', 'pdf', 1024);
    const f2 = insertFile('folder/skipped.pdf', 'hash2', 'pdf', 1024);
    updateFileStatus(f1.id, FileStatus.Done);
    updateFileFilterResult(f2.id, FileStatus.Skipped, 0.1, 'irrelevant', 1);

    // Done (priority 4) should win over Skipped (priority 5)
    const statuses = getFolderStatuses();
    expect(statuses['folder']).toBe(FileStatus.Done);
  });
});
