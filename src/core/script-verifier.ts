import * as fs from 'fs';
import { ClaudeCodeRunner } from './claude-cli';
import { executeScript } from './script-sandbox';
import { SpreadsheetMetadata, ExtractionFileResult, VerificationResult } from '../shared/types';
import { SCRIPT_VERIFY_MAX_RETRIES } from '../shared/constants';

/** Max records to include in truncated output sent to Claude */
const TRUNCATE_MAX_RECORDS = 3;
/** Max chars per string field in truncated output */
const TRUNCATE_FIELD_MAX_CHARS = 200;
/** Max total chars for the JSON output sent to Claude */
const TRUNCATE_OUTPUT_MAX_CHARS = 4000;

type JsonObject = Record<string, unknown>;

export interface VerifyOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

const JUDGE_SYSTEM_PROMPT = `You are a code reviewer for an accounting document parser script. You are given:
1. The spreadsheet metadata (headers, column types, sample rows)
2. The current parser script
3. The parser's output (truncated) OR an error message

Your job is to judge whether the parser script correctly extracts the data.

## Checks
- Does the doc_type match the document content? (bank_statement, invoice_out, invoice_in)
- Are field mappings correct? (headers → schema fields)
- Are dates in YYYY-MM-DD format?
- Are amounts numeric (not strings)?
- Are records being extracted (not empty)?
- Does the output structure match ExtractionFileResult schema?
- Are \`invoice_code\` and \`invoice_number\` kept separate when both are present?
- Are tax_rate values percentage INTEGERS (8, 10, 5)? If you see decimals like 0.08 or 0.1, the script must multiply by 100.
- Are line item amounts correctly mapped? If only one amount column exists and it's ambiguous, it should go to subtotal (before-tax), NOT total_with_tax. If all total_with_tax values are populated but subtotal is all null, this is likely WRONG — the amounts are probably before-tax.
- Cross-check: does total_amount ≈ SUM(total_with_tax) or SUM(subtotal × (1+rate/100))? Use this to verify correct before/after-tax mapping.

## Expected Output Schema

{
  "relative_path": "...",
  "doc_type": "bank_statement | invoice_out | invoice_in",
  "records": [
    {
      "confidence": 1.0,
      "field_confidence": { "field": 1.0, ... },
      "doc_date": "YYYY-MM-DD",
      "data": { ... },
      "line_items": [ ... ]
    }
  ]
}

### Bank Statement data fields: bank_name, account_number, invoice_code, invoice_number, description, amount, counterparty_name
### Invoice data fields: invoice_code, invoice_number, total_before_tax, total_amount, fee_amount, fee_description, tax_id, counterparty_name, counterparty_address
### Invoice line_items fields: description, unit_price, quantity, tax_rate, subtotal, total_with_tax

## Response Format

If the output looks correct, respond with EXACTLY:
APPROVED

If the script needs fixing, respond with the fixed script in a code block:
\`\`\`parser.js
// fixed code here
\`\`\`

Do NOT include both. Either APPROVED or a code block, never both.`;

export class ScriptVerifier {
  private runner: ClaudeCodeRunner;

  constructor(runner: ClaudeCodeRunner) {
    this.runner = runner;
  }

  /**
   * Iterative verify-and-refine loop.
   * Runs the parser on the actual file, sends output (or error) to Claude for judgment.
   * Claude either approves or returns a fixed script. Repeats until approved or max retries.
   */
  async verifyAndRefine(
    parserPath: string,
    filePath: string,
    metadata: SpreadsheetMetadata,
    vaultRootPath: string,
    options?: VerifyOptions,
  ): Promise<VerificationResult> {
    const maxRetries = options?.maxRetries ?? SCRIPT_VERIFY_MAX_RETRIES;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 1. Run the parser script on the actual file
      let output: ExtractionFileResult | null = null;
      let runError: string | null = null;

      try {
        output = await executeScript(parserPath, filePath, {
          timeoutMs: options?.timeoutMs,
        });
      } catch (err) {
        runError = (err as Error).message;
      }

      // 2. Build prompt with metadata + script + output/error
      const currentScript = fs.readFileSync(parserPath, 'utf-8');
      const prompt = this.buildJudgePrompt(metadata, currentScript, output, runError);

      // 3. Ask Claude to judge
      console.log(`[ScriptVerifier] Attempt ${attempt + 1}/${maxRetries + 1}: ${runError ? 'error' : `${output?.records?.length ?? 0} records`}`);
      const response = await this.runner.invokeRaw(prompt, JUDGE_SYSTEM_PROMPT, vaultRootPath);

      // 4. Check Claude's verdict
      if (this.isApproved(response)) {
        if (!output) {
          // Claude said APPROVED but script had an error — shouldn't happen, but handle it
          return { success: false, error: `Script error despite approval: ${runError}` };
        }
        console.log(`[ScriptVerifier] APPROVED on attempt ${attempt + 1}`);
        return { success: true, output };
      }

      // 5. Extract fixed script from response
      const fixedCode = this.extractCodeBlock(response);
      if (fixedCode) {
        fs.writeFileSync(parserPath, fixedCode);
        console.log(`[ScriptVerifier] Claude provided fix, retrying...`);
        continue;
      }

      // Claude responded but no APPROVED and no code block — treat as error
      console.warn(`[ScriptVerifier] Unexpected response (no APPROVED, no code block), retrying...`);
    }

    return {
      success: false,
      error: `Script verification failed after ${maxRetries + 1} attempts`,
    };
  }

  private buildJudgePrompt(
    metadata: SpreadsheetMetadata,
    script: string,
    output: ExtractionFileResult | null,
    error: string | null,
  ): string {
    const metadataStr = this.formatMetadata(metadata);

    let resultSection: string;
    if (error) {
      resultSection = `## Runtime Error\n${error}`;
    } else if (output) {
      const truncated = this.truncateOutput(output);
      resultSection = `## Parser Output (truncated)\nTotal records: ${output.records?.length ?? 0}\n\n\`\`\`json\n${truncated}\n\`\`\``;
    } else {
      resultSection = `## Parser Output\nNo output produced.`;
    }

    return `Review this parser script's output for correctness.

## Spreadsheet Metadata
${metadataStr}

## Current Parser Script
\`\`\`js
${script}
\`\`\`

${resultSection}

Judge whether the parser correctly extracts the data. Respond with APPROVED if correct, or provide a fixed \`\`\`parser.js\`\`\` code block.`;
  }

  private formatMetadata(metadata: SpreadsheetMetadata): string {
    return metadata.sheets.map(sheet => {
      const colInfo = sheet.columnTypes.map(c =>
        `  - "${c.header}" (${c.inferredType}, empty: ${(c.emptyRate * 100).toFixed(0)}%, samples: ${JSON.stringify(c.sampleValues.slice(0, 3))})`
      ).join('\n');

      const sampleData = sheet.sampleRows.length > 0
        ? `\nSample rows:\n${sheet.sampleRows.map(r => JSON.stringify(r)).join('\n')}`
        : '';

      return `Sheet: "${sheet.name}" (${sheet.rowCount} data rows, ${sheet.colCount} columns)\nColumns:\n${colInfo}${sampleData}`;
    }).join('\n\n');
  }

  private truncateOutput(output: ExtractionFileResult): string {
    // Create a truncated copy with limited records and capped string fields
    const truncated: JsonObject = {
      relative_path: output.relative_path,
      doc_type: output.doc_type,
      records: (output.records || []).slice(0, TRUNCATE_MAX_RECORDS).map(record => {
        const truncRecord: JsonObject = {
          confidence: record.confidence,
          doc_date: record.doc_date,
          data: this.truncateStrings(record.data),
        };
        if (record.field_confidence) {
          truncRecord.field_confidence = record.field_confidence;
        }
        if (record.line_items && record.line_items.length > 0) {
          truncRecord.line_items = record.line_items.slice(0, 3).map(li => this.truncateStrings(li));
          if (record.line_items.length > 3) {
            truncRecord._line_items_total = record.line_items.length;
          }
        }
        return truncRecord;
      }),
    };

    if ((output.records?.length ?? 0) > TRUNCATE_MAX_RECORDS) {
      truncated._total_records = output.records.length;
    }

    let json = JSON.stringify(truncated, null, 2);
    if (json.length > TRUNCATE_OUTPUT_MAX_CHARS) {
      json = json.substring(0, TRUNCATE_OUTPUT_MAX_CHARS) + '\n... (truncated)';
    }
    return json;
  }

  private truncateStrings(obj: unknown): unknown {
    if (!obj || typeof obj !== 'object') return obj;
    const result: JsonObject = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.length > TRUNCATE_FIELD_MAX_CHARS) {
        result[key] = value.substring(0, TRUNCATE_FIELD_MAX_CHARS) + '...';
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private isApproved(response: string): boolean {
    // Check if response contains APPROVED (not inside a code block)
    const withoutCodeBlocks = response.replace(/```[\s\S]*?```/g, '');
    return /\bAPPROVED\b/.test(withoutCodeBlocks);
  }

  private extractCodeBlock(response: string): string | null {
    const regex = /```(?:parser\.js|js|javascript)\s*\n([\s\S]*?)```/i;
    const match = response.match(regex);
    return match ? match[1].trim() : null;
  }
}
