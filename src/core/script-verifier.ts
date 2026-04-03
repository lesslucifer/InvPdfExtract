import * as fs from 'fs';
import { ClaudeCodeRunner } from './claude-cli';
import { executeScript } from './script-sandbox';
import { SpreadsheetMetadata, ExtractionFileResult, VerificationResult, DocType } from '../shared/types';
import { SCRIPT_VERIFY_MAX_RETRIES } from '../shared/constants';

const VALID_DOC_TYPES = new Set([
  DocType.BankStatement,
  DocType.InvoiceOut,
  DocType.InvoiceIn,
]);

export interface VerifyOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

export class ScriptVerifier {
  private runner: ClaudeCodeRunner;

  constructor(runner: ClaudeCodeRunner) {
    this.runner = runner;
  }

  async verifyScript(
    parserPath: string,
    filePath: string,
    metadata: SpreadsheetMetadata,
    vaultDotPath: string,
    options?: VerifyOptions,
  ): Promise<VerificationResult> {
    const maxRetries = options?.maxRetries ?? SCRIPT_VERIFY_MAX_RETRIES;
    let lastError = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Execute the script
        const output = await executeScript(parserPath, filePath, {
          timeoutMs: options?.timeoutMs,
        });

        // Validate structure
        const validationError = this.validateOutput(output);
        if (validationError) {
          lastError = validationError;
          if (attempt < maxRetries) {
            await this.requestFix(parserPath, lastError, metadata);
            continue;
          }
          return { success: false, error: lastError };
        }

        return { success: true, output };
      } catch (err) {
        lastError = (err as Error).message;
        if (attempt < maxRetries) {
          await this.requestFix(parserPath, lastError, metadata);
          continue;
        }
      }
    }

    return { success: false, error: lastError };
  }

  private validateOutput(output: ExtractionFileResult): string | null {
    if (!output.records || !Array.isArray(output.records)) {
      return 'Output missing "records" array';
    }

    if (!VALID_DOC_TYPES.has(output.doc_type as DocType)) {
      return `Invalid doc_type: "${output.doc_type}". Must be one of: ${Array.from(VALID_DOC_TYPES).join(', ')}`;
    }

    for (let i = 0; i < output.records.length; i++) {
      const record = output.records[i];
      if (!record.data) {
        return `Record ${i} missing "data" field`;
      }
    }

    return null;
  }

  private async requestFix(
    parserPath: string,
    error: string,
    metadata: SpreadsheetMetadata,
  ): Promise<void> {
    const currentScript = fs.readFileSync(parserPath, 'utf-8');

    const prompt = `The following parser script produced an error. Please fix it.

## Error
${error}

## Current Script
\`\`\`js
${currentScript}
\`\`\`

## File Metadata
${JSON.stringify(metadata, null, 2)}

Return the fixed script in a \`\`\`parser.js code block.`;

    const systemPrompt = 'You are a code fixer. Return ONLY the fixed parser script in a ```parser.js code block. Do not include any other code blocks.';

    const response = await this.runner.invokeRaw(prompt, systemPrompt);
    const fixedCode = this.extractCodeBlock(response);
    if (fixedCode) {
      fs.writeFileSync(parserPath, fixedCode);
    }
  }

  private extractCodeBlock(response: string): string | null {
    const regex = /```(?:parser\.js|js)\s*\n([\s\S]*?)```/i;
    const match = response.match(regex);
    return match ? match[1].trim() : null;
  }
}
