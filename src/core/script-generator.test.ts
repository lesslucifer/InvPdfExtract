import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScriptGenerator } from './script-generator';
import { ClaudeCodeRunner } from './claude-cli';
import { SpreadsheetMetadata, DocType } from '../shared/types';

function makeSampleMetadata(): SpreadsheetMetadata {
  return {
    fileName: 'test-invoice.xlsx',
    fileType: 'xlsx',
    totalRows: 10,
    sheets: [
      {
        name: 'Invoices',
        headers: ['STT', 'Ký hiệu HĐ', 'Số HĐ', 'Ngày lập', 'TaxID', 'Tổng tiền'],
        rowCount: 10,
        colCount: 6,
        columnTypes: [
          { header: 'STT', inferredType: 'number', sampleValues: [1, 2], emptyRate: 0 },
          { header: 'Ký hiệu HĐ', inferredType: 'string', sampleValues: ['C26AAE'], emptyRate: 0 },
          { header: 'Số HĐ', inferredType: 'string', sampleValues: ['HD001'], emptyRate: 0 },
          { header: 'Ngày lập', inferredType: 'date', sampleValues: ['01/01/2026'], emptyRate: 0 },
          { header: 'TaxID', inferredType: 'string', sampleValues: ['0305008980'], emptyRate: 0 },
          { header: 'Tổng tiền', inferredType: 'number', sampleValues: [1000000], emptyRate: 0 },
        ],
        sampleRows: [
          { STT: 1, 'Ký hiệu HĐ': 'C26AAE', 'Số HĐ': 'HD001', 'Ngày lập': '01/01/2026', TaxID: '0305008980', 'Tổng tiền': 1000000 },
        ],
      },
    ],
  };
}

function makeParserResponse(parserCode: string, docType = 'invoice_out'): string {
  return `Based on the metadata, this is a sales invoice file (${docType}).

\`\`\`parser.js
${parserCode}
\`\`\``;
}

function makeMatcherResponse(matcherCode: string): string {
  return `Here is the matcher:

\`\`\`matcher.js
${matcherCode}
\`\`\``;
}

const SAMPLE_PARSER = `const XLSX = require('xlsx');
const wb = XLSX.readFile(process.argv[2]);
const ws = wb.Sheets['Invoices'];
const rows = XLSX.utils.sheet_to_json(ws);
const result = {
  file_id: '',
  doc_type: 'invoice_out',
  records: rows.map(r => ({
    confidence: 1.0,
    field_confidence: {},
    doc_date: r['Ngày lập'] || null,
    data: { invoice_code: r['Ký hiệu HĐ'], invoice_number: r['Số HĐ'], total_amount: r['Tổng tiền'], tax_id: r['TaxID'] },
    line_items: []
  }))
};
console.log(JSON.stringify(result));`;

const SAMPLE_MATCHER = `module.exports = function(filePath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { bookSheets: true });
  return wb.SheetNames.includes('Invoices');
};`;

describe('ScriptGenerator', () => {
  let tmpDir: string;
  let runner: ClaudeCodeRunner;
  let generator: ScriptGenerator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptgen-'));
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
    runner = new ClaudeCodeRunner();
    generator = new ScriptGenerator(runner);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── generateParser ──

  describe('generateParser', () => {
    it('includes sheet metadata in the prompt', async () => {
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeParserResponse(SAMPLE_PARSER),
      );

      await generator.generateParser(makeSampleMetadata(), tmpDir);

      const userPrompt = spy.mock.calls[0][0];
      expect(userPrompt).toContain('Invoices');
      expect(userPrompt).toContain('Số HĐ');
      expect(userPrompt).toContain('Ký hiệu HĐ');
      expect(userPrompt).toContain('Tổng tiền');
    });

    it('includes sample rows in the prompt', async () => {
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeParserResponse(SAMPLE_PARSER),
      );

      await generator.generateParser(makeSampleMetadata(), tmpDir);

      const userPrompt = spy.mock.calls[0][0];
      expect(userPrompt).toContain('HD001');
      expect(userPrompt).toContain('C26AAE');
      expect(userPrompt).toContain('0305008980');
    });

    it('includes ExtractionFileResult schema in system prompt', async () => {
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeParserResponse(SAMPLE_PARSER),
      );

      await generator.generateParser(makeSampleMetadata(), tmpDir);

      const systemPrompt = spy.mock.calls[0][1];
      expect(systemPrompt).toContain('ExtractionFileResult');
      expect(systemPrompt).toContain('file_id');
      expect(systemPrompt).toContain('doc_type');
      expect(systemPrompt).toContain('records');
    });

    it('includes DocType enum values in system prompt', async () => {
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeParserResponse(SAMPLE_PARSER),
      );

      await generator.generateParser(makeSampleMetadata(), tmpDir);

      const systemPrompt = spy.mock.calls[0][1];
      expect(systemPrompt).toContain('bank_statement');
      expect(systemPrompt).toContain('invoice_out');
      expect(systemPrompt).toContain('invoice_in');
      expect(systemPrompt).toContain('invoice_code');
    });

    it('extracts parser.js code from response', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeParserResponse(SAMPLE_PARSER),
      );

      const result = await generator.generateParser(makeSampleMetadata(), tmpDir);
      const content = fs.readFileSync(result.parserPath, 'utf-8');
      expect(content).toContain("require('xlsx')");
      expect(content).toContain('process.argv[2]');
    });

    it('saves parser to scripts directory', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeParserResponse(SAMPLE_PARSER),
      );

      const result = await generator.generateParser(makeSampleMetadata(), tmpDir);
      expect(result.parserPath.startsWith(path.join(tmpDir, 'scripts'))).toBe(true);
      expect(result.parserPath.endsWith('-parser.js')).toBe(true);
      expect(fs.existsSync(result.parserPath)).toBe(true);
    });

    it('generates unique script name from file name', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeParserResponse(SAMPLE_PARSER),
      );

      const result = await generator.generateParser(makeSampleMetadata(), tmpDir);
      expect(result.name).toContain('test-invoice');
    });

    it('infers docType from Claude response', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeParserResponse(SAMPLE_PARSER, 'invoice_out'),
      );

      const result = await generator.generateParser(makeSampleMetadata(), tmpDir);
      expect(result.docType).toBe(DocType.InvoiceOut);
    });

    it('throws when response has no parser code block', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        'Some response without code blocks',
      );

      await expect(
        generator.generateParser(makeSampleMetadata(), tmpDir),
      ).rejects.toThrow(/parser/i);
    });

    it('falls back to ```js block when ```parser.js not found', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        `Here is the code:\n\`\`\`js\n${SAMPLE_PARSER}\n\`\`\``,
      );

      const result = await generator.generateParser(makeSampleMetadata(), tmpDir);
      const content = fs.readFileSync(result.parserPath, 'utf-8');
      expect(content).toContain("require('xlsx')");
    });
  });

  // ── generateMatcher ──

  describe('generateMatcher', () => {
    it('generates matcher script', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeMatcherResponse(SAMPLE_MATCHER),
      );

      const result = await generator.generateMatcher(makeSampleMetadata(), tmpDir, 'test-invoice-abc');
      expect(fs.existsSync(result.matcherPath)).toBe(true);
      const content = fs.readFileSync(result.matcherPath, 'utf-8');
      expect(content).toContain('module.exports');
    });

    it('saves matcher to scripts directory with correct name', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeMatcherResponse(SAMPLE_MATCHER),
      );

      const result = await generator.generateMatcher(makeSampleMetadata(), tmpDir, 'my-script');
      expect(result.matcherPath).toBe(path.join(tmpDir, 'scripts', 'my-script-matcher.js'));
    });

    it('includes sheet names and headers in prompt', async () => {
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeMatcherResponse(SAMPLE_MATCHER),
      );

      await generator.generateMatcher(makeSampleMetadata(), tmpDir, 'test');

      const userPrompt = spy.mock.calls[0][0];
      expect(userPrompt).toContain('Invoices');
      expect(userPrompt).toContain('Số HĐ');
      expect(userPrompt).toContain('Ký hiệu HĐ');
    });

    it('throws when response has no matcher code block', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        'No code blocks here',
      );

      await expect(
        generator.generateMatcher(makeSampleMetadata(), tmpDir, 'test'),
      ).rejects.toThrow(/matcher/i);
    });
  });
});
