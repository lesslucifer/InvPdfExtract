import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';
import { VaultFile, FileStatus } from '../../shared/types';

export function insertFile(relativePath: string, fileHash: string, fileType: string, fileSize: number): VaultFile {
  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();

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
