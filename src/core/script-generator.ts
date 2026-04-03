import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCodeRunner } from './claude-cli';
import { SpreadsheetMetadata, DocType } from '../shared/types';

export interface GeneratedParser {
  parserPath: string;
  name: string;
  docType: DocType;
}

export interface GeneratedMatcher {
  matcherPath: string;
}

const PARSER_SYSTEM_PROMPT = `You are a code generator for an accounting document extraction system. You generate Node.js CommonJS scripts that parse spreadsheet files (XLSX/CSV) into structured JSON.

## Output Format: ExtractionFileResult

The parser script MUST output a JSON object to stdout with this exact structure:

{
  "relative_path": "<the file path passed as process.argv[2]>",
  "doc_type": "<one of: bank_statement, invoice_out, invoice_in>",
  "records": [
    {
      "confidence": 1.0,
      "field_confidence": { "field_name": 1.0, ... },
      "ngay": "YYYY-MM-DD",
      "data": { ... },
      "line_items": [ ... ]
    }
  ]
}

## Document Types (doc_type)

- "bank_statement" — sao kê ngân hàng (bank statement). Data fields: ten_ngan_hang, stk, mo_ta, so_tien, ten_doi_tac
- "invoice_out" — hóa đơn đầu ra (sales/output invoice). Data fields: so_hoa_don, tong_tien, mst, ten_doi_tac, dia_chi_doi_tac
- "invoice_in" — hóa đơn đầu vào (purchase/input invoice). Data fields: so_hoa_don, tong_tien, mst, ten_doi_tac, dia_chi_doi_tac

## Invoice Line Items

For invoices, each record should include line_items array:
- mo_ta: item description
- don_gia: unit price
- so_luong: quantity
- thue_suat: tax rate as percentage (e.g. 10 for 10%)
- thanh_tien: line total

## Rules

- Dates MUST be in YYYY-MM-DD format
- Amounts are numbers (not strings), no currency symbols or thousand separators
- The parser script receives the file path as process.argv[2]
- The parser script MUST use require('xlsx') to read the file
- Output ONLY the JSON via console.log(JSON.stringify(result))
- Set confidence to 1.0 for all fields (data is from structured source)
- For bank statements: positive amounts = credit, negative = debit

## Your Response Format

Respond with a parser script in a code block:

\`\`\`parser.js
// parser code here
\`\`\`

Also include in your response text (outside code blocks) what doc_type this file is: bank_statement, invoice_out, or invoice_in.`;

const MATCHER_SYSTEM_PROMPT = `You are a code generator. Generate a Node.js CommonJS matcher script that identifies spreadsheet files with a specific structure.

The matcher script MUST:
- Export a function: module.exports = function(filePath) { return boolean }
- Use require('xlsx') with { bookSheets: true } to avoid loading all data
- Return true if the file has the same structure (sheet names, similar headers)
- Return false otherwise
- Be fast and lightweight — only check structure, not data content

Respond with ONLY a code block:

\`\`\`matcher.js
// matcher code here
\`\`\``;

export class ScriptGenerator {
  private runner: ClaudeCodeRunner;

  constructor(runner: ClaudeCodeRunner) {
    this.runner = runner;
  }

  /**
   * Generate only the parser script from metadata.
   * Matcher is generated separately after the parser is verified.
   */
  async generateParser(metadata: SpreadsheetMetadata, vaultDotPath: string): Promise<GeneratedParser> {
    const userPrompt = this.buildParserPrompt(metadata);
    const response = await this.runner.invokeRaw(userPrompt, PARSER_SYSTEM_PROMPT, path.dirname(vaultDotPath));

    const parserCode = this.extractCodeBlock(response, 'parser.js');
    if (!parserCode) {
      throw new Error('Claude response missing parser.js code block');
    }

    const docType = this.inferDocType(response);
    const name = this.generateName(metadata.fileName);

    const scriptsDir = path.join(vaultDotPath, 'scripts');
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
    }
    const parserPath = path.join(scriptsDir, `${name}-parser.js`);

    fs.writeFileSync(parserPath, parserCode);

    return { parserPath, name, docType };
  }

  /**
   * Generate a matcher script after the parser has been verified.
   * The matcher identifies files with the same structure for script reuse.
   */
  async generateMatcher(metadata: SpreadsheetMetadata, vaultDotPath: string, name: string): Promise<GeneratedMatcher> {
    const userPrompt = this.buildMatcherPrompt(metadata);
    const response = await this.runner.invokeRaw(userPrompt, MATCHER_SYSTEM_PROMPT, path.dirname(vaultDotPath));

    const matcherCode = this.extractCodeBlock(response, 'matcher.js');
    if (!matcherCode) {
      throw new Error('Claude response missing matcher.js code block');
    }

    const scriptsDir = path.join(vaultDotPath, 'scripts');
    const matcherPath = path.join(scriptsDir, `${name}-matcher.js`);

    fs.writeFileSync(matcherPath, matcherCode);

    return { matcherPath };
  }

  private buildParserPrompt(metadata: SpreadsheetMetadata): string {
    const sheetsInfo = metadata.sheets.map(sheet => {
      const colInfo = sheet.columnTypes.map(c =>
        `  - "${c.header}" (${c.inferredType}, empty: ${(c.emptyRate * 100).toFixed(0)}%, samples: ${JSON.stringify(c.sampleValues.slice(0, 3))})`
      ).join('\n');

      const sampleData = sheet.sampleRows.length > 0
        ? `\nSample rows:\n${sheet.sampleRows.map(r => JSON.stringify(r)).join('\n')}`
        : '';

      return `Sheet: "${sheet.name}" (${sheet.rowCount} data rows, ${sheet.colCount} columns)
Columns:
${colInfo}${sampleData}`;
    }).join('\n\n');

    return `Generate a parser script for this spreadsheet file.

File: ${metadata.fileName} (${metadata.fileType})
Total rows: ${metadata.totalRows}

${sheetsInfo}`;
  }

  private buildMatcherPrompt(metadata: SpreadsheetMetadata): string {
    const sheetsInfo = metadata.sheets.map(sheet =>
      `Sheet: "${sheet.name}" — headers: ${JSON.stringify(sheet.headers)}`
    ).join('\n');

    return `Generate a matcher script that identifies spreadsheet files with this structure:

File type: ${metadata.fileType}
${sheetsInfo}

The matcher should return true for files that have the same sheet names and similar headers.`;
  }

  private extractCodeBlock(response: string, label: string): string | null {
    // Match ```parser.js or ```matcher.js or ```js style blocks
    const labelRegex = new RegExp('```' + label.replace('.', '\\.') + '\\s*\\n([\\s\\S]*?)```', 'i');
    const match = response.match(labelRegex);
    if (match) return match[1].trim();

    // Fallback: match any ```js block
    const jsRegex = /```(?:js|javascript)\s*\n([\s\S]*?)```/i;
    const jsMatch = response.match(jsRegex);
    return jsMatch ? jsMatch[1].trim() : null;
  }

  private inferDocType(response: string): DocType {
    const lower = response.toLowerCase();
    if (lower.includes('bank_statement') || lower.includes('sao kê') || lower.includes('bank statement')) {
      return DocType.BankStatement;
    }
    if (lower.includes('invoice_in') || lower.includes('đầu vào') || lower.includes('purchase') || lower.includes('input invoice')) {
      return DocType.InvoiceIn;
    }
    if (lower.includes('invoice_out') || lower.includes('đầu ra') || lower.includes('sales') || lower.includes('output invoice')) {
      return DocType.InvoiceOut;
    }
    return DocType.Unknown;
  }

  private generateName(fileName: string): string {
    const base = path.basename(fileName, path.extname(fileName));
    const sanitized = base.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const timestamp = Date.now().toString(36);
    return `${sanitized}-${timestamp}`;
  }
}
