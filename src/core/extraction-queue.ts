import * as path from 'path';
import { getFilesByStatus, updateFileStatus } from './db/files';
import { addLog } from './db/records';
import { ClaudeCodeRunner, CliError, getSessionLogPath } from './claude-cli';
import { Reconciler } from './reconciler';
import { ScriptRegistry } from './script-registry';
import { MatcherEvaluator } from './matcher-evaluator';
import { ScriptGenerator } from './script-generator';
import { ScriptVerifier } from './script-verifier';
import { executeScript } from './script-sandbox';
import { parseXmlInvoice } from './parsers/xml-invoice-parser';
import { extractMetadata } from './parsers/spreadsheet-metadata';
// Database accessed via vault handle
import { eventBus } from './event-bus';
import { FileStatus, LogLevel, VaultHandle, VaultFile, ExtractionResult, ClaudeModelConfig } from '../shared/types';
import { DEFAULT_BATCH_SIZE, DEFAULT_CLAUDE_MODELS } from '../shared/constants';

const STRUCTURED_EXTENSIONS = new Set(['.xml', '.xlsx', '.csv']);
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.csv']);

export class ExtractionQueue {
  private pdfRunner: ClaudeCodeRunner;
  private scriptRunner: ClaudeCodeRunner;
  private reconciler: Reconciler;
  private scriptRegistry: ScriptRegistry;
  private matcherEvaluator: MatcherEvaluator;
  private scriptGenerator: ScriptGenerator;
  private scriptVerifier: ScriptVerifier;
  private vault: VaultHandle;
  private batchSize: number;
  private processing = false;
  private pendingTrigger = false;

  constructor(vault: VaultHandle, cliPath?: string, cliTimeout?: number, modelConfig?: ClaudeModelConfig) {
    this.vault = vault;
    const models = modelConfig ?? DEFAULT_CLAUDE_MODELS;
    this.pdfRunner = new ClaudeCodeRunner(cliPath, cliTimeout, models.pdfExtraction);
    this.scriptRunner = new ClaudeCodeRunner(cliPath, cliTimeout, models.scriptGeneration);
    this.reconciler = new Reconciler(vault.config.confidence_threshold);
    this.scriptRegistry = new ScriptRegistry(vault.db);
    this.matcherEvaluator = new MatcherEvaluator();
    this.scriptGenerator = new ScriptGenerator(this.scriptRunner);
    this.scriptVerifier = new ScriptVerifier(this.scriptRunner);
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
        } catch {
          console.log(`[ExtractionQueue] Built-in XML parser failed for ${file.relative_path}, trying cached scripts`);
        }
      }

      // 2. Try cached scripts via matcher evaluator
      const allScripts = this.scriptRegistry.getAllScripts();
      if (allScripts.length > 0) {
        const matchedScript = this.matcherEvaluator.findMatchingScript(fullPath, allScripts, this.vault.dotPath);
        if (matchedScript) {
          const scriptFullPath = path.join(this.vault.dotPath, matchedScript.script_path);
          const result = await executeScript(scriptFullPath, fullPath);
          result.relative_path = file.relative_path;
          this.scriptRegistry.recordUsage(matchedScript.id, file.id);
          this.reconciler.reconcileResults({ results: [result] }, `script:${matchedScript.name}`);
          console.log(`[ExtractionQueue] Processed with cached script "${matchedScript.name}": ${file.relative_path}`);
          return;
        }

        // 2b. Matchers didn't match — try running each existing parser directly.
        // A parser that produces valid output is a match even if its matcher failed.
        for (const script of allScripts) {
          try {
            const scriptFullPath = path.join(this.vault.dotPath, script.script_path);
            const result = await executeScript(scriptFullPath, fullPath);
            if (result && result.records && result.records.length > 0) {
              result.relative_path = file.relative_path;
              this.scriptRegistry.recordUsage(script.id, file.id);
              this.reconciler.reconcileResults({ results: [result] }, `script:${script.name}`);
              console.log(`[ExtractionQueue] Processed with existing parser "${script.name}" (matcher missed): ${file.relative_path}`);
              return;
            }
          } catch {
            // Parser failed on this file — try next
          }
        }
      }

      // 3. For spreadsheets, use metadata-driven iterative script generation
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
    // 1. Extract metadata (pure local code, no AI)
    const metadata = extractMetadata(fullPath);
    console.log(`[ExtractionQueue] Extracted metadata: ${metadata.sheets.length} sheets, ${metadata.totalRows} total rows`);

    // 2. Generate initial parser script via AI
    const generated = await this.scriptGenerator.generateParser(metadata, this.vault.dotPath);
    console.log(`[ExtractionQueue] Generated parser: ${generated.name}`);

    // 3. Iterative verify-and-refine loop — Claude judges each iteration
    const verification = await this.scriptVerifier.verifyAndRefine(
      generated.parserPath, fullPath, metadata, this.vault.rootPath,
    );

    if (!verification.success) {
      throw new Error(`Script verification failed: ${verification.error}`);
    }

    // 4. Generate matcher script (for reuse with similar files)
    let matcherPath: string;
    try {
      const matcher = await this.scriptGenerator.generateMatcher(metadata, this.vault.dotPath, generated.name);
      matcherPath = matcher.matcherPath;
    } catch (err) {
      // Matcher generation failure is non-critical — parser still works
      console.warn(`[ExtractionQueue] Matcher generation failed (non-critical): ${(err as Error).message}`);
      matcherPath = '';
    }

    // 5. Register the script for reuse
    if (matcherPath) {
      const script = this.scriptRegistry.registerScript({
        name: generated.name,
        docType: generated.docType,
        scriptPath: path.relative(this.vault.dotPath, generated.parserPath),
        matcherPath: path.relative(this.vault.dotPath, matcherPath),
        description: `Auto-generated parser for ${metadata.fileName}`,
      });
      this.scriptRegistry.recordUsage(script.id, file.id);
    }

    // 6. Reconcile the verified output
    // Fix relative_path — parser scripts receive absolute path via process.argv[2],
    // but reconciler looks up files by relative path in the DB.
    verification.output!.relative_path = file.relative_path;
    this.reconciler.reconcileResults(
      { results: [verification.output!] },
      `script:${generated.name}`,
    );
    console.log(`[ExtractionQueue] Spreadsheet processed and reconciled: ${file.relative_path}`);
  }

  private async processUnstructuredBatch(files: VaultFile[]): Promise<void> {
    // Guard: reject spreadsheet files — Claude CLI cannot read binary xlsx/csv
    const processable: VaultFile[] = [];
    for (const file of files) {
      const ext = path.extname(file.relative_path).toLowerCase();
      if (SPREADSHEET_EXTENSIONS.has(ext)) {
        console.error(`[ExtractionQueue] Cannot send ${ext} to Claude CLI: ${file.relative_path}`);
        updateFileStatus(file.id, FileStatus.Error);
        addLog(null, LogLevel.Error, `Spreadsheet files cannot be processed by Claude CLI: ${file.relative_path}`);
        eventBus.emit('extraction:error', {
          fileId: file.id,
          error: `Spreadsheet files (${ext}) require the metadata pipeline, not Claude CLI`,
        });
      } else {
        processable.push(file);
      }
    }
    if (processable.length === 0) return;

    const filePaths = processable.map(f => path.join(this.vault.rootPath, f.relative_path));

    try {
      const systemPromptPath = path.join(this.vault.dotPath, 'extraction-prompt.md');
      const { result, sessionLog } = await this.pdfRunner.processFiles(filePaths, this.vault.rootPath, systemPromptPath);

      // Reconcile results
      this.reconciler.reconcileResults(result, sessionLog);

      // Handle files that weren't included in results (CLI may have skipped them)
      for (const file of processable) {
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
      const isCliErr = err instanceof CliError;
      const sessionLogPath = (isCliErr && err.sessionId)
        ? getSessionLogPath(this.vault.rootPath, err.sessionId)
        : null;
      const detail = JSON.stringify({
        exitCode: isCliErr ? err.exitCode : null,
        stderr: isCliErr ? err.stderr : null,
        partialStdout: isCliErr ? err.partialStdout : null,
        sessionLogPath,
      });
      for (const file of processable) {
        updateFileStatus(file.id, FileStatus.Error);
        addLog(null, LogLevel.Error, `Batch error for ${file.relative_path}: ${(err as Error).message}`, detail, file.id);
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
