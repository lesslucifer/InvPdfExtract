import * as fs from 'fs';
import * as path from 'path';
import { RelevanceFilterConfig } from '../../shared/types';
import { DEFAULT_FILTER_CONFIG, FILTER_CONFIG_FILE } from '../../shared/constants';

export function loadFilterConfig(dotPath: string): RelevanceFilterConfig {
  const configPath = path.join(dotPath, FILTER_CONFIG_FILE);
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return { ...DEFAULT_FILTER_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    console.warn('[FilterConfig] Failed to load filter config, using defaults');
  }
  return { ...DEFAULT_FILTER_CONFIG };
}

export function saveFilterConfig(dotPath: string, config: RelevanceFilterConfig): void {
  const configPath = path.join(dotPath, FILTER_CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
