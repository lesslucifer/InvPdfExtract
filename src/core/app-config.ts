import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig } from '../shared/types';

const CONFIG_FILENAME = 'app-config.json';

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

export function loadAppConfig(): AppConfig {
  const configPath = getConfigPath();
  const defaults: AppConfig = {
    lastVaultPath: null,
    claudeCliPath: null,
  };

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

export function saveAppConfig(config: Partial<AppConfig>): void {
  const configPath = getConfigPath();
  const existing = loadAppConfig();
  const merged = { ...existing, ...config };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
}
