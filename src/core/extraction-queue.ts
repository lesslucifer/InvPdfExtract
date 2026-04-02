import * as path from 'path';
import { getFilesByStatus, updateFileStatus } from './db/files';
import { addLog } from './db/records';
import { ClaudeCodeRunner } from './claude-cli';
import { Reconciler } from './reconciler';
import { eventBus } from './event-bus';
import { FileStatus, LogLevel, VaultHandle } from '../shared/types';
import { DEFAULT_BATCH_SIZE, INVOICEVAULT_DIR } from '../shared/constants';

export class ExtractionQueue {
  private runner: ClaudeCodeRunner;
  private reconciler: Reconciler;
  private vault: VaultHandle;
  private batchSize: number;
  private processing = false;
  private pendingTrigger = false;

  constructor(vault: VaultHandle, cliPath?: string, cliTimeout?: number) {
    this.vault = vault;
    this.runner = new ClaudeCodeRunner(cliPath, cliTimeout);
    this.reconciler = new Reconciler(vault.config.confidence_threshold);
    this.batchSize = DEFAULT_BATCH_SIZE;
  }

  trigger(): void {
    if (this.processing) {
      this.pendingTrigger = true;
      return;
    }
    this.processQueue().catch(err => {
      console.error('[ExtractionQueue] Unhandled error:', err);
    });
  }

  private async processQueue(): Promise<void> {
    this.processing = true;

    try {
      while (true) {
        const pendingFiles = getFilesByStatus(FileStatus.Pending);
        if (pendingFiles.length === 0) break;

        // Take a batch
        const batch = pendingFiles.slice(0, this.batchSize);
        const fileIds = batch.map(f => f.id);
        const filePaths = batch.map(f => path.join(this.vault.rootPath, f.relative_path));

        console.log(`[ExtractionQueue] Processing batch of ${batch.length} files`);
        eventBus.emit('extraction:started', { fileIds });

        // Mark as processing
        for (const file of batch) {
          updateFileStatus(file.id, FileStatus.Processing);
        }

        try {
          const systemPromptPath = path.join(this.vault.dotPath, 'extraction-prompt.md');
          const { result, sessionLog } = await this.runner.processFiles(filePaths, this.vault.rootPath, systemPromptPath);

          // Reconcile results
          this.reconciler.reconcileResults(result, sessionLog);

          // Handle files that weren't included in results (CLI may have skipped them)
          for (const file of batch) {
            const hasResult = result.results.some(r => r.relative_path === file.relative_path);
            if (!hasResult) {
              updateFileStatus(file.id, FileStatus.Error);
              addLog(null, LogLevel.Error, `No extraction result returned for ${file.relative_path}`);
              eventBus.emit('extraction:error', {
                fileId: file.id,
                error: 'No result returned from Claude CLI',
              });
            }
          }
        } catch (err) {
          console.error('[ExtractionQueue] Batch processing error:', err);
          // Mark all files in batch as error
          for (const file of batch) {
            updateFileStatus(file.id, FileStatus.Error);
            addLog(null, LogLevel.Error, `Batch error for ${file.relative_path}: ${(err as Error).message}`);
            eventBus.emit('extraction:error', {
              fileId: file.id,
              error: (err as Error).message,
            });
          }
        }
      }
    } finally {
      this.processing = false;
      if (this.pendingTrigger) {
        this.pendingTrigger = false;
        this.trigger();
      }
    }
  }

  isProcessing(): boolean {
    return this.processing;
  }
}
