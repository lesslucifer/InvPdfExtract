import { ClaudeCodeRunner } from './claude-cli';
import { DeepSeekRunner } from './deepseek-api';
import { AppConfig, ModelTier, EffortLevel } from '../shared/types';
import { DEFAULT_CLI_TIMEOUT, DEEPSEEK_TRIAGE_TIMEOUT } from '../shared/constants';

export type AIRunnerRole = 'pdf' | 'script' | 'matcher' | 'je' | 'triage';

export interface AIRunnerInvokeOpts {
  systemPrompt?: string;
  systemPromptFile?: string;
  cwd?: string;
  toolArgs?: string[];
}

export interface AIRunner {
  invoke(prompt: string, opts: AIRunnerInvokeOpts): Promise<string>;
  invokeRaw(userPrompt: string, systemPrompt: string, cwd?: string): Promise<string>;
}

interface ClaudeRoleConfig {
  modelTier: ModelTier;
  effort: EffortLevel;
  timeout: number;
}

const CLAUDE_ROLE_CONFIG: Record<AIRunnerRole, ClaudeRoleConfig> = {
  pdf: { modelTier: 'fast', effort: 'low', timeout: DEFAULT_CLI_TIMEOUT },
  script: { modelTier: 'heavy', effort: 'high', timeout: DEFAULT_CLI_TIMEOUT },
  matcher: { modelTier: 'heavy', effort: 'low', timeout: DEFAULT_CLI_TIMEOUT },
  je: { modelTier: 'medium', effort: 'low', timeout: DEFAULT_CLI_TIMEOUT },
  triage: { modelTier: 'fast', effort: 'low', timeout: DEEPSEEK_TRIAGE_TIMEOUT },
};

interface DeepseekRoleConfig {
  reasoningEffort: 'low' | 'medium' | 'high';
  timeout: number;
}

const DEEPSEEK_ROLE_CONFIG: Record<AIRunnerRole, DeepseekRoleConfig> = {
  pdf: { reasoningEffort: 'low', timeout: DEFAULT_CLI_TIMEOUT },
  script: { reasoningEffort: 'high', timeout: DEFAULT_CLI_TIMEOUT },
  matcher: { reasoningEffort: 'low', timeout: DEFAULT_CLI_TIMEOUT },
  je: { reasoningEffort: 'low', timeout: DEFAULT_CLI_TIMEOUT },
  triage: { reasoningEffort: 'low', timeout: DEEPSEEK_TRIAGE_TIMEOUT },
};

export function createAIRunner(role: AIRunnerRole, config: AppConfig): AIRunner {
  if (config.aiProvider === 'deepseek-api') {
    if (!config.deepseekApiKey) {
      throw new Error('DeepSeek API key is not configured. Set it in Settings.');
    }
    const roleConfig = DEEPSEEK_ROLE_CONFIG[role];
    return new DeepSeekRunner({
      apiKey: config.deepseekApiKey,
      model: config.deepseekModel,
      thinking: config.deepseekThinking,
      reasoningEffort: roleConfig.reasoningEffort,
      timeout: roleConfig.timeout,
    });
  }

  const roleConfig = CLAUDE_ROLE_CONFIG[role];
  return new ClaudeCodeRunner(
    config.claudeCliPath ?? undefined,
    roleConfig.timeout,
    roleConfig.modelTier,
    roleConfig.effort,
  );
}

export interface AIProviderStatus {
  provider: 'claude-cli' | 'deepseek-api';
  ok: boolean;
  detail?: string;
  error?: string;
}

export async function checkAIProviderAvailable(config: AppConfig): Promise<AIProviderStatus> {
  if (config.aiProvider === 'deepseek-api') {
    if (!config.deepseekApiKey) {
      return { provider: 'deepseek-api', ok: false, error: 'API key not set' };
    }
    return { provider: 'deepseek-api', ok: true, detail: config.deepseekModel };
  }

  const ok = await ClaudeCodeRunner.isAvailable(config.claudeCliPath ?? undefined);
  return { provider: 'claude-cli', ok, error: ok ? undefined : 'Claude CLI not found' };
}
