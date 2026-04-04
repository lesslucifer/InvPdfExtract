import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createInMemoryDb } from '../../__tests__/helpers/mock-db';
import { FileStatus } from '../../shared/types';

// Mock getDatabase to return our in-memory db
vi.mock('./database', () => ({
  getDatabase: () => _testDb,
}));

let _testDb: Database.Database;

// Import after mock is set up
import {
  insertFile,
  getFilesByStatus,
  updateFileStatus,
  resetStaleProcessingFiles,
} from './files';

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
    const f3 = insertFile('c.pdf', 'hash3', 'pdf', 300);
    updateFileStatus(f1.id, FileStatus.Done);
    updateFileStatus(f2.id, FileStatus.Error);
    // f3 stays pending

    const count = resetStaleProcessingFiles();

    expect(count).toBe(0);
    expect(getFilesByStatus(FileStatus.Done)).toHaveLength(1);
    expect(getFilesByStatus(FileStatus.Error)).toHaveLength(1);
    expect(getFilesByStatus(FileStatus.Pending)).toHaveLength(1);
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
