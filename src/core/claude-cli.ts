import { exec } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promisify } from 'util';

const execAsync = promisify(exec);
import * as os from 'os';
import * as path from 'path';
import { ModelTier, MODEL_TIER_MAP, EffortLevel } from '../shared/types';
import { DEFAULT_CLI_TIMEOUT } from '../shared/constants';
import { log, LogModule } from './logger';

const EFFORT_SPEED_HINTS: Partial<Record<EffortLevel, string>> = {
  low: '\n\nSpeed is important. Do not over-analyze. Output only the requested format immediately — no explanations, reasoning, or commentary.',
};

export class CliError extends Error {
  constructor(
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly partialStdout: string,
    public readonly sessionId: string | null,
  ) {
    super(`Claude CLI exited with code ${exitCode}: ${stderr}`);
    this.name = 'CliError';
  }
}

export function extractSessionId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type === 'result' && typeof parsed.session_id === 'string') {
      return parsed.session_id;
    }
    return null;
  } catch { return null; }
}

export function getSessionLogPath(cwd: string, sessionId: string): string {
  const hashed = cwd.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', hashed, `${sessionId}.jsonl`);
}

/**
 * Unwrap the --output-format json envelope from Claude CLI.
 * Returns the model's text output, or null if not an envelope.
 */
export function unwrapEnvelope(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.type === 'result') {
      if (typeof parsed.result === 'string') {
        return parsed.result;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Bracket-counting JSON extractor. Finds the first balanced {...} in the
 * raw string that parses as valid JSON with a `results` array.
 * Properly skips characters inside JSON string literals.
 */
export function extractJSON(raw: string): string | null {
  for (let start = 0; start < raw.length; start++) {
    if (raw[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;

      if (depth === 0) {
        const candidate = raw.substring(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && Array.isArray(parsed.results)) {
            return candidate;
          }
        } catch {
          // not valid JSON from this start position, try next {
        }
        break;
      }
    }
  }
  return null;
}

/**
 * Attempt to repair truncated JSON by closing open strings, arrays, and objects.
 * Returns the repaired string or null if repair is not possible.
 */
export function repairTruncatedJSON(raw: string): string | null {
  const firstBrace = raw.indexOf('{');
  if (firstBrace === -1) return null;

  const text = raw.substring(firstBrace);
  const stack: ('{' | '[')[] = [];
  let inString = false;
  let escaped = false;
  // Track whether the current context expects a value (after ':') or a key (after ',' or '{')
  let expectingValue = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') { stack.push('{'); expectingValue = false; }
    else if (ch === '[') { stack.push('['); expectingValue = true; }
    else if (ch === '}') { stack.pop(); expectingValue = false; }
    else if (ch === ']') { stack.pop(); expectingValue = false; }
    else if (ch === ':') { expectingValue = true; }
    else if (ch === ',') {
      // After comma in object context → expecting key (not value)
      // After comma in array context → expecting value
      const top = stack[stack.length - 1];
      expectingValue = top === '[';
    }
  }

  // Nothing to repair — already balanced
  if (stack.length === 0 && !inString) return null;

  let repaired = text;

  if (inString) {
    // Close the open string
    repaired += '"';
    if (!expectingValue) {
      // We were in a key string (not after ':'). Add ': null' to complete the pair.
      repaired += ': null';
    }
  } else if (expectingValue) {
    // After ':' or ',' in array with no value yet — check if there's a dangling comma or colon
    const trimmed = repaired.trimEnd();
    if (trimmed.endsWith(':')) {
      repaired += ' null';
    }
  }

  // Remove trailing comma before closing brackets
  repaired = repaired.replace(/,\s*$/, '');

  // Close all open containers in reverse order
  while (stack.length > 0) {
    const open = stack.pop()!;
    repaired += open === '{' ? '}' : ']';
  }

  // Verify it parses
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

export class ClaudeCodeRunner {
  private cliPath: string;
  private timeout: number;
  private model: string | undefined;
  private effort: EffortLevel | undefined;

  constructor(cliPath?: string, timeout?: number, modelTier?: ModelTier, effort?: EffortLevel) {
    this.cliPath = cliPath || 'claude';
    this.timeout = timeout || DEFAULT_CLI_TIMEOUT;
    this.model = modelTier ? MODEL_TIER_MAP[modelTier] : undefined;
    this.effort = effort;
  }

  static async isAvailable(cliPath?: string): Promise<boolean> {
    try {
      await execAsync(`${cliPath || 'claude'} --version`);
      return true;
    } catch {
      return false;
    }
  }

  async invokeRaw(userPrompt: string, systemPrompt: string, cwd?: string): Promise<string> {
    const raw = await this.invoke(userPrompt, { systemPrompt, cwd });
    return unwrapEnvelope(raw) ?? raw;
  }

  async invoke(prompt: string, opts: {
    systemPrompt?: string;
    systemPromptFile?: string;
    cwd?: string;
    toolArgs?: string[];
  }): Promise<string> {
    const { systemPrompt, systemPromptFile, cwd, toolArgs } = opts;
    const effortHint = this.effort ? (EFFORT_SPEED_HINTS[this.effort] ?? '') : '';

    const systemPromptArgs: string[] = [];
    if (systemPromptFile) {
      if (effortHint) {
        systemPromptArgs.push('--system-prompt-file', systemPromptFile, '--append-system-prompt', effortHint);
      } else {
        systemPromptArgs.push('--system-prompt-file', systemPromptFile);
      }
    } else if (systemPrompt) {
      const finalPrompt = effortHint ? systemPrompt + effortHint : systemPrompt;
      systemPromptArgs.push('--system-prompt', finalPrompt);
    }

    return new Promise<string>((resolve, reject) => {
      const args = [
        '--print',
        '--output-format', 'json',
        '--settings', '{"alwaysThinkingEnabled": false}',
        ...(toolArgs ?? []),
        ...(this.model ? ['--model', this.model] : []),
        ...(this.effort ? ['--effort', this.effort] : []),
        ...systemPromptArgs,
      ];

      const proc = crossSpawn(this.cliPath, args, {
        cwd: cwd ?? undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      proc.stdin!.write(prompt);
      proc.stdin!.end();

      let stdout = '';
      let stderr = '';
      let settled = false;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (graceTimer) clearTimeout(graceTimer);
        fn();
      };

      const cleanup = () => {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      };

      // Overall timeout — kill the process if it hasn't produced a result
      const timeoutTimer = setTimeout(() => {
        settle(() => {
          cleanup();
          const sessionId = extractSessionId(stdout.trim());
          reject(new CliError(null, `CLI timed out after ${this.timeout}ms`, stdout, sessionId));
        });
      }, this.timeout);

      proc.stdout!.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Once stdout contains the completed result envelope, we have everything we need.
        // Resolve immediately — don't wait for the process to exit.
        if (!settled && (stdout.includes('"stop_reason":"end_turn"') || stdout.includes('"stop_reason":"max_tokens"'))) {
          settle(() => resolve(stdout.trim()));
          // Let the process exit on its own, but force-kill if it hangs (e.g. Windows cleanup)
          graceTimer = setTimeout(() => {
            if (!proc.killed) {
              log.warn(LogModule.ClaudeCLI, 'CLI process still alive after result — force killing');
              proc.kill('SIGTERM');
            }
          }, 5_000);
        }
      });

      proc.stderr!.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (graceTimer) clearTimeout(graceTimer);
        // If we already resolved from stdout, nothing to do
        settle(() => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            const sessionId = extractSessionId(stdout.trim());
            reject(new CliError(code, stderr, stdout, sessionId));
          }
        });
      });

      proc.on('error', (err) => {
        settle(() => {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new CliError(null, `Claude CLI not found at "${this.cliPath}". Install it from https://claude.ai/code`, '', null));
          } else {
            reject(new CliError(null, (err as Error).message, '', null));
          }
        });
      });
    });
  }

}
