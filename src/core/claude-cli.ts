import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExtractionResult, ModelTier, MODEL_TIER_MAP } from '../shared/types';
import { DEFAULT_CLI_TIMEOUT, MIN_PDF_TEXT_CHARS } from '../shared/constants';
import { extractPdfText } from './filters/content-sniffer';

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

  constructor(cliPath?: string, timeout?: number, modelTier?: ModelTier) {
    this.cliPath = cliPath || 'claude';
    this.timeout = timeout || DEFAULT_CLI_TIMEOUT;
    this.model = modelTier ? MODEL_TIER_MAP[modelTier] : undefined;
  }

  static async isAvailable(cliPath?: string): Promise<boolean> {
    try {
      await execAsync(`${cliPath || 'claude'} --version`);
      return true;
    } catch {
      return false;
    }
  }

  async processFiles(filePaths: string[], vaultRoot: string, systemPromptPath: string): Promise<{ result: ExtractionResult; sessionLog: string }> {
    const systemPrompt = await fs.promises.readFile(systemPromptPath, 'utf-8');

    // Pre-extract text from PDFs in parallel using worker threads (non-blocking).
    // PDFs with insufficient text are scanned images — they fall back to Claude's vision via Read tool.
    const textResults = await Promise.all(
      filePaths.map(async fp => {
        try {
          const text = await extractPdfText(fp);
          return { filePath: fp, text, isTextBased: text.trim().length >= MIN_PDF_TEXT_CHARS };
        } catch {
          return { filePath: fp, text: '', isTextBased: false };
        }
      })
    );

    const textBased = textResults.filter(r => r.isTextBased);
    const imageBased = textResults.filter(r => !r.isTextBased);

    console.log(`[ClaudeCodeRunner] Text-based: ${textBased.length}, image-based: ${imageBased.length}`);

    // Build prompt sections
    const textSection = textBased.length > 0
      ? `## Text-extractable files (classify and extract from the text below)\n\n${
          textBased.map(r => {
            const rel = path.relative(vaultRoot, r.filePath);
            return `### File: ${rel}\n${r.text.trim()}`;
          }).join('\n\n')
        }`
      : '';

    const imageSection = imageBased.length > 0
      ? `## Image-only files (use Read tool for vision processing)\n${
          imageBased.map(r => `- ${path.relative(vaultRoot, r.filePath)}`).join('\n')
        }`
      : '';

    const userPrompt = `Process these accounting files and return structured JSON.

${[textSection, imageSection].filter(Boolean).join('\n\n')}

For each file, return a result with relative_path matching exactly as shown above.
1. CLASSIFY: Determine document type (bank_statement, invoice_out, invoice_in)
2. EXTRACT: All fields per the schema in the system prompt
3. SCORE: Confidence 0.0-1.0 per field and overall

IMPORTANT: Return ONLY the JSON object, no markdown code fences, no extra text.`;

    // Only allow Read tool if there are image-based files that need vision processing.
    // Disable all tools when all files have extracted text — no tool loop needed.
    const toolArgs = imageBased.length > 0
      ? ['--allowedTools', 'Read']
      : ['--tools', ''];

    const stdout = await this.invokeClaudeCLI(userPrompt, systemPrompt, vaultRoot, toolArgs);
    const allRelative = filePaths.map(fp => path.relative(vaultRoot, fp));
    let sessionLog = `PROMPT:\n${userPrompt}\n\nRESPONSE:\n${stdout}`;

    try {
      const result = this.parseResponse(stdout);
      return { result, sessionLog };
    } catch (firstErr) {
      console.warn(`[ClaudeCodeRunner] Parse failed, retrying with JSON emphasis: ${(firstErr as Error).message}`);

      const retryPrompt = `Your previous response could not be parsed as valid JSON.
Please try again for the same files. Return ONLY a valid JSON object matching the ExtractionResult schema.
Do NOT include any explanation, thinking, commentary, or markdown — output raw JSON only, starting with { and ending with }.
If your previous output was truncated, produce a shorter response.

Files:
${allRelative.map(p => `- ${p}`).join('\n')}

Located relative to: ${vaultRoot}`;

      const retryStdout = await this.invokeClaudeCLI(retryPrompt, systemPrompt, vaultRoot, toolArgs);
      sessionLog += `\n\nRETRY PROMPT:\n${retryPrompt}\n\nRETRY RESPONSE:\n${retryStdout}`;

      const result = this.parseResponse(retryStdout);
      return { result, sessionLog };
    }
  }

  async invokeRaw(userPrompt: string, systemPrompt: string, cwd?: string): Promise<string> {
    const raw = await this.invokeClaudeCLI(userPrompt, systemPrompt, cwd);
    return unwrapEnvelope(raw) ?? raw;
  }

  private invokeClaudeCLI(prompt: string, systemPrompt: string, cwd?: string, toolArgs?: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '--print',
        '--output-format', 'json',
        ...(toolArgs ?? []),
        ...(this.model ? ['--model', this.model] : []),
        '--system-prompt', systemPrompt,
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
              console.warn(`[ClaudeCodeRunner] CLI exited ${code} but stdout has completed result — treating as success`);
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
                  console.warn(`[ClaudeCodeRunner] CLI exited ${code} but repaired truncated envelope — treating as success`);
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

  parseResponse(raw: string): ExtractionResult {
    // Step 0: Unwrap --output-format json envelope if present
    const unwrapped = unwrapEnvelope(raw);
    const text = unwrapped ?? raw;

    // Step 1: Strip markdown code fences if present
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      const firstNewline = cleaned.indexOf('\n');
      cleaned = cleaned.slice(firstNewline + 1);
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, cleaned.lastIndexOf('```'));
      }
    }
    cleaned = cleaned.trim();

    // Step 2: Try direct parse
    const directResult = this.tryParseExtractionResult(cleaned);
    if (directResult) return directResult;

    // Step 3: Bracket-counting JSON extraction
    const extracted = extractJSON(text);
    if (extracted) {
      const extractedResult = this.tryParseExtractionResult(extracted);
      if (extractedResult) return extractedResult;
    }

    // Step 4: Truncated JSON repair
    const repaired = repairTruncatedJSON(text);
    if (repaired) {
      const repairedResult = this.tryParseExtractionResult(repaired);
      if (repairedResult) {
        console.warn('[ClaudeCodeRunner] Parsed truncated JSON — extraction data may be incomplete');
        return repairedResult;
      }
    }

    // Step 5: All strategies failed
    const hasOpenBrace = text.indexOf('{') !== -1;
    const endsWithBrace = text.trimEnd().endsWith('}');
    const hint = hasOpenBrace && !endsWithBrace ? ' (output appears truncated)' : '';
    throw new Error(`Failed to parse Claude CLI response as JSON${hint}\nRaw output:\n${text.slice(0, 500)}`);
  }

  private tryParseExtractionResult(text: string): ExtractionResult | null {
    try {
      const parsed = JSON.parse(text);
      if (!parsed.results || !Array.isArray(parsed.results)) return null;
      return parsed as ExtractionResult;
    } catch {
      return null;
    }
  }
}
