import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCodeRunner } from './claude-cli';
import { SpreadsheetMetadata, DocType } from '../shared/types';
import { log, LogModule } from './logger';

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
      "doc_date": "YYYY-MM-DD",
      "data": { ... },
      "line_items": [ ... ]
    }
  ]
}

## Document Types (doc_type)

- "bank_statement" — sao kê ngân hàng (bank statement). Data fields: bank_name, account_number, invoice_code, invoice_number, description, amount, counterparty_name
- "invoice_out" — hóa đơn đầu ra (sales/output invoice). Data fields: invoice_code, invoice_number, total_before_tax, total_amount, fee_amount, fee_description, tax_id, counterparty_name, counterparty_address
- "invoice_in" — hóa đơn đầu vào (purchase/input invoice). Data fields: invoice_code, invoice_number, total_before_tax, total_amount, fee_amount, fee_description, tax_id, counterparty_name, counterparty_address

## Invoice Reference Split

- \`invoice_code\` = Ký hiệu hóa đơn (examples: \`KHHDon\`, \`Ký hiệu HĐ\`)
- \`invoice_number\` = Số hóa đơn (examples: \`SHDon\`, \`Số HĐ\`)
- NEVER concatenate invoice code and invoice number into a single field
- If only one is visible, populate that field and leave the other null

## Invoice Line Items

For invoices, each record should include line_items array:
- description: item description / tên hàng hóa, dịch vụ
- unit_price: unit price (before tax) / đơn giá
- quantity: quantity / số lượng
- tax_rate: tax rate as a percentage INTEGER (e.g. 8 for 8%, 10 for 10%) / thuế suất. NEVER output decimals like 0.08 — if the source data has 0.08, multiply by 100 to get 8.
- subtotal: line total BEFORE tax / thành tiền (usually = unit_price × quantity)
- total_with_tax: line total AFTER tax (usually = subtotal × (1 + tax_rate/100))

## Amount Fields — CRITICAL RULES

**Tax rate normalization:**
- If the source spreadsheet stores tax rates as decimals (0.08, 0.1, 0.05), multiply by 100 to convert to percentage integers (8, 10, 5).

**Line item amounts — STRONGLY prefer BEFORE-tax:**
- If both before-tax and after-tax columns exist, map both (subtotal and total_with_tax)
- If only ONE amount column exists for line items, map it to subtotal (before-tax) UNLESS the column header explicitly says after-tax (e.g. "đã bao gồm thuế", "sau thuế", "bao gồm VAT")
- Column headers like "Thành tiền", "Đơn giá × SL", "Cộng tiền hàng" → before-tax (subtotal)
- If tax is only applied to the invoice total (not per line item), line values are ALWAYS before-tax
- When in doubt, set as subtotal and leave total_with_tax as null

**Invoice total:**
- total_amount = final payment amount including VAT (usually the biggest total on the document) / tổng cộng thanh toán
- total_before_tax = subtotal before VAT / cộng tiền hàng
- total_amount ≈ total_before_tax + tax + fee_amount (when fee exists)

**Cross-check:** If the document total ≈ SUM(line amounts), those are after-tax. If total ≈ SUM(line amounts) × (1 + rate/100), those are before-tax. Use this to choose the correct mapping.

## Error Collection — REQUIRED

The parser MUST collect field-level parsing errors and include them in the output. This enables automatic detection of format mismatches when the parser is reused on similar files.

**Pattern:**
- Maintain an \`_errors\` array throughout parsing
- For each numeric field, validate after parsing — if \`isNaN()\`, push an error object and use \`null\` for the field value
- For each required string field, check if value is missing/empty when expected
- Continue processing remaining rows even if some fields fail (never crash on bad data)
- Include the errors array in the output as \`_parsing_errors\`

**Error object format:** \`{ row: <rowIndex>, field: "<fieldName>", rawValue: <originalValue>, error: "<description>" }\`

**Example:**
\`\`\`js
const _errors = [];
// For each row:
const taxRateRaw = row['Thuế suất (%)'];
let tax_rate = null;
if (taxRateRaw != null && taxRateRaw !== '') {
  const parsed = typeof taxRateRaw === 'string' ? parseFloat(taxRateRaw) : Number(taxRateRaw);
  if (isNaN(parsed)) {
    _errors.push({ row: i, field: 'tax_rate', rawValue: taxRateRaw, error: 'Not a number' });
  } else {
    tax_rate = parsed < 1 ? parsed * 100 : parsed;
  }
}
// ... at the end:
result._parsing_errors = _errors;
\`\`\`

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
- Use require('xlsx') to read headers only (first row of each sheet)
- Return true ONLY if the file has EXACTLY the same sheet names AND ALL expected headers are present in each sheet
- Return false if any expected sheet is missing or any expected header is absent
- Extra columns in the file are OK (return true), but missing expected columns must return false
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
  async generateParser(metadata: SpreadsheetMetadata, vaultDotPath: string, userHint?: string): Promise<GeneratedParser> {
    log.info(LogModule.Script, `Generating parser for ${metadata.fileName}`);
    let userPrompt = this.buildParserPrompt(metadata);
    if (userHint) {
      userPrompt += `\n\n## User Feedback on Previous Extraction\n\nThe user reported the following issue with a previous extraction of this file. Use this to guide your parser generation:\n\n${userHint}`;
    }
    const response = await this.runner.invokeRaw(userPrompt, PARSER_SYSTEM_PROMPT, path.dirname(vaultDotPath));

    const parserCode = this.extractCodeBlock(response, 'parser.js');
    if (!parserCode) {
      log.error(LogModule.Script, `Parser generation failed: missing code block`, { fileName: metadata.fileName });
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

    log.info(LogModule.Script, `Parser generated: ${name} (${docType})`, { parserPath });
    return { parserPath, name, docType };
  }

  /**
   * Generate a matcher script after the parser has been verified.
   * The matcher identifies files with the same structure for script reuse.
   */
  async generateMatcher(metadata: SpreadsheetMetadata, vaultDotPath: string, name: string): Promise<GeneratedMatcher> {
    log.info(LogModule.Script, `Generating matcher for ${name}`);
    const userPrompt = this.buildMatcherPrompt(metadata);
    const response = await this.runner.invokeRaw(userPrompt, MATCHER_SYSTEM_PROMPT, path.dirname(vaultDotPath));

    const matcherCode = this.extractCodeBlock(response, 'matcher.js');
    if (!matcherCode) {
      log.error(LogModule.Script, `Matcher generation failed: missing code block`, { name });
      throw new Error('Claude response missing matcher.js code block');
    }

    const scriptsDir = path.join(vaultDotPath, 'scripts');
    const matcherPath = path.join(scriptsDir, `${name}-matcher.js`);

    fs.writeFileSync(matcherPath, matcherCode);

    log.info(LogModule.Script, `Matcher generated`, { matcherPath });
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

The matcher MUST return true only if the file has exactly these sheet names AND all listed headers are present in their respective sheets. Extra headers in the file are acceptable.`;
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
