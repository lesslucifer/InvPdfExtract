import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCodeRunner } from './claude-cli';
import { SpreadsheetMetadata, GeneratedScripts, DocType } from '../shared/types';

const SYSTEM_PROMPT = `You are a code generator for an accounting document extraction system. You generate Node.js CommonJS scripts that parse spreadsheet files (XLSX/CSV) into structured JSON.

## Output Format: ExtractionFileResult

The parser script MUST output a JSON object to stdout with this exact structure:

{
  "relative_path": "<the file path passed as process.argv[2]>",
  "doc_type": "<one of: bank_statement, invoice_out, invoice_in>",
  "records": [
    {
      "confidence": 0.95,
      "field_confidence": { "field_name": 0.95, ... },
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

You MUST respond with TWO code blocks:

1. A parser script labeled \`parser.js\`:
\`\`\`parser.js
// parser code here
\`\`\`

2. A matcher script labeled \`matcher.js\`:
\`\`\`matcher.js
// matcher code here
\`\`\`

The matcher script MUST export a function: module.exports = function(filePath) { return boolean }
The matcher should identify files with the same structure (same sheet names, similar headers).
The matcher should use require('xlsx') with { bookSheets: true } to avoid loading all data.

Also include in your response text (outside code blocks) what doc_type this file is: bank_statement, invoice_out, or invoice_in.`;

export class ScriptGenerator {
  private runner: ClaudeCodeRunner;

  constructor(runner: ClaudeCodeRunner) {
    this.runner = runner;
  }

  async generateScripts(metadata: SpreadsheetMetadata, vaultDotPath: string): Promise<GeneratedScripts> {
    const userPrompt = this.buildUserPrompt(metadata);
    const response = await this.runner.invokeRaw(userPrompt, SYSTEM_PROMPT);

    const parserCode = this.extractCodeBlock(response, 'parser.js');
    if (!parserCode) {
      throw new Error('Claude response missing parser.js code block');
    }

    const matcherCode = this.extractCodeBlock(response, 'matcher.js');
    if (!matcherCode) {
      throw new Error('Claude response missing matcher.js code block');
    }

    const docType = this.inferDocType(response);
    const name = this.generateName(metadata.fileName);

    const scriptsDir = path.join(vaultDotPath, 'scripts');
    const parserPath = path.join(scriptsDir, `${name}-parser.js`);
    const matcherPath = path.join(scriptsDir, `${name}-matcher.js`);

    fs.writeFileSync(parserPath, parserCode);
    fs.writeFileSync(matcherPath, matcherCode);

    return { parserPath, matcherPath, name, docType };
  }

  private buildUserPrompt(metadata: SpreadsheetMetadata): string {
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

    return `Generate parser and matcher scripts for this spreadsheet file.

File: ${metadata.fileName} (${metadata.fileType})
Total rows: ${metadata.totalRows}

${sheetsInfo}`;
  }

  private extractCodeBlock(response: string, label: string): string | null {
    // Match ```parser.js or ```js parser.js style blocks
    const regex = new RegExp('```' + label.replace('.', '\\.') + '\\s*\\n([\\s\\S]*?)```', 'i');
    const match = response.match(regex);
    return match ? match[1].trim() : null;
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
    // Sanitize: keep alphanumeric, hyphens, underscores
    const sanitized = base.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const timestamp = Date.now().toString(36);
    return `${sanitized}-${timestamp}`;
  }
}
