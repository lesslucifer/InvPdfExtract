import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ExtractionResult } from '../shared/types';
import { DEFAULT_CLI_TIMEOUT } from '../shared/constants';

export class ClaudeCodeRunner {
  private cliPath: string;
  private timeout: number;

  constructor(cliPath?: string, timeout?: number) {
    this.cliPath = cliPath || 'claude';
    this.timeout = timeout || DEFAULT_CLI_TIMEOUT;
  }

  static isAvailable(cliPath?: string): boolean {
    try {
      execSync(`${cliPath || 'claude'} --version`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  async processFiles(filePaths: string[], vaultRoot: string, systemPromptPath: string): Promise<{ result: ExtractionResult; sessionLog: string }> {
    const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');

    const relativePaths = filePaths.map(fp => path.relative(vaultRoot, fp));
    const fileList = relativePaths.map(p => `- ${p}`).join('\n');

    const userPrompt = `Process these accounting files and return structured JSON.

Files:
${fileList}

The files are located relative to: ${vaultRoot}

For each file:
1. CLASSIFY: Determine document type (bank_statement, invoice_out, invoice_in)
2. EXTRACT: Read the document using vision and extract all fields per the schema
3. SCORE: Provide confidence 0.0-1.0 per field and overall
4. Return the JSON output matching the exact format specified in the system prompt

IMPORTANT: Return ONLY the JSON object, no markdown code fences, no extra text.`;

    const stdout = await this.invokeClaudeCLI(userPrompt, systemPrompt);
    const sessionLog = `PROMPT:\n${userPrompt}\n\nRESPONSE:\n${stdout}`;

    const result = this.parseResponse(stdout);
    return { result, sessionLog };
  }

  async invokeRaw(userPrompt: string, systemPrompt: string): Promise<string> {
    return this.invokeClaudeCLI(userPrompt, systemPrompt);
  }

  private invokeClaudeCLI(prompt: string, systemPrompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['--print', '--system-prompt', systemPrompt, prompt];

      const proc = spawn(this.cliPath, args, {
        timeout: this.timeout,
        cwd: undefined,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`Claude CLI not found at "${this.cliPath}". Install it from https://claude.ai/code`));
        } else {
          reject(err);
        }
      });
    });
  }

  private parseResponse(raw: string): ExtractionResult {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      const firstNewline = cleaned.indexOf('\n');
      cleaned = cleaned.slice(firstNewline + 1);
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, cleaned.lastIndexOf('```'));
      }
    }
    cleaned = cleaned.trim();

    try {
      const parsed = JSON.parse(cleaned);

      // Validate basic structure
      if (!parsed.results || !Array.isArray(parsed.results)) {
        throw new Error('Response missing "results" array');
      }

      return parsed as ExtractionResult;
    } catch (err) {
      throw new Error(`Failed to parse Claude CLI response as JSON: ${(err as Error).message}\nRaw output:\n${raw.slice(0, 500)}`);
    }
  }
}
