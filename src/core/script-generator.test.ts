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
        headers: ['STT', 'Số HĐ', 'Ngày lập', 'MST', 'Tổng tiền'],
        rowCount: 10,
        colCount: 5,
        columnTypes: [
          { header: 'STT', inferredType: 'number', sampleValues: [1, 2], emptyRate: 0 },
          { header: 'Số HĐ', inferredType: 'string', sampleValues: ['HD001'], emptyRate: 0 },
          { header: 'Ngày lập', inferredType: 'date', sampleValues: ['01/01/2026'], emptyRate: 0 },
          { header: 'MST', inferredType: 'string', sampleValues: ['0305008980'], emptyRate: 0 },
          { header: 'Tổng tiền', inferredType: 'number', sampleValues: [1000000], emptyRate: 0 },
        ],
        sampleRows: [
          { STT: 1, 'Số HĐ': 'HD001', 'Ngày lập': '01/01/2026', MST: '0305008980', 'Tổng tiền': 1000000 },
        ],
      },
    ],
  };
}

function makeClaudeResponse(parserCode: string, matcherCode: string, docType = 'invoice_out'): string {
  return `Based on the metadata, this is a sales invoice file (${docType}).

\`\`\`parser.js
${parserCode}
\`\`\`

\`\`\`matcher.js
${matcherCode}
\`\`\``;
}

const SAMPLE_PARSER = `const XLSX = require('xlsx');
const wb = XLSX.readFile(process.argv[2]);
const ws = wb.Sheets['Invoices'];
const rows = XLSX.utils.sheet_to_json(ws);
const result = {
  relative_path: process.argv[2],
  doc_type: 'invoice_out',
  records: rows.map(r => ({
    confidence: 0.9,
    field_confidence: {},
    ngay: r['Ngày lập'] || null,
    data: { so_hoa_don: r['Số HĐ'], tong_tien: r['Tổng tiền'], mst: r['MST'] },
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
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Prompt construction ──

  describe('Prompt construction', () => {
    it('includes sheet metadata in the prompt', async () => {
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER),
      );

      const metadata = makeSampleMetadata();
      await generator_create().generateScripts(metadata, tmpDir);

      const userPrompt = spy.mock.calls[0][0];
      expect(userPrompt).toContain('Invoices');
      expect(userPrompt).toContain('Số HĐ');
      expect(userPrompt).toContain('Tổng tiền');
    });

    it('includes ExtractionFileResult schema description', async () => {
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER),
      );

      await generator_create().generateScripts(makeSampleMetadata(), tmpDir);

      const systemPrompt = spy.mock.calls[0][1];
      expect(systemPrompt).toContain('ExtractionFileResult');
      expect(systemPrompt).toContain('relative_path');
      expect(systemPrompt).toContain('doc_type');
      expect(systemPrompt).toContain('records');
    });

    it('includes DocType enum values', async () => {
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER),
      );

      await generator_create().generateScripts(makeSampleMetadata(), tmpDir);

      const systemPrompt = spy.mock.calls[0][1];
      expect(systemPrompt).toContain('bank_statement');
      expect(systemPrompt).toContain('invoice_out');
      expect(systemPrompt).toContain('invoice_in');
    });

    it('includes sample rows in the prompt', async () => {
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER),
      );

      await generator_create().generateScripts(makeSampleMetadata(), tmpDir);

      const userPrompt = spy.mock.calls[0][0];
      expect(userPrompt).toContain('HD001');
      expect(userPrompt).toContain('0305008980');
    });
  });

  // ── Response parsing ──

  describe('Response parsing', () => {
    it('extracts parser.js code from fenced code block', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER),
      );

      const result = await generator_create().generateScripts(makeSampleMetadata(), tmpDir);
      const parserContent = fs.readFileSync(result.parserPath, 'utf-8');
      expect(parserContent).toContain("require('xlsx')");
      expect(parserContent).toContain('process.argv[2]');
    });

    it('extracts matcher.js code from fenced code block', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER),
      );

      const result = await generator_create().generateScripts(makeSampleMetadata(), tmpDir);
      const matcherContent = fs.readFileSync(result.matcherPath, 'utf-8');
      expect(matcherContent).toContain('module.exports');
    });

    it('handles response with extra text around code blocks', async () => {
      const response = `Here is my analysis of the file:

The file appears to be a sales invoice export.

\`\`\`parser.js
${SAMPLE_PARSER}
\`\`\`

Some explanation here about the matcher:

\`\`\`matcher.js
${SAMPLE_MATCHER}
\`\`\`

Let me know if you need any changes!`;

      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(response);

      const result = await generator_create().generateScripts(makeSampleMetadata(), tmpDir);
      expect(fs.existsSync(result.parserPath)).toBe(true);
      expect(fs.existsSync(result.matcherPath)).toBe(true);
    });

    it('throws when response has no parser code block', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        'Some response without code blocks',
      );

      await expect(
        generator_create().generateScripts(makeSampleMetadata(), tmpDir),
      ).rejects.toThrow(/parser/i);
    });

    it('throws when response has no matcher code block', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        `\`\`\`parser.js\n${SAMPLE_PARSER}\n\`\`\`\nNo matcher here.`,
      );

      await expect(
        generator_create().generateScripts(makeSampleMetadata(), tmpDir),
      ).rejects.toThrow(/matcher/i);
    });

    it('infers docType from Claude response', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER, 'invoice_out'),
      );

      const result = await generator_create().generateScripts(makeSampleMetadata(), tmpDir);
      expect(result.docType).toBe(DocType.InvoiceOut);
    });
  });

  // ── Script saving ──

  describe('Script saving', () => {
    it('saves parser script to scripts directory', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER),
      );

      const result = await generator_create().generateScripts(makeSampleMetadata(), tmpDir);
      expect(result.parserPath.startsWith(path.join(tmpDir, 'scripts'))).toBe(true);
      expect(result.parserPath.endsWith('-parser.js')).toBe(true);
      expect(fs.existsSync(result.parserPath)).toBe(true);
    });

    it('saves matcher script to scripts directory', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER),
      );

      const result = await generator_create().generateScripts(makeSampleMetadata(), tmpDir);
      expect(result.matcherPath.startsWith(path.join(tmpDir, 'scripts'))).toBe(true);
      expect(result.matcherPath.endsWith('-matcher.js')).toBe(true);
      expect(fs.existsSync(result.matcherPath)).toBe(true);
    });

    it('generates unique script name from file name', async () => {
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        makeClaudeResponse(SAMPLE_PARSER, SAMPLE_MATCHER),
      );

      const result = await generator_create().generateScripts(makeSampleMetadata(), tmpDir);
      expect(result.name).toContain('test-invoice');
    });
  });

  function generator_create(): ScriptGenerator {
    generator = new ScriptGenerator(runner);
    return generator;
  }
});
