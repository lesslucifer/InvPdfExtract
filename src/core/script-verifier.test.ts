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
    file_id: 'test-file-id',
    doc_type: DocType.InvoiceOut,
    records: [{
      confidence: 1.0,
      field_confidence: { invoice_code: 1.0, invoice_number: 1.0 },
      doc_date: '2026-01-01',
      data: { invoice_code: 'C26AAE', invoice_number: 'HD001', total_amount: 1000 },
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

  // ── Claude approves on first attempt ──

  describe('APPROVED on first attempt', () => {
    it('returns success when Claude approves the output', async () => {
      mockExecuteScript.mockResolvedValue(makeValidResult());
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue('APPROVED');

      const result = await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
      expect(result.output!.records).toHaveLength(1);
    });

    it('sends metadata, script, and truncated output to Claude', async () => {
      mockExecuteScript.mockResolvedValue(makeValidResult());
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue('APPROVED');

      await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      const prompt = spy.mock.calls[0][0];
      expect(prompt).toContain('Sheet1'); // metadata
      expect(prompt).toContain('placeholder parser'); // script
      expect(prompt).toContain('HD001'); // output
      expect(prompt).toContain('invoice_code');
    });

    it('only calls executeScript and invokeRaw once each', async () => {
      mockExecuteScript.mockResolvedValue(makeValidResult());
      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue('APPROVED');

      await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      expect(mockExecuteScript).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Claude fixes script ──

  describe('Claude provides fix', () => {
    it('retries with fixed script when Claude returns code block', async () => {
      mockExecuteScript
        .mockResolvedValueOnce(makeValidResult())  // first run
        .mockResolvedValueOnce(makeValidResult());  // second run after fix

      vi.spyOn(runner, 'invokeRaw')
        .mockResolvedValueOnce('```parser.js\nconst fixed = true;\n```')
        .mockResolvedValueOnce('APPROVED');

      const result = await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      expect(result.success).toBe(true);
      expect(mockExecuteScript).toHaveBeenCalledTimes(2);
    });

    it('overwrites parser file with fixed code', async () => {
      mockExecuteScript.mockResolvedValue(makeValidResult());

      vi.spyOn(runner, 'invokeRaw')
        .mockResolvedValueOnce('```parser.js\nconst FIXED = "yes";\n```')
        .mockResolvedValueOnce('APPROVED');

      await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      const content = fs.readFileSync(parserPath, 'utf-8');
      expect(content).toContain('const FIXED = "yes"');
    });
  });

  // ── Runtime error handling ──

  describe('Runtime error handling', () => {
    it('sends error message to Claude when script crashes', async () => {
      mockExecuteScript
        .mockRejectedValueOnce(new Error('TypeError: x is undefined'))
        .mockResolvedValueOnce(makeValidResult());

      const spy = vi.spyOn(runner, 'invokeRaw')
        .mockResolvedValueOnce('```parser.js\nconst fixed = true;\n```')
        .mockResolvedValueOnce('APPROVED');

      await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      const firstPrompt = spy.mock.calls[0][0];
      expect(firstPrompt).toContain('TypeError: x is undefined');
      expect(firstPrompt).toContain('Runtime Error');
    });

    it('recovers from runtime error when Claude fixes it', async () => {
      mockExecuteScript
        .mockRejectedValueOnce(new Error('Script crashed'))
        .mockResolvedValueOnce(makeValidResult());

      vi.spyOn(runner, 'invokeRaw')
        .mockResolvedValueOnce('```parser.js\nconst fixed = true;\n```')
        .mockResolvedValueOnce('APPROVED');

      const result = await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      expect(result.success).toBe(true);
    });
  });

  // ── Max retries ──

  describe('Max retries', () => {
    it('fails after exhausting all retries', async () => {
      mockExecuteScript.mockRejectedValue(new Error('keeps crashing'));

      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        '```parser.js\nconsole.log("still broken");\n```',
      );

      const result = await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(),
        '/vault', { maxRetries: 2 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('failed after');
      // 3 script executions (initial + 2 retries), 3 Claude calls
      expect(mockExecuteScript).toHaveBeenCalledTimes(3);
    });

    it('respects custom maxRetries', async () => {
      mockExecuteScript.mockRejectedValue(new Error('crash'));
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        '```parser.js\nbroken\n```',
      );

      await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(),
        '/vault', { maxRetries: 1 },
      );

      expect(mockExecuteScript).toHaveBeenCalledTimes(2);
    });
  });

  // ── Output truncation ──

  describe('Output truncation', () => {
    it('truncates output to max 3 records when sending to Claude', async () => {
      const resultWith5Records: ExtractionFileResult = {
        file_id: 'test-file-id',
        doc_type: DocType.BankStatement,
        records: Array.from({ length: 5 }, (_, i) => ({
          confidence: 1.0,
          field_confidence: {},
          doc_date: '2026-01-01',
          data: { account_number: `ACC${i}`, amount: i * 100 },
        })),
      };
      mockExecuteScript.mockResolvedValue(resultWith5Records);

      const spy = vi.spyOn(runner, 'invokeRaw').mockResolvedValue('APPROVED');

      await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(), '/vault',
      );

      const prompt = spy.mock.calls[0][0];
      // Should show total count but only first 3 records
      expect(prompt).toContain('Total records: 5');
      expect(prompt).toContain('ACC0');
      expect(prompt).toContain('ACC2');
      // The 4th and 5th records should not appear
      expect(prompt).not.toContain('ACC3');
      expect(prompt).not.toContain('ACC4');
    });
  });

  // ── Edge case: APPROVED but script errored ──

  describe('Edge cases', () => {
    it('returns failure if Claude says APPROVED but script had error', async () => {
      mockExecuteScript.mockRejectedValue(new Error('Script crashed'));
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue('APPROVED');

      const result = await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(),
        '/vault', { maxRetries: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Script error despite approval');
    });

    it('handles response with neither APPROVED nor code block', async () => {
      mockExecuteScript.mockResolvedValue(makeValidResult());
      vi.spyOn(runner, 'invokeRaw').mockResolvedValue(
        'I think there might be an issue but I am not sure...',
      );

      const result = await verifier.verifyAndRefine(
        parserPath, '/path/to/file.xlsx', makeSampleMetadata(),
        '/vault', { maxRetries: 0 },
      );

      expect(result.success).toBe(false);
    });
  });
});
