import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig } from '../shared/types';
import { DEFAULT_CLAUDE_MODELS, DEFAULT_AI_PROVIDER, DEFAULT_DEEPSEEK_MODEL } from '../shared/constants';
import { log, LogModule } from './logger';

const CONFIG_FILENAME = 'app-config.json';

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

export async function loadAppConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();
  const defaults: AppConfig = {
    lastVaultPath: null,
    claudeCliPath: null,
    vaultPaths: [],
    autoStart: false,
    claudeModels: DEFAULT_CLAUDE_MODELS,
    locale: 'en',
    aiProvider: DEFAULT_AI_PROVIDER,
    deepseekApiKey: null,
    deepseekModel: DEFAULT_DEEPSEEK_MODEL,
    deepseekThinking: false,
  };

  try {
    const raw = await fs.promises.readFile(configPath, 'utf-8');
    log.debug(LogModule.Config, 'App config loaded');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    log.debug(LogModule.Config, 'No app config found, using defaults');
    return defaults;
  }
}

export async function saveAppConfig(config: Partial<AppConfig>): Promise<void> {
  const configPath = getConfigPath();
  const existing = await loadAppConfig();
  const merged = { ...existing, ...config };
  await fs.promises.writeFile(configPath, JSON.stringify(merged, null, 2));
  log.info(LogModule.Config, 'App config saved');
}
