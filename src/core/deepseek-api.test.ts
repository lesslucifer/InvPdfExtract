import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DeepSeekRunner, DeepSeekApiError } from './deepseek-api';

const originalFetch = globalThis.fetch;

function mockFetchOk(content: string) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
    text: async () => '',
  }) as unknown as typeof fetch;
}

function mockFetchError(status: number, body = '') {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  }) as unknown as typeof fetch;
}

describe('DeepSeekRunner', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('invokeRaw returns choices[0].message.content', async () => {
    mockFetchOk('hello world');
    const runner = new DeepSeekRunner({
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      thinking: false,
      reasoningEffort: 'low',
      timeout: 5000,
      maxRetries: 0,
    });
    const result = await runner.invokeRaw('user prompt', 'system prompt');
    expect(result).toBe('hello world');
  });

  it('sends thinking enabled in extra_body when thinking=true', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
        text: async () => '',
      });
    }) as unknown as typeof fetch;

    const runner = new DeepSeekRunner({
      apiKey: 'sk-test',
      model: 'deepseek-v4-pro',
      thinking: true,
      reasoningEffort: 'high',
      timeout: 5000,
      maxRetries: 0,
    });
    await runner.invokeRaw('user', 'system');

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as unknown as Record<string, unknown>;
    expect(body.model).toBe('deepseek-v4-pro');
    expect(body.reasoning_effort).toBe('high');
    expect((body.extra_body as { thinking: { type: string } }).thinking.type).toBe('enabled');
    expect(body.temperature).toBeUndefined();
  });

  it('sends thinking disabled and temperature 0 when thinking=false', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        text: async () => '',
      });
    }) as unknown as typeof fetch;

    const runner = new DeepSeekRunner({
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      thinking: false,
      reasoningEffort: 'low',
      timeout: 5000,
      maxRetries: 0,
    });
    await runner.invokeRaw('user', 'system');

    const body = capturedBody as unknown as Record<string, unknown>;
    expect((body.extra_body as { thinking: { type: string } }).thinking.type).toBe('disabled');
    expect(body.temperature).toBe(0);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('maps 401 to invalid API key error', async () => {
    mockFetchError(401, 'unauthorized');
    const runner = new DeepSeekRunner({
      apiKey: 'sk-bad',
      model: 'deepseek-v4-flash',
      thinking: false,
      reasoningEffort: 'low',
      timeout: 5000,
      maxRetries: 0,
    });
    await expect(runner.invokeRaw('u', 's')).rejects.toThrow(/Invalid DeepSeek API key/);
  });

  it('retries once on 429', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: async () => ({}),
          text: async () => 'rate limited',
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'recovered' } }] }),
        text: async () => '',
      });
    }) as unknown as typeof fetch;

    const runner = new DeepSeekRunner({
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      thinking: false,
      reasoningEffort: 'low',
      timeout: 5000,
      maxRetries: 1,
    });
    const result = await runner.invokeRaw('u', 's');
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('invoke reads systemPromptFile from disk', async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ds-'));
    const promptFile = path.join(tmp, 'sys.md');
    await fs.promises.writeFile(promptFile, 'system from file');

    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        text: async () => '',
      });
    }) as unknown as typeof fetch;

    const runner = new DeepSeekRunner({
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      thinking: false,
      reasoningEffort: 'low',
      timeout: 5000,
      maxRetries: 0,
    });
    await runner.invoke('user prompt', { systemPromptFile: promptFile });

    const body = capturedBody as unknown as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('system from file');

    await fs.promises.rm(tmp, { recursive: true, force: true });
  });

  it('sends Authorization Bearer header', async () => {
    let capturedHeaders: Record<string, string> | null = null;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        text: async () => '',
      });
    }) as unknown as typeof fetch;

    const runner = new DeepSeekRunner({
      apiKey: 'sk-secret',
      model: 'deepseek-v4-flash',
      thinking: false,
      reasoningEffort: 'low',
      timeout: 5000,
      maxRetries: 0,
    });
    await runner.invokeRaw('u', 's');
    expect(capturedHeaders!['Authorization']).toBe('Bearer sk-secret');
  });

  it('throws DeepSeekApiError when response has no content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
      text: async () => '',
    }) as unknown as typeof fetch;

    const runner = new DeepSeekRunner({
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      thinking: false,
      reasoningEffort: 'low',
      timeout: 5000,
      maxRetries: 0,
    });
    await expect(runner.invokeRaw('u', 's')).rejects.toThrow(DeepSeekApiError);
  });
});
