import * as path from 'path';
import { getFilesByStatus, updateFileStatus } from './db/files';
import { addLog } from './db/records';
import { ClaudeCodeRunner } from './claude-cli';
import { Reconciler } from './reconciler';
import { ScriptRegistry } from './script-registry';
import { MatcherEvaluator } from './matcher-evaluator';
import { executeScript } from './script-sandbox';
import { parseXmlInvoice } from './parsers/xml-invoice-parser';
import { getDatabase } from './db/database';
import { eventBus } from './event-bus';
import { FileStatus, LogLevel, VaultHandle, VaultFile, ExtractionResult } from '../shared/types';
import { DEFAULT_BATCH_SIZE, INVOICEVAULT_DIR } from '../shared/constants';

const STRUCTURED_EXTENSIONS = new Set(['.xml', '.xlsx', '.csv']);

export class ExtractionQueue {
  private runner: ClaudeCodeRunner;
  private reconciler: Reconciler;
  private scriptRegistry: ScriptRegistry;
  private matcherEvaluator: MatcherEvaluator;
  private vault: VaultHandle;
  private batchSize: number;
  private processing = false;
  private pendingTrigger = false;

  constructor(vault: VaultHandle, cliPath?: string, cliTimeout?: number) {
    this.vault = vault;
    this.runner = new ClaudeCodeRunner(cliPath, cliTimeout);
    this.reconciler = new Reconciler(vault.config.confidence_threshold);
    this.scriptRegistry = new ScriptRegistry(getDatabase());
    this.matcherEvaluator = new MatcherEvaluator();
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

        console.log(`[ExtractionQueue] Processing batch of ${batch.length} files`);
        eventBus.emit('extraction:started', { fileIds });

        // Mark as processing
        for (const file of batch) {
          updateFileStatus(file.id, FileStatus.Processing);
        }

        // Separate structured files (XML, Excel, CSV) from unstructured (PDF, images)
        const structuredFiles: VaultFile[] = [];
        const unstructuredFiles: VaultFile[] = [];

        for (const file of batch) {
          const ext = path.extname(file.relative_path).toLowerCase();
          if (STRUCTURED_EXTENSIONS.has(ext)) {
            structuredFiles.push(file);
          } else {
            unstructuredFiles.push(file);
          }
        }

        // Process structured files individually (parser/script-based)
        for (const file of structuredFiles) {
          await this.processStructuredFile(file);
        }

        // Process unstructured files via Claude CLI in batch
        if (unstructuredFiles.length > 0) {
          await this.processUnstructuredBatch(unstructuredFiles);
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

  private async processStructuredFile(file: VaultFile): Promise<void> {
    const fullPath = path.join(this.vault.rootPath, file.relative_path);
    const ext = path.extname(file.relative_path).toLowerCase();

    try {
      // 1. Try built-in parsers first (XML e-invoices)
      if (ext === '.xml') {
        try {
          const fileResult = parseXmlInvoice(fullPath, file.relative_path);
          const extraction: ExtractionResult = { results: [fileResult] };
          this.reconciler.reconcileResults(extraction, 'xml-parser');
          console.log(`[ExtractionQueue] XML parsed directly: ${file.relative_path}`);
          return;
        } catch (err) {
          console.log(`[ExtractionQueue] Built-in XML parser failed for ${file.relative_path}, trying cached scripts`);
        }
      }

      // 2. Try cached scripts via matcher evaluator
      const allScripts = this.scriptRegistry.getAllScripts();
      if (allScripts.length > 0) {
        const matchedScript = this.matcherEvaluator.findMatchingScript(fullPath, allScripts);
        if (matchedScript) {
          const scriptFullPath = path.join(this.vault.dotPath, matchedScript.script_path);
          const result = await executeScript(scriptFullPath, fullPath);
          this.scriptRegistry.recordUsage(matchedScript.id, file.id);
          this.reconciler.reconcileResults({ results: [result] }, `script:${matchedScript.name}`);
          console.log(`[ExtractionQueue] Processed with cached script "${matchedScript.name}": ${file.relative_path}`);
          return;
        }
      }

      // 3. Fall back to Claude CLI for script generation
      console.log(`[ExtractionQueue] No cached script matched, falling back to Claude CLI: ${file.relative_path}`);
      await this.processUnstructuredBatch([file]);
    } catch (err) {
      console.error(`[ExtractionQueue] Error processing structured file ${file.relative_path}:`, err);
      updateFileStatus(file.id, FileStatus.Error);
      addLog(null, LogLevel.Error, `Structured file error: ${file.relative_path}: ${(err as Error).message}`);
      eventBus.emit('extraction:error', {
        fileId: file.id,
        error: (err as Error).message,
      });
    }
  }

  private async processUnstructuredBatch(files: VaultFile[]): Promise<void> {
    const filePaths = files.map(f => path.join(this.vault.rootPath, f.relative_path));

    try {
      const systemPromptPath = path.join(this.vault.dotPath, 'extraction-prompt.md');
      const { result, sessionLog } = await this.runner.processFiles(filePaths, this.vault.rootPath, systemPromptPath);

      // Reconcile results
      this.reconciler.reconcileResults(result, sessionLog);

      // Handle files that weren't included in results (CLI may have skipped them)
      for (const file of files) {
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
      for (const file of files) {
        updateFileStatus(file.id, FileStatus.Error);
        addLog(null, LogLevel.Error, `Batch error for ${file.relative_path}: ${(err as Error).message}`);
        eventBus.emit('extraction:error', {
          fileId: file.id,
          error: (err as Error).message,
        });
      }
    }
  }

  isProcessing(): boolean {
    return this.processing;
  }
}
