import * as path from 'path';
import { VaultFile, FileStatus, RelevanceFilterConfig, VaultHandle, AppConfig } from '../../shared/types';
import { updateFileFilterResult } from '../db/files';
import { eventBus } from '../event-bus';
import { loadFilterConfig } from './config';
import { filenameFilter } from './filename-filter';
import { contentSniffer, extractPdfText, extractSpreadsheetText, extractXmlText } from './content-sniffer';
import { aiTriageBatch, TriageInput } from './ai-triage';
import { log, LogModule } from '../logger';

export class RelevanceFilter {
  private vault: VaultHandle;
  private config: RelevanceFilterConfig;
  private appConfig: AppConfig;

  private constructor(vault: VaultHandle, config: RelevanceFilterConfig, appConfig: AppConfig) {
    this.vault = vault;
    this.config = config;
    this.appConfig = appConfig;
  }

  static async create(vault: VaultHandle, appConfig: AppConfig): Promise<RelevanceFilter> {
    const config = await loadFilterConfig(vault.dotPath);
    const instance = new RelevanceFilter(vault, config, appConfig);
    log.debug(LogModule.Filter, `RelevanceFilter created (aiTriage=${config.aiTriageEnabled})`);
    return instance;
  }

  updateAppConfig(appConfig: AppConfig): void {
    this.appConfig = appConfig;
  }

  async reloadConfig(): Promise<void> {
    this.config = await loadFilterConfig(this.vault.dotPath);
    log.debug(LogModule.Filter, 'Filter config reloaded');
  }

  async filterFile(file: VaultFile): Promise<'accepted' | 'skipped'> {
    const fullPath = path.join(this.vault.rootPath, file.relative_path);

    const layer1Result = filenameFilter(file.relative_path, file.file_size, this.config);
    log.debug(LogModule.Filter, `Layer 1: score=${layer1Result.score.toFixed(2)}, decision=${layer1Result.decision}`, { path: file.relative_path });

    if (layer1Result.decision === 'process') {
      log.debug(LogModule.Filter, `Accepted at layer 1`, { path: file.relative_path });
      updateFileFilterResult(file.id, FileStatus.Pending, layer1Result.score, layer1Result.reason, 1);
      return 'accepted';
    }

    const layer2Result = await contentSniffer(fullPath, layer1Result.score, this.config);
    log.debug(LogModule.Filter, `Layer 2: score=${layer2Result.score.toFixed(2)}, decision=${layer2Result.decision}`, { path: file.relative_path });

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
      const triageResults = await aiTriageBatch(triageInputs, this.config, this.vault.dotPath, this.appConfig);
      const result = triageResults[0];
      log.debug(LogModule.Filter, `Layer 3 (AI): score=${result.score.toFixed(2)}, decision=${result.decision}`, { path: file.relative_path });

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

    log.debug(LogModule.Filter, `Accepted (AI triage disabled, uncertain → process)`, { path: file.relative_path });
    updateFileFilterResult(
      file.id, FileStatus.Pending,
      layer2Result.score, `${layer2Result.reason} (AI triage disabled, defaulting to process)`, 2
    );
    return 'accepted';
  }
}
