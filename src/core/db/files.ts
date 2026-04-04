import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';
import { VaultFile, FileStatus } from '../../shared/types';

export function insertFile(relativePath: string, fileHash: string, fileType: string, fileSize: number): VaultFile {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Check for soft-deleted file with same path — resurrect instead of re-insert
  const deleted = db.prepare(
    'SELECT id FROM files WHERE relative_path = ? AND deleted_at IS NOT NULL'
  ).get(relativePath) as { id: string } | undefined;

  if (deleted) {
    db.prepare(`
      UPDATE files SET file_hash = ?, file_type = ?, file_size = ?, status = ?, deleted_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(fileHash, fileType, fileSize, FileStatus.Pending, now, deleted.id);
    return getFileById(deleted.id)!;
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO files (id, relative_path, file_hash, file_type, file_size, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, relativePath, fileHash, fileType, fileSize, FileStatus.Pending, now, now);

  return getFileById(id)!;
}

export function getFileById(id: string): VaultFile | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id) as VaultFile | undefined;
}

export function getFileByPath(relativePath: string): VaultFile | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM files WHERE relative_path = ? AND deleted_at IS NULL').get(relativePath) as VaultFile | undefined;
}

export function getFileByHash(fileHash: string): VaultFile | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM files WHERE file_hash = ? AND deleted_at IS NULL').get(fileHash) as VaultFile | undefined;
}

export function getFilesByStatus(status: FileStatus): VaultFile[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM files WHERE status = ? AND deleted_at IS NULL').all(status) as VaultFile[];
}

export function updateFileHash(id: string, newHash: string, fileSize: number): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE files SET file_hash = ?, file_size = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newHash, fileSize, FileStatus.Pending, id);
}

export function updateFileStatus(id: string, status: FileStatus): void {
  const db = getDatabase();
  db.prepare("UPDATE files SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export function updateFileDocType(id: string, docType: string): void {
  const db = getDatabase();
  db.prepare("UPDATE files SET doc_type = ?, updated_at = datetime('now') WHERE id = ?").run(docType, id);
}

export function updateFilePath(id: string, newPath: string): void {
  const db = getDatabase();
  db.prepare("UPDATE files SET relative_path = ?, updated_at = datetime('now') WHERE id = ?").run(newPath, id);
}

export function softDeleteFile(id: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const txn = db.transaction(() => {
    db.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').run(now, id);
    // Cascade soft-delete to records and line items
    const records = db.prepare('SELECT id FROM records WHERE file_id = ? AND deleted_at IS NULL').all(id) as { id: string }[];
    for (const record of records) {
      db.prepare('UPDATE records SET deleted_at = ? WHERE id = ?').run(now, record.id);
      db.prepare('UPDATE invoice_line_items SET deleted_at = ? WHERE record_id = ?').run(now, record.id);
    }
  });

  txn();
}

export function getFilesByFolder(folderPrefix: string): VaultFile[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM files WHERE relative_path LIKE ? AND deleted_at IS NULL').all(`${folderPrefix}/%`) as VaultFile[];
}

export function getAllActiveFiles(): VaultFile[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM files WHERE deleted_at IS NULL').all() as VaultFile[];
}

export function cancelQueueItem(fileId: string): boolean {
  const db = getDatabase();
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND status = ? AND deleted_at IS NULL')
    .get(fileId, FileStatus.Pending) as VaultFile | undefined;
  if (!file) return false;

  const { cnt } = db.prepare(
    'SELECT COUNT(*) as cnt FROM records WHERE file_id = ? AND deleted_at IS NULL'
  ).get(fileId) as { cnt: number };

  if (cnt > 0) {
    // Previously processed — revert to Done, preserving all records
    db.prepare("UPDATE files SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(FileStatus.Done, fileId);
  } else {
    // Brand new file, no records — safe to soft-delete the file only
    db.prepare("UPDATE files SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(fileId);
  }
  return true;
}

export function clearPendingQueue(): number {
  const db = getDatabase();
  const pending = db.prepare('SELECT id FROM files WHERE status = ? AND deleted_at IS NULL')
    .all(FileStatus.Pending) as { id: string }[];
  for (const row of pending) {
    cancelQueueItem(row.id);
  }
  return pending.length;
}

export function resetStaleProcessingFiles(): number {
  const db = getDatabase();
  const result = db.prepare(
    "UPDATE files SET status = ?, updated_at = datetime('now') WHERE status = ? AND deleted_at IS NULL"
  ).run(FileStatus.Pending, FileStatus.Processing);
  return result.changes;
}

export function getFilesByStatuses(statuses: FileStatus[]): VaultFile[] {
  const db = getDatabase();
  const placeholders = statuses.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM files WHERE status IN (${placeholders}) AND deleted_at IS NULL ORDER BY updated_at DESC`
  ).all(...statuses) as VaultFile[];
}

export function getFileStatusesByPaths(paths: string[]): Record<string, FileStatus> {
  if (paths.length === 0) return {};
  const db = getDatabase();
  const placeholders = paths.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT relative_path, status FROM files WHERE relative_path IN (${placeholders}) AND deleted_at IS NULL`
  ).all(...paths) as { relative_path: string; status: FileStatus }[];
  const result: Record<string, FileStatus> = {};
  for (const r of rows) result[r.relative_path] = r.status;
  return result;
}

const STATUS_PRIORITY: Record<string, number> = {
  [FileStatus.Processing]: 0,
  [FileStatus.Error]: 1,
  [FileStatus.Review]: 2,
  [FileStatus.Pending]: 3,
  [FileStatus.Done]: 4,
};

export function getFolderStatuses(): Record<string, FileStatus> {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT relative_path, status FROM files WHERE deleted_at IS NULL`
  ).all() as { relative_path: string; status: FileStatus }[];

  // Group by top-level folder and derive aggregate status
  const folderStatuses: Record<string, FileStatus> = {};
  for (const row of rows) {
    const slashIdx = row.relative_path.indexOf('/');
    if (slashIdx === -1) continue; // file at root, skip folder aggregation
    const folder = row.relative_path.substring(0, slashIdx);
    const existing = folderStatuses[folder];
    if (!existing || (STATUS_PRIORITY[row.status] ?? 5) < (STATUS_PRIORITY[existing] ?? 5)) {
      folderStatuses[folder] = row.status;
    }
  }
  return folderStatuses;
}
