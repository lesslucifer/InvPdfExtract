import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScriptVerifier } from './script-verifier';
import { ClaudeCodeRunner } from './claude-cli';
import { SpreadsheetMetadata, ExtractionFileResult, DocType } from '../shared/types';

// Mock the script-sandbox module
vi.mock('./script-sandbox', () => ({
  executeScript: vi.fn(),
}));

import { executeScript } from './script-sandbox';
const mockExecuteScript = vi.mocked(executeScript);

function makeSampleMetadata(): SpreadsheetMetadata {
  return {
    fileName: 'test.xlsx',
    fileType: 'xlsx',
    totalRows: 5,
    sheets: [{
      name: 'Sheet1',
      headers: ['A', 'B'],
      rowCount: 5,
      colCount: 2,
      columnTypes: [
        { header: 'A', inferredType: 'string', sampleValues: ['x'], emptyRate: 0 },
        { header: 'B', inferredType: 'number', sampleValues: [1], emptyRate: 0 },
      ],
      sampleRows: [{ A: 'x', B: 1 }],
    }],
  };
}

function makeValidResult(): ExtractionFileResult {
  return {
    relative_path: 'test.xlsx',
    doc_type: DocType.InvoiceOut,
    records: [{
      confidence: 0.95,
      field_confidence: { so_hoa_don: 0.99 },
      ngay: '2026-01-01',
      data: { so_hoa_don: 'HD001', tong_tien: 1000 },
      line_items: [],
    }],
  };
}

describe('ScriptVerifier', () => {
  let runner: ClaudeCodeRunner;
  let verifier: ScriptVerifier;
  let tmpDir: string;
  let parserPath: string;

  beforeEach(() => {
    runner = new ClaudeCodeRunner();
    verifier = new ScriptVerifier(runner);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-'));
    parserPath = path.join(tmpDir, 'parser.js');
    fs.writeFileSync(parserPath, '// placeholder parser');
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Successful verification ──

  describe('Successful verification', () => {
    it('returns success when script produces valid ExtractionFileResult', async () => {
      mockExecuteScript.mockResolvedValue(makeValidResult());

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      expect(result.success).toBe(true);
    });

    it('output contains the parsed ExtractionFileResult', async () => {
      const validResult = makeValidResult();
      mockExecuteScript.mockResolvedValue(validResult);

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      expect(result.output).toBeTruthy();
      expect(result.output!.records).toHaveLength(1);
      expect(result.output!.records[0].data).toEqual({ so_hoa_don: 'HD001', tong_tien: 1000 });
    });
  });

  // ── Structural validation ──

  describe('Structural validation', () => {
    it('fails when output missing records array', async () => {
      mockExecuteScript.mockResolvedValue({
        relative_path: 'test.xlsx',
        doc_type: DocType.InvoiceOut,
      } as any);

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
        { maxRetries: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/records/i);
    });

    it('fails when doc_type is invalid', async () => {
      mockExecuteScript.mockResolvedValue({
        relative_path: 'test.xlsx',
        doc_type: 'not_a_type' as any,
        records: [makeValidResult().records[0]],
      });

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
        { maxRetries: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/doc_type/i);
    });

    it('fails when records have no data field', async () => {
      mockExecuteScript.mockResolvedValue({
        relative_path: 'test.xlsx',
        doc_type: DocType.InvoiceOut,
        records: [{ confidence: 0.9, field_confidence: {}, ngay: null }],
      } as any);

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
        { maxRetries: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/data/i);
    });
  });

  // ── Retry loop ──

  describe('Retry loop', () => {
    it('retries when first execution fails, succeeds on retry', async () => {
      mockExecuteScript
        .mockRejectedValueOnce(new Error('Script crashed'))
        .mockResolvedValueOnce(makeValidResult());

      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        `\`\`\`parser.js\nconsole.log("fixed");\n\`\`\``,
      );

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
        { maxRetries: 2 },
      );

      expect(result.success).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(mockExecuteScript).toHaveBeenCalledTimes(2);
    });

    it('sends error details back to Claude for fix', async () => {
      mockExecuteScript
        .mockRejectedValueOnce(new Error('TypeError: Cannot read property x'))
        .mockResolvedValueOnce(makeValidResult());

      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        `\`\`\`parser.js\nconsole.log("fixed");\n\`\`\``,
      );

      await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
        { maxRetries: 2 },
      );

      const fixPrompt = spy.mock.calls[0][0];
      expect(fixPrompt).toContain('TypeError: Cannot read property x');
    });

    it('stops after maxRetries failures', async () => {
      mockExecuteScript.mockRejectedValue(new Error('Script keeps crashing'));

      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        `\`\`\`parser.js\nconsole.log("still broken");\n\`\`\``,
      );

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
        { maxRetries: 2 },
      );

      expect(result.success).toBe(false);
      expect(mockExecuteScript).toHaveBeenCalledTimes(3);
    });

    it('returns error message from last attempt', async () => {
      mockExecuteScript
        .mockRejectedValueOnce(new Error('First error'))
        .mockRejectedValueOnce(new Error('Second error'))
        .mockRejectedValueOnce(new Error('Final error'));

      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        `\`\`\`parser.js\nconsole.log("broken");\n\`\`\``,
      );

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
        { maxRetries: 2 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Final error');
    });

    it('retries on structural validation failure', async () => {
      mockExecuteScript
        .mockResolvedValueOnce({
          relative_path: 'test.xlsx',
          doc_type: DocType.InvoiceOut,
          records: [{ confidence: 0.9, field_confidence: {}, ngay: null }],
        } as any)
        .mockResolvedValueOnce(makeValidResult());

      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        `\`\`\`parser.js\nconsole.log("fixed");\n\`\`\``,
      );

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
        { maxRetries: 2 },
      );

      expect(result.success).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('overwrites parser file with fixed code from Claude', async () => {
      mockExecuteScript
        .mockRejectedValueOnce(new Error('broken'))
        .mockResolvedValueOnce(makeValidResult());

      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        `\`\`\`parser.js\nconst fixed = true;\n\`\`\``,
      );

      await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
        { maxRetries: 1 },
      );

      const content = fs.readFileSync(parserPath, 'utf-8');
      expect(content).toContain('const fixed = true');
    });
  });

  // ── Sample cross-check ──

  describe('Sample cross-check', () => {
    it('succeeds when record count is reasonable relative to metadata row count', async () => {
      mockExecuteScript.mockResolvedValue(makeValidResult());

      const result = await verifier.verifyScript(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      expect(result.success).toBe(true);
    });
  });
});
