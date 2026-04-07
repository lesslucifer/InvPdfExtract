import * as fs from 'fs';
import * as path from 'path';
import { RelevanceFilterConfig } from '../../shared/types';
import { DEFAULT_FILTER_CONFIG, FILTER_CONFIG_FILE } from '../../shared/constants';

export async function loadFilterConfig(dotPath: string): Promise<RelevanceFilterConfig> {
  const configPath = path.join(dotPath, FILTER_CONFIG_FILE);
  try {
    const raw = await fs.promises.readFile(configPath, 'utf-8');
    return { ...DEFAULT_FILTER_CONFIG, ...JSON.parse(raw) };
  } catch {
    console.warn('[FilterConfig] Failed to load filter config, using defaults');
    return { ...DEFAULT_FILTER_CONFIG };
  }
}

export async function saveFilterConfig(dotPath: string, config: RelevanceFilterConfig): Promise<void> {
  const configPath = path.join(dotPath, FILTER_CONFIG_FILE);
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
}
