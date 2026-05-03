import { AppConfig } from '../shared/types';
import { DEFAULT_CLAUDE_MODELS } from '../shared/constants';

export function makeTestAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    lastVaultPath: null,
    claudeCliPath: null,
    vaultPaths: [],
    autoStart: false,
    claudeModels: DEFAULT_CLAUDE_MODELS,
    locale: 'en',
    aiProvider: 'claude-cli',
    deepseekApiKey: null,
    deepseekModel: 'deepseek-v4-flash',
    deepseekThinking: false,
    ...overrides,
  };
}
