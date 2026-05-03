import { describe, it, expect } from 'vitest';
import { createAIRunner, checkAIProviderAvailable } from './ai-runner';
import { ClaudeCodeRunner } from './claude-cli';
import { DeepSeekRunner } from './deepseek-api';
import { makeTestAppConfig } from '../test-helpers/app-config';

describe('createAIRunner factory', () => {
  it('returns ClaudeCodeRunner when aiProvider=claude-cli', () => {
    const runner = createAIRunner('pdf', makeTestAppConfig({ aiProvider: 'claude-cli' }));
    expect(runner).toBeInstanceOf(ClaudeCodeRunner);
  });

  it('returns DeepSeekRunner when aiProvider=deepseek-api with key', () => {
    const runner = createAIRunner('pdf', makeTestAppConfig({
      aiProvider: 'deepseek-api',
      deepseekApiKey: 'sk-test',
    }));
    expect(runner).toBeInstanceOf(DeepSeekRunner);
  });

  it('throws when DeepSeek selected but no key', () => {
    expect(() => createAIRunner('pdf', makeTestAppConfig({
      aiProvider: 'deepseek-api',
      deepseekApiKey: null,
    }))).toThrow(/API key/);
  });

  it('uses correct role config (different roles produce runners)', () => {
    const config = makeTestAppConfig({ aiProvider: 'deepseek-api', deepseekApiKey: 'sk-test' });
    expect(createAIRunner('pdf', config)).toBeInstanceOf(DeepSeekRunner);
    expect(createAIRunner('script', config)).toBeInstanceOf(DeepSeekRunner);
    expect(createAIRunner('triage', config)).toBeInstanceOf(DeepSeekRunner);
    expect(createAIRunner('je', config)).toBeInstanceOf(DeepSeekRunner);
    expect(createAIRunner('matcher', config)).toBeInstanceOf(DeepSeekRunner);
  });
});

describe('checkAIProviderAvailable', () => {
  it('returns ok=false when DeepSeek selected but no key', async () => {
    const status = await checkAIProviderAvailable(makeTestAppConfig({
      aiProvider: 'deepseek-api',
      deepseekApiKey: null,
    }));
    expect(status.provider).toBe('deepseek-api');
    expect(status.ok).toBe(false);
  });

  it('returns ok=true and detail=model when DeepSeek configured', async () => {
    const status = await checkAIProviderAvailable(makeTestAppConfig({
      aiProvider: 'deepseek-api',
      deepseekApiKey: 'sk-test',
      deepseekModel: 'deepseek-v4-pro',
    }));
    expect(status.provider).toBe('deepseek-api');
    expect(status.ok).toBe(true);
    expect(status.detail).toBe('deepseek-v4-pro');
  });
});
