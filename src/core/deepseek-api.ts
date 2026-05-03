import * as fs from 'fs';
import { AIRunner, AIRunnerInvokeOpts } from './ai-runner';
import { DeepseekModel } from '../shared/types';
import { DEEPSEEK_API_BASE } from '../shared/constants';
import { log, LogModule } from './logger';

const SPEED_HINT = '\n\nSpeed is important. Do not over-analyze. Output only the requested format immediately — no explanations, reasoning, or commentary.';

export interface DeepSeekRunnerOpts {
  apiKey: string;
  model: DeepseekModel;
  thinking: boolean;
  reasoningEffort: 'low' | 'medium' | 'high';
  timeout: number;
  maxRetries?: number;
  baseUrl?: string;
}

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: { content?: string; reasoning_content?: string };
    finish_reason?: string;
  }>;
  error?: { message?: string; type?: string };
}

export class DeepSeekApiError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeepSeekApiError';
  }
}

export class DeepSeekRunner implements AIRunner {
  private opts: DeepSeekRunnerOpts;

  constructor(opts: DeepSeekRunnerOpts) {
    this.opts = opts;
  }

  async invokeRaw(userPrompt: string, systemPrompt: string, _cwd?: string): Promise<string> {
    const finalSystem = this.opts.thinking ? systemPrompt : systemPrompt + SPEED_HINT;
    return this.callApi(finalSystem, userPrompt);
  }

  async invoke(prompt: string, opts: AIRunnerInvokeOpts): Promise<string> {
    let systemPrompt = '';
    if (opts.systemPromptFile) {
      systemPrompt = await fs.promises.readFile(opts.systemPromptFile, 'utf-8');
    } else if (opts.systemPrompt) {
      systemPrompt = opts.systemPrompt;
    }
    const finalSystem = this.opts.thinking ? systemPrompt : systemPrompt + SPEED_HINT;
    return this.callApi(finalSystem, prompt);
  }

  private async callApi(systemPrompt: string, userPrompt: string): Promise<string> {
    const baseUrl = this.opts.baseUrl ?? DEEPSEEK_API_BASE;
    const url = `${baseUrl}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt.trim().length > 0) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages,
      stream: false,
      max_tokens: 8192,
      extra_body: {
        thinking: { type: this.opts.thinking ? 'enabled' : 'disabled' },
      },
    };

    if (this.opts.thinking) {
      body.reasoning_effort = this.opts.reasoningEffort;
    } else {
      body.temperature = 0;
    }

    const maxRetries = this.opts.maxRetries ?? 1;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeout);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.opts.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err = mapHttpError(res.status, text);
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            log.warn(LogModule.ClaudeCLI, `DeepSeek API ${res.status}, retrying once`, { attempt });
            await sleep(1000);
            lastErr = err;
            continue;
          }
          throw err;
        }

        const json = (await res.json()) as DeepSeekChatResponse;
        if (json.error) {
          throw new DeepSeekApiError(res.status, JSON.stringify(json.error), json.error.message ?? 'DeepSeek API error');
        }
        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new DeepSeekApiError(res.status, JSON.stringify(json), 'DeepSeek API returned no content');
        }

        const reasoning = json.choices?.[0]?.message?.reasoning_content;
        if (reasoning) {
          log.debug(LogModule.ClaudeCLI, 'DeepSeek thinking output', { reasoningLength: reasoning.length });
        }

        return content;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof DeepSeekApiError) throw err;
        if ((err as Error).name === 'AbortError') {
          throw new DeepSeekApiError(null, '', `DeepSeek API timed out after ${this.opts.timeout}ms`);
        }
        if (attempt < maxRetries) {
          lastErr = err as Error;
          await sleep(1000);
          continue;
        }
        throw err;
      }
    }

    throw lastErr ?? new Error('DeepSeek API call failed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapHttpError(status: number, body: string): DeepSeekApiError {
  let message: string;
  switch (status) {
    case 401:
      message = 'Invalid DeepSeek API key';
      break;
    case 402:
      message = 'DeepSeek account has insufficient balance';
      break;
    case 429:
      message = 'DeepSeek rate limit exceeded';
      break;
    case 400:
      message = `DeepSeek bad request: ${body.slice(0, 200)}`;
      break;
    default:
      if (status >= 500) {
        message = `DeepSeek server error (${status})`;
      } else {
        message = `DeepSeek API error (${status}): ${body.slice(0, 200)}`;
      }
  }
  return new DeepSeekApiError(status, body, message);
}

export async function testDeepSeekConnection(apiKey: string, model: DeepseekModel): Promise<{ ok: boolean; error?: string }> {
  try {
    const runner = new DeepSeekRunner({
      apiKey,
      model,
      thinking: false,
      reasoningEffort: 'low',
      timeout: 15_000,
      maxRetries: 0,
    });
    await runner.invokeRaw('Reply with the single word: ok', 'You are a helper.');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
