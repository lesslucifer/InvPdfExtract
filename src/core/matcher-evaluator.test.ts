import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XML_FILES } from '../__tests__/helpers/fixtures';
import { MatcherEvaluator } from './matcher-evaluator';
import { ExtractionScript, DocType } from '../shared/types';

// Helper to create a temp matcher script file
function createTempScript(code: string): string {
  const tmpFile = path.join(os.tmpdir(), `matcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(tmpFile, code);
  return tmpFile;
}

function makeScript(overrides: Partial<ExtractionScript> & { matcher_path: string }): ExtractionScript {
  return {
    id: `script-${Math.random().toString(36).slice(2)}`,
    name: 'test-script',
    doc_type: DocType.InvoiceIn,
    script_path: 'parser.js',
    matcher_path: overrides.matcher_path,
    matcher_description: null,
    times_used: 0,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('MatcherEvaluator', () => {
  let evaluator: MatcherEvaluator;
  const tempFiles: string[] = [];

  beforeEach(() => {
    evaluator = new MatcherEvaluator();
  });

  afterEach(() => {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    tempFiles.length = 0;
  });

  // ── Match execution ──

  describe('findMatchingScript', () => {
    it('returns matching script when matcher returns true', () => {
      const matcherPath = createTempScript(`
        module.exports = function(filePath) { return true; };
      `);
      tempFiles.push(matcherPath);

      const script = makeScript({ matcher_path: matcherPath });
      const result = evaluator.findMatchingScript('some-file.xml', [script]);

      expect(result).toBeTruthy();
      expect(result!.id).toBe(script.id);
    });

    it('returns null when no matcher matches', () => {
      const matcherPath = createTempScript(`
        module.exports = function(filePath) { return false; };
      `);
      tempFiles.push(matcherPath);

      const script = makeScript({ matcher_path: matcherPath });
      const result = evaluator.findMatchingScript('some-file.xml', [script]);

      expect(result).toBeNull();
    });

    it('first match wins when multiple matchers return true', () => {
      const matcher1 = createTempScript(`module.exports = function() { return true; };`);
      const matcher2 = createTempScript(`module.exports = function() { return true; };`);
      tempFiles.push(matcher1, matcher2);

      const scriptA = makeScript({ id: 'first', name: 'script-a', matcher_path: matcher1 });
      const scriptB = makeScript({ id: 'second', name: 'script-b', matcher_path: matcher2 });

      const result = evaluator.findMatchingScript('file.xml', [scriptA, scriptB]);
      expect(result).toBeTruthy();
      expect(result!.id).toBe('first');
    });
  });

  // ── Error handling ──

  describe('Error handling', () => {
    it('skips matcher that throws an error (does not propagate)', () => {
      const badMatcher = createTempScript(`
        module.exports = function() { throw new Error('boom'); };
      `);
      const goodMatcher = createTempScript(`
        module.exports = function() { return true; };
      `);
      tempFiles.push(badMatcher, goodMatcher);

      const badScript = makeScript({ id: 'bad', matcher_path: badMatcher });
      const goodScript = makeScript({ id: 'good', matcher_path: goodMatcher });

      // Should skip the bad matcher and return the good one
      const result = evaluator.findMatchingScript('file.xml', [badScript, goodScript]);
      expect(result).toBeTruthy();
      expect(result!.id).toBe('good');
    });

    it('returns null when all matchers throw', () => {
      const badMatcher = createTempScript(`
        module.exports = function() { throw new Error('fail'); };
      `);
      tempFiles.push(badMatcher);

      const script = makeScript({ matcher_path: badMatcher });
      const result = evaluator.findMatchingScript('file.xml', [script]);
      expect(result).toBeNull();
    });
  });

  // ── Timeout handling ──
  // Note: MatcherEvaluator uses sync require(), so it can't kill a running
  // matcher mid-execution. It checks elapsed time AFTER the matcher returns
  // and discards the result if it exceeded the timeout.

  describe('Timeout handling', () => {
    it('discards result when matcher exceeds timeout', () => {
      // This matcher takes ~200ms (just enough to exceed a 50ms timeout)
      const slowMatcher = createTempScript(`
        module.exports = function() {
          const start = Date.now();
          while (Date.now() - start < 200) {}
          return true;
        };
      `);
      tempFiles.push(slowMatcher);

      const script = makeScript({ matcher_path: slowMatcher });

      // Set timeout very low so the matcher exceeds it
      const evaluatorWithTimeout = new MatcherEvaluator({ matcherTimeoutMs: 50 });
      const result = evaluatorWithTimeout.findMatchingScript('file.xml', [script]);

      // Matcher returned true but took too long, so result is discarded
      expect(result).toBeNull();
    });
  });

  // ── Real XML matcher scenario ──

  describe('XML invoice matcher (real scenario)', () => {
    it('correctly identifies Vietnamese e-invoice XML', () => {
      // A matcher that checks for Vietnamese e-invoice XML structure
      const xmlMatcher = createTempScript(`
        const fs = require('fs');
        module.exports = function(filePath) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8').slice(0, 2000);
            return content.includes('<HDon>') || content.includes('<HDon ');
          } catch { return false; }
        };
      `);
      tempFiles.push(xmlMatcher);

      const script = makeScript({ matcher_path: xmlMatcher });
      const result = evaluator.findMatchingScript(XML_FILES.inKyThuatSo911, [script]);
      expect(result).toBeTruthy();
    });

    it('rejects non-invoice XML', () => {
      const xmlMatcher = createTempScript(`
        const fs = require('fs');
        module.exports = function(filePath) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8').slice(0, 2000);
            return content.includes('<HDon>') || content.includes('<HDon ');
          } catch { return false; }
        };
      `);
      tempFiles.push(xmlMatcher);

      const tmpXml = path.join(os.tmpdir(), 'not-invoice.xml');
      fs.writeFileSync(tmpXml, '<?xml version="1.0"?><root><item>data</item></root>');
      tempFiles.push(tmpXml);

      const script = makeScript({ matcher_path: xmlMatcher });
      const result = evaluator.findMatchingScript(tmpXml, [script]);
      expect(result).toBeNull();
    });
  });
});
