import * as path from 'path';
import { VaultFile, FileStatus, FilterResult, RelevanceFilterConfig, VaultHandle } from '../../shared/types';
import { updateFileFilterResult } from '../db/files';
import { eventBus } from '../event-bus';
import { loadFilterConfig } from './config';
import { filenameFilter } from './filename-filter';
import { contentSniffer, extractPdfText, extractSpreadsheetText, extractXmlText } from './content-sniffer';
import { aiTriageBatch, TriageInput } from './ai-triage';

export class RelevanceFilter {
  private vault: VaultHandle;
  private config: RelevanceFilterConfig;
  private cliPath: string | undefined;

  private constructor(vault: VaultHandle, config: RelevanceFilterConfig, cliPath?: string) {
    this.vault = vault;
    this.config = config;
    this.cliPath = cliPath;
  }

  static async create(vault: VaultHandle, cliPath?: string): Promise<RelevanceFilter> {
    const config = await loadFilterConfig(vault.dotPath);
    return new RelevanceFilter(vault, config, cliPath);
  }

  async reloadConfig(): Promise<void> {
    this.config = await loadFilterConfig(this.vault.dotPath);
  }

  async filterFiles(files: VaultFile[]): Promise<VaultFile[]> {
    const toProcess: VaultFile[] = [];
    const uncertainFiles: Array<{ file: VaultFile; layer2Result: FilterResult }> = [];

    for (const file of files) {
      const fullPath = path.join(this.vault.rootPath, file.relative_path);

      const layer1Result = filenameFilter(file.relative_path, file.file_size, this.config);

      if (layer1Result.decision === 'process') {
        updateFileFilterResult(file.id, FileStatus.Pending, layer1Result.score, layer1Result.reason, 1);
        toProcess.push(file);
        continue;
      }

      const layer2Result = await contentSniffer(fullPath, layer1Result.score, this.config);

      if (layer2Result.decision === 'process') {
        updateFileFilterResult(file.id, FileStatus.Pending, layer2Result.score, layer2Result.reason, 2);
        toProcess.push(file);
        continue;
      }

      if (layer2Result.decision === 'skip') {
        updateFileFilterResult(file.id, FileStatus.Skipped, layer2Result.score, layer2Result.reason, 2);
        eventBus.emit('file:filtered', {
          fileId: file.id,
          relativePath: file.relative_path,
          score: layer2Result.score,
          reason: layer2Result.reason,
        });
        continue;
      }

      uncertainFiles.push({ file, layer2Result });
    }

    if (uncertainFiles.length > 0 && this.config.aiTriageEnabled) {
      const triageInputs: TriageInput[] = [];
      for (const item of uncertainFiles) {
        const fullPath = path.join(this.vault.rootPath, item.file.relative_path);
        let textSample = '';
        try {
          const ext = path.extname(fullPath).toLowerCase();
          if (ext === '.pdf') textSample = await extractPdfText(fullPath);
          else if (ext === '.xlsx' || ext === '.csv') textSample = extractSpreadsheetText(fullPath);
          else if (ext === '.xml') textSample = await extractXmlText(fullPath);
        } catch { /* empty text */ }

        triageInputs.push({
          relativePath: item.file.relative_path,
          textSample,
          layer2Score: item.layer2Result.score,
        });
      }

      for (let i = 0; i < triageInputs.length; i += this.config.aiTriageBatchSize) {
        const batch = triageInputs.slice(i, i + this.config.aiTriageBatchSize);
        const batchFiles = uncertainFiles.slice(i, i + this.config.aiTriageBatchSize);
        const triageResults = await aiTriageBatch(batch, this.config, this.cliPath);

        for (let j = 0; j < batchFiles.length; j++) {
          const { file } = batchFiles[j];
          const result = triageResults[j];

          if (result.decision === 'skip') {
            updateFileFilterResult(file.id, FileStatus.Skipped, result.score, result.reason, 3);
            eventBus.emit('file:filtered', {
              fileId: file.id,
              relativePath: file.relative_path,
              score: result.score,
              reason: result.reason,
            });
          } else {
            updateFileFilterResult(file.id, FileStatus.Pending, result.score, result.reason, 3);
            toProcess.push(file);
          }
        }
      }
    } else if (uncertainFiles.length > 0) {
      for (const { file, layer2Result } of uncertainFiles) {
        updateFileFilterResult(
          file.id, FileStatus.Pending,
          layer2Result.score, `${layer2Result.reason} (AI triage disabled, defaulting to process)`, 2
        );
        toProcess.push(file);
      }
    }

    console.log(`[RelevanceFilter] Filtered ${files.length} files: ${toProcess.length} to process, ${files.length - toProcess.length} skipped`);
    return toProcess;
  }
}
