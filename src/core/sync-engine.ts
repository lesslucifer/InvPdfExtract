import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { insertFile, getFileByPath, updateFileHash, softDeleteFile, getAllActiveFiles } from './db/files';
import { eventBus } from './event-bus';
import { FILE_TYPE_MAP } from '../shared/constants';
import { WatcherEvent } from './watcher';
import { log, LogModule } from './logger';

export class SyncEngine {
  private vaultRoot: string;

  constructor(vaultRoot: string) {
    this.vaultRoot = vaultRoot;
  }

  async handleEvent(event: WatcherEvent, relativePath: string, fullPath: string): Promise<void> {
    try {
      switch (event) {
        case 'file:added':
          await this.handleFileAdded(relativePath, fullPath);
          break;
        case 'file:changed':
          await this.handleFileChanged(relativePath, fullPath);
          break;
        case 'file:deleted':
          this.handleFileDeleted(relativePath);
          break;
      }
    } catch (err) {
      log.error(LogModule.SyncEngine, `Error handling ${event} for ${relativePath}:`, err);
    }
  }

  private async handleFileAdded(relativePath: string, fullPath: string): Promise<void> {
    // Check if already tracked
    const existing = getFileByPath(relativePath);
    if (existing) {
      // Already in DB — treat as change
      await this.handleFileChanged(relativePath, fullPath);
      return;
    }

    const hash = await hashFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const fileType = FILE_TYPE_MAP[ext] || 'unknown';
    const stats = await fs.promises.stat(fullPath);

    insertFile(relativePath, hash, fileType, stats.size);

    eventBus.emit('file:added', { relativePath, fullPath });
    log.info(LogModule.SyncEngine, `Added: ${relativePath} (hash: ${hash.slice(0, 8)}...)`);
  }

  private async handleFileChanged(relativePath: string, fullPath: string): Promise<void> {
    const existing = getFileByPath(relativePath);
    if (!existing) {
      // Not tracked yet, treat as add
      await this.handleFileAdded(relativePath, fullPath);
      return;
    }
    const newHash = await hashFile(fullPath);
    if (newHash === existing.file_hash) {
      // No actual content change
      return;
    }

    const stats = await fs.promises.stat(fullPath);
    updateFileHash(existing.id, newHash, stats.size);

    eventBus.emit('file:changed', { relativePath, fullPath });
    log.info(LogModule.SyncEngine, `Changed: ${relativePath} (hash: ${newHash.slice(0, 8)}...)`);
  }

  private handleFileDeleted(relativePath: string): void {
    const existing = getFileByPath(relativePath);
    if (!existing) return;

    softDeleteFile(existing.id);

    eventBus.emit('file:deleted', { relativePath });
    log.info(LogModule.SyncEngine, `Deleted: ${relativePath}`);
  }

  async reconcileMissingFiles(): Promise<void> {
    const activeFiles = getAllActiveFiles();
    for (const file of activeFiles) {
      const fullPath = path.join(this.vaultRoot, file.relative_path);
      const exists = await fs.promises.access(fullPath).then(() => true).catch(() => false);
      if (!exists) {
        softDeleteFile(file.id);
        eventBus.emit('file:deleted', { relativePath: file.relative_path });
        log.info(LogModule.SyncEngine, `Reconciled missing file: ${file.relative_path}`);
      }
    }
  }
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
