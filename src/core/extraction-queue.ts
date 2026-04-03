import * as path from 'path';
import { getFilesByStatus, updateFileStatus } from './db/files';
import { addLog } from './db/records';
import { ClaudeCodeRunner } from './claude-cli';
import { Reconciler } from './reconciler';
import { ScriptRegistry } from './script-registry';
import { MatcherEvaluator } from './matcher-evaluator';
import { ScriptGenerator } from './script-generator';
import { ScriptVerifier } from './script-verifier';
import { executeScript } from './script-sandbox';
import { parseXmlInvoice } from './parsers/xml-invoice-parser';
import { extractMetadata } from './parsers/spreadsheet-metadata';
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
  private scriptGenerator: ScriptGenerator;
  private scriptVerifier: ScriptVerifier;
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
    this.scriptGenerator = new ScriptGenerator(this.runner);
    this.scriptVerifier = new ScriptVerifier(this.runner);
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

      // 3. For spreadsheets, use metadata-driven script generation
      console.log(`[ExtractionQueue] No cached script matched, generating via metadata pipeline: ${file.relative_path}`);
      await this.processSpreadsheetWithMetadata(file, fullPath);
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

  private async processSpreadsheetWithMetadata(file: VaultFile, fullPath: string): Promise<void> {
    try {
      // 1. Extract metadata (pure code, no AI)
      const metadata = extractMetadata(fullPath);
      console.log(`[ExtractionQueue] Extracted metadata: ${metadata.sheets.length} sheets, ${metadata.totalRows} total rows`);

      // 2. Generate parser + matcher scripts via AI
      const generated = await this.scriptGenerator.generateScripts(metadata, this.vault.dotPath);
      console.log(`[ExtractionQueue] Generated scripts: ${generated.name}`);

      // 3. Verify the generated script works
      const verification = await this.scriptVerifier.verifyScript(
        generated.parserPath, fullPath, metadata, this.vault.dotPath,
      );

      if (!verification.success) {
        console.error(`[ExtractionQueue] Script verification failed: ${verification.error}`);
        // Fall back to Claude CLI as last resort
        await this.processUnstructuredBatch([file]);
        return;
      }

      // 4. Register the script for reuse
      const script = this.scriptRegistry.registerScript({
        name: generated.name,
        docType: generated.docType,
        scriptPath: path.relative(this.vault.dotPath, generated.parserPath),
        matcherPath: path.relative(this.vault.dotPath, generated.matcherPath),
        description: `Auto-generated parser for ${metadata.fileName}`,
      });
      this.scriptRegistry.recordUsage(script.id, file.id);

      // 5. Reconcile the verified output
      this.reconciler.reconcileResults(
        { results: [verification.output!] },
        `script:${generated.name}`,
      );
      console.log(`[ExtractionQueue] XLSX processed and reconciled: ${file.relative_path}`);
    } catch (err) {
      console.error(`[ExtractionQueue] Metadata pipeline failed for ${file.relative_path}:`, err);
      // Fall back to Claude CLI as last resort
      await this.processUnstructuredBatch([file]);
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
