import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeScript } from './script-sandbox';
import type { ExtractionInvoiceData } from '../shared/types';

function createTempScript(code: string): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `sandbox-test-${Date.now()}-${Math.random().toString(36).slice(2)}.js`,
  );
  fs.writeFileSync(tmpFile, code);
  return tmpFile;
}

describe('Script Sandbox', () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    tempFiles.length = 0;
  });

  // ── Successful execution ──

  describe('Successful execution', () => {
    it('executes a parser script and captures JSON output', async () => {
      const script = createTempScript(`
        const result = {
          relative_path: 'test.xml',
          doc_type: 'invoice_in',
          records: [{
            confidence: 1.0,
            field_confidence: {},
            ngay: '2026-01-31',
            data: { so_hoa_don: '123', tong_tien: 100000 },
            line_items: []
          }]
        };
        console.log(JSON.stringify(result));
      `);
      tempFiles.push(script);

      const result = await executeScript(script, 'test.xml', { timeoutMs: 5000 });

      expect(result).toBeTruthy();
      expect(result.relative_path).toBe('test.xml');
      expect(result.doc_type).toBe('invoice_in');
      expect(result.records).toHaveLength(1);
      expect((result.records[0].data as ExtractionInvoiceData).so_hoa_don).toBe('123');
    });

    it('passes the filePath argument to the script', async () => {
      const script = createTempScript(`
        const filePath = process.argv[2];
        const result = {
          relative_path: filePath,
          doc_type: 'invoice_in',
          records: []
        };
        console.log(JSON.stringify(result));
      `);
      tempFiles.push(script);

      const result = await executeScript(script, 'my-invoice.xml', { timeoutMs: 5000 });
      expect(result.relative_path).toBe('my-invoice.xml');
    });
  });

  // ── Timeout ──

  describe('Timeout handling', () => {
    it('kills long-running scripts after timeout', async () => {
      const script = createTempScript(`
        while (true) {} // infinite loop
      `);
      tempFiles.push(script);

      await expect(
        executeScript(script, 'file.xml', { timeoutMs: 1000 }),
      ).rejects.toThrow(/timeout/i);
    }, 5000);
  });

  // ── Error handling ──

  describe('Error handling', () => {
    it('rejects when script produces non-JSON output', async () => {
      const script = createTempScript(`
        console.log('hello world, not json');
      `);
      tempFiles.push(script);

      await expect(
        executeScript(script, 'file.xml', { timeoutMs: 5000 }),
      ).rejects.toThrow(/json/i);
    });

    it('rejects when script exits with non-zero code', async () => {
      const script = createTempScript(`
        process.exit(1);
      `);
      tempFiles.push(script);

      await expect(
        executeScript(script, 'file.xml', { timeoutMs: 5000 }),
      ).rejects.toThrow();
    });

    it('rejects when script throws an error', async () => {
      const script = createTempScript(`
        throw new Error('script crashed');
      `);
      tempFiles.push(script);

      await expect(
        executeScript(script, 'file.xml', { timeoutMs: 5000 }),
      ).rejects.toThrow();
    });
  });
});
