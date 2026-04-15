import { spawn, exec } from 'child_process';
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
    const raw = await this.invoke(userPrompt, systemPrompt, cwd);
    return unwrapEnvelope(raw) ?? raw;
  }

  invoke(prompt: string, systemPrompt: string, cwd?: string, toolArgs?: string[]): Promise<string> {
    const effortHint = this.effort ? (EFFORT_SPEED_HINTS[this.effort] ?? '') : '';
    const finalSystemPrompt = effortHint ? systemPrompt + effortHint : systemPrompt;
    return new Promise((resolve, reject) => {
      const args = [
        '--print',
        '--output-format', 'json',
        ...(toolArgs ?? []),
        ...(this.model ? ['--model', this.model] : []),
        ...(this.effort ? ['--effort', this.effort] : []),
        '--system-prompt', finalSystemPrompt,
        prompt,
      ];

      const proc = spawn(this.cliPath, args, {
        cwd: cwd ?? undefined,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';
      let completed = false;

      const killTimer = setTimeout(() => {
        if (!completed) {
          proc.kill('SIGTERM');
        }
      }, this.timeout);

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Cancel the kill timer as soon as we see a completed result envelope —
        // the process has finished its work; no need to kill it.
        if (!completed && stdout.includes('"stop_reason":"end_turn"')) {
          completed = true;
          clearTimeout(killTimer);
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(killTimer);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          // CLI may have completed successfully but been killed after writing output
          // (e.g. timeout SIGTERM arrives just after process finishes). If stdout contains
          // a completed result envelope (possibly truncated mid-stream), treat it as success.
          const trimmed = stdout.trim();
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed?.type === 'result' && parsed?.is_error === false && parsed?.stop_reason === 'end_turn') {
              log.warn(LogModule.ClaudeCLI, `CLI exited ${code} but stdout has completed result — treating as success`);
              resolve(trimmed);
              return;
            }
          } catch { /* not a complete valid envelope — try repair below */ }

          // If stdout was truncated mid-stream, attempt to salvage using repairTruncatedJSON.
          // This handles the race where SIGTERM arrives just as stdout is being flushed.
          if (trimmed.includes('"type":"result"') && trimmed.includes('"stop_reason":"end_turn"')) {
            const repaired = repairTruncatedJSON(trimmed);
            if (repaired) {
              try {
                const parsed = JSON.parse(repaired);
                if (parsed?.type === 'result' && parsed?.is_error === false && parsed?.stop_reason === 'end_turn') {
                  log.warn(LogModule.ClaudeCLI, `CLI exited ${code} but repaired truncated envelope — treating as success`);
                  resolve(repaired);
                  return;
                }
              } catch { /* repair didn't help */ }
            }
          }

          const sessionId = extractSessionId(trimmed);
          reject(new CliError(code, stderr, stdout, sessionId));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(killTimer);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new CliError(null, `Claude CLI not found at "${this.cliPath}". Install it from https://claude.ai/code`, '', null));
        } else {
          reject(new CliError(null, (err as Error).message, '', null));
        }
      });
    });
  }

}
