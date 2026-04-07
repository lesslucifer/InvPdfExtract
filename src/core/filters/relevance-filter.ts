import * as path from 'path';
import { VaultFile, FileStatus, RelevanceFilterConfig, VaultHandle } from '../../shared/types';
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

  async filterFile(file: VaultFile): Promise<'accepted' | 'skipped'> {
    const fullPath = path.join(this.vault.rootPath, file.relative_path);

    const layer1Result = filenameFilter(file.relative_path, file.file_size, this.config);

    if (layer1Result.decision === 'process') {
      updateFileFilterResult(file.id, FileStatus.Pending, layer1Result.score, layer1Result.reason, 1);
      return 'accepted';
    }

    const layer2Result = await contentSniffer(fullPath, layer1Result.score, this.config);

    if (layer2Result.decision === 'process') {
      updateFileFilterResult(file.id, FileStatus.Pending, layer2Result.score, layer2Result.reason, 2);
      return 'accepted';
    }

    if (layer2Result.decision === 'skip') {
      updateFileFilterResult(file.id, FileStatus.Skipped, layer2Result.score, layer2Result.reason, 2);
      eventBus.emit('file:filtered', {
        fileId: file.id,
        relativePath: file.relative_path,
        score: layer2Result.score,
        reason: layer2Result.reason,
      });
      return 'skipped';
    }

    // Layer 2 uncertain — try AI triage if enabled
    if (this.config.aiTriageEnabled) {
      let textSample = '';
      try {
        const ext = path.extname(fullPath).toLowerCase();
        if (ext === '.pdf') textSample = await extractPdfText(fullPath);
        else if (ext === '.xlsx' || ext === '.csv') textSample = await extractSpreadsheetText(fullPath);
        else if (ext === '.xml') textSample = await extractXmlText(fullPath);
      } catch { /* empty text */ }

      const triageInputs: TriageInput[] = [{ relativePath: file.relative_path, textSample, layer2Score: layer2Result.score }];
      const triageResults = await aiTriageBatch(triageInputs, this.config, this.cliPath);
      const result = triageResults[0];

      if (result.decision === 'skip') {
        updateFileFilterResult(file.id, FileStatus.Skipped, result.score, result.reason, 3);
        eventBus.emit('file:filtered', {
          fileId: file.id,
          relativePath: file.relative_path,
          score: result.score,
          reason: result.reason,
        });
        return 'skipped';
      }

      updateFileFilterResult(file.id, FileStatus.Pending, result.score, result.reason, 3);
      return 'accepted';
    }

    // AI triage disabled — default uncertain files to process
    updateFileFilterResult(
      file.id, FileStatus.Pending,
      layer2Result.score, `${layer2Result.reason} (AI triage disabled, defaulting to process)`, 2
    );
    return 'accepted';
  }

  async filterFiles(files: VaultFile[]): Promise<VaultFile[]> {
    const toProcess: VaultFile[] = [];
    for (const file of files) {
      const outcome = await this.filterFile(file);
      if (outcome === 'accepted') toProcess.push(file);
    }
    console.log(`[RelevanceFilter] Filtered ${files.length} files: ${toProcess.length} to process, ${files.length - toProcess.length} skipped`);
    return toProcess;
  }
}
