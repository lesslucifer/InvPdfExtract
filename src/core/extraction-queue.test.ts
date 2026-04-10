import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Hoisted mock state — must be declared before any imports that use them
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const filterFile = vi.fn().mockResolvedValue('accepted');
  const generateParser = vi.fn().mockResolvedValue({ parserPath: '/tmp/p.js', name: 'p', docType: 'bank_statement' });
  const generateMatcher = vi.fn().mockResolvedValue({ matcherPath: '/tmp/m.js' });
  const verifyAndRefine = vi.fn().mockResolvedValue({
    success: true,
    output: { relative_path: '', doc_type: 'bank_statement', records: [] },
  });
  const getAllScripts = vi.fn().mockReturnValue([]);
  const registerScript = vi.fn().mockReturnValue({ id: 'script-1' });
  const recordUsage = vi.fn();
  const findMatchingScript = vi.fn().mockReturnValue(null);
  const processFiles = vi.fn().mockResolvedValue({ result: { results: [] }, sessionLog: 'log' });
  const reconcileResults = vi.fn();
  const executeScript = vi.fn().mockResolvedValue({ relative_path: '', doc_type: 'bank_statement', records: [] });
  const extractMetadata = vi.fn().mockReturnValue({ fileName: 'test.xlsx', fileType: 'xlsx', sheets: [], totalRows: 0 });
  const extractPdfText = vi.fn().mockResolvedValue('some pdf text long enough');
  const parseXmlInvoice = vi.fn().mockImplementation(() => { throw new Error('not xml'); });

  return {
    filterFile, generateParser, generateMatcher, verifyAndRefine,
    getAllScripts, registerScript, recordUsage,
    findMatchingScript, processFiles, reconcileResults,
    executeScript, extractMetadata, extractPdfText, parseXmlInvoice,
  };
});

vi.mock('./filters/relevance-filter', () => ({
  RelevanceFilter: function RelevanceFilter() {
    return { filterFile: mocks.filterFile };
  },
}));

vi.mock('./claude-cli', () => ({
  ClaudeCodeRunner: function ClaudeCodeRunner() {
    return { processFiles: mocks.processFiles };
  },
  CliError: class CliError extends Error {},
  getSessionLogPath: vi.fn().mockReturnValue('/tmp/session.log'),
}));

vi.mock('./reconciler', () => ({
  Reconciler: function Reconciler() {
    return { reconcileResults: mocks.reconcileResults };
  },
}));

vi.mock('./script-registry', () => ({
  ScriptRegistry: function ScriptRegistry() {
    return { getAllScripts: mocks.getAllScripts, registerScript: mocks.registerScript, recordUsage: mocks.recordUsage };
  },
}));

vi.mock('./matcher-evaluator', () => ({
  MatcherEvaluator: function MatcherEvaluator() {
    return { findMatchingScript: mocks.findMatchingScript };
  },
}));

vi.mock('./script-generator', () => ({
  ScriptGenerator: function ScriptGenerator() {
    return { generateParser: mocks.generateParser, generateMatcher: mocks.generateMatcher };
  },
}));

vi.mock('./script-verifier', () => ({
  ScriptVerifier: function ScriptVerifier() {
    return { verifyAndRefine: mocks.verifyAndRefine };
  },
}));

vi.mock('./script-sandbox', () => ({
  executeScript: (...args: unknown[]) => mocks.executeScript(...args),
}));

vi.mock('./parsers/xml-invoice-parser', () => ({
  parseXmlInvoice: (...args: unknown[]) => mocks.parseXmlInvoice(...args),
}));

vi.mock('./parsers/spreadsheet-metadata', () => ({
  extractMetadata: (...args: unknown[]) => mocks.extractMetadata(...args),
}));

vi.mock('./filters/content-sniffer', () => ({
  extractPdfText: (...args: unknown[]) => mocks.extractPdfText(...args),
}));

// ---------------------------------------------------------------------------
// Real imports (after mocks are declared)
// ---------------------------------------------------------------------------

import { openDatabase, closeDatabase, setActiveDatabase, getDatabase } from './db/database';
import { insertFile } from './db/files';
import { ExtractionQueue } from './extraction-queue';
import { FileStatus, VaultHandle, VaultConfig } from '../shared/types';
import { eventBus } from './event-bus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVaultHandle(rootPath: string, dotPath: string): VaultHandle {
  const config: VaultConfig = { version: 1, created_at: new Date().toISOString(), confidence_threshold: 0.8 };
  return { rootPath, dotPath, dbPath: path.join(dotPath, 'vault.db'), config, db: getDatabase() };
}

function fileStatus(id: string): string {
  const row = getDatabase().prepare('SELECT status FROM files WHERE id = ?').get(id) as { status: string } | undefined;
  return row?.status ?? '';
}

// ---------------------------------------------------------------------------

describe('ExtractionQueue — structured vs unstructured processing order', () => {
  let tmpDir: string;
  let rootPath: string;
  let dotPath: string;

  beforeEach(() => {
    closeDatabase();
    const db = openDatabase(':memory:');
    setActiveDatabase(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-test-'));
    rootPath = tmpDir;
    dotPath = path.join(tmpDir, '.invoicevault');
    fs.mkdirSync(dotPath, { recursive: true });

    // Dummy files on disk
    for (const name of ['invoice.xlsx', 'statement.csv', 'doc.xml', 'report.pdf', 'scan.pdf']) {
      fs.writeFileSync(path.join(rootPath, name), '');
    }

        // Clear call counts but preserve implementations
    Object.values(mocks).forEach(m => { if (typeof m.mockClear === 'function') m.mockClear(); });

    // Re-apply default return values (mockClear preserves implementations set in hoisted block,
    // but tests that override them need a clean slate each time)
    mocks.filterFile.mockResolvedValue('accepted');
    mocks.generateParser.mockResolvedValue({ parserPath: '/tmp/p.js', name: 'p', docType: 'bank_statement' });
    mocks.generateMatcher.mockResolvedValue({ matcherPath: '/tmp/m.js' });
    mocks.verifyAndRefine.mockResolvedValue({ success: true, output: { relative_path: '', doc_type: 'bank_statement', records: [] } });
    mocks.getAllScripts.mockReturnValue([]);
    mocks.registerScript.mockReturnValue({ id: 'script-1' });
    mocks.findMatchingScript.mockReturnValue(null);
    mocks.processFiles.mockResolvedValue({ result: { results: [] }, sessionLog: 'log' });
    mocks.executeScript.mockResolvedValue({ relative_path: '', doc_type: 'bank_statement', records: [] });
    mocks.extractMetadata.mockReturnValue({ fileName: 'test.xlsx', fileType: 'xlsx', sheets: [], totalRows: 0 });
    mocks.extractPdfText.mockResolvedValue('some pdf text long enough');
    mocks.parseXmlInvoice.mockImplementation(() => { throw new Error('not xml'); });
  });

  afterEach(() => {
    closeDatabase();
    eventBus.removeAllListeners();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('processes a single XLSX file sequentially — one generateParser call', async () => {
    insertFile('invoice.xlsx', 'hash-xlsx', 'xlsx', 100);

    const vault = makeVaultHandle(rootPath, dotPath);
    const queue = new ExtractionQueue(vault, { filterFile: mocks.filterFile } as never);
    await queue['processQueue']();

    expect(mocks.generateParser).toHaveBeenCalledTimes(1);
  });

  it('processes multiple XLSX files one at a time — generateParser called per file', async () => {
    fs.writeFileSync(path.join(rootPath, 'other.xlsx'), '');
    insertFile('invoice.xlsx', 'hash-1', 'xlsx', 100);
    insertFile('statement.csv', 'hash-2', 'csv', 100);
    insertFile('other.xlsx', 'hash-3', 'xlsx', 100);

    const vault = makeVaultHandle(rootPath, dotPath);
    const queue = new ExtractionQueue(vault, { filterFile: mocks.filterFile } as never);
    await queue['processQueue']();

    // Each structured file gets its own script generation attempt (matcher always returns null)
    expect(mocks.generateParser).toHaveBeenCalledTimes(3);
  });

  it('processes PDF files together in a batch — single processFiles call', async () => {
    const f1 = insertFile('report.pdf', 'hash-pdf1', 'pdf', 1000);
    const f2 = insertFile('scan.pdf', 'hash-pdf2', 'pdf', 1000);

    // Return results covering both files so they don't get retried
    mocks.processFiles.mockResolvedValue({
      result: {
        results: [
          { relative_path: f1.relative_path, doc_type: 'bank_statement', records: [] },
          { relative_path: f2.relative_path, doc_type: 'bank_statement', records: [] },
        ],
      },
      sessionLog: 'log',
    });

    const vault = makeVaultHandle(rootPath, dotPath);
    const queue = new ExtractionQueue(vault, { filterFile: mocks.filterFile } as never);
    await queue['processQueue']();

    expect(mocks.processFiles).toHaveBeenCalledTimes(1);
    const [filePaths] = mocks.processFiles.mock.calls[0] as [string[], ...unknown[]];
    expect(filePaths).toHaveLength(2);
    expect(filePaths.every((p: string) => p.endsWith('.pdf'))).toBe(true);
  });

  it('never sends XLSX to the PDF batch processor (processFiles)', async () => {
    insertFile('invoice.xlsx', 'hash-xlsx', 'xlsx', 100);
    insertFile('report.pdf', 'hash-pdf', 'pdf', 1000);

    const vault = makeVaultHandle(rootPath, dotPath);
    const queue = new ExtractionQueue(vault, { filterFile: mocks.filterFile } as never);
    await queue['processQueue']();

    for (const call of mocks.processFiles.mock.calls) {
      const paths = call[0] as string[];
      expect(paths.every((p: string) => !p.endsWith('.xlsx') && !p.endsWith('.csv'))).toBe(true);
    }
  });

  it('second XLSX reuses script generated by first — generateParser called only once', async () => {
    const registeredScript = {
      id: 'script-reuse',
      name: 'invoice-parser',
      script_path: 'scripts/invoice-parser.js',
      matcher_path: 'scripts/invoice-matcher.js',
    };

    // First call returns empty (no scripts yet); after registration subsequent calls return the script
    let getAllCount = 0;
    mocks.getAllScripts.mockImplementation(() => getAllCount++ === 0 ? [] : [registeredScript]);
    mocks.registerScript.mockReturnValue(registeredScript);

    // Matcher misses on first file, hits on second
    // Matcher misses on all calls — the brute-force path (try all parsers directly) will
    // pick up the registered script because executeScript returns records.
    mocks.findMatchingScript.mockReturnValue(null);

    // executeScript returns a non-empty records array so the brute-force reuse path fires
    mocks.executeScript.mockResolvedValue({
      relative_path: '', doc_type: 'bank_statement',
      records: [{ confidence: 1.0, field_confidence: {}, doc_date: null, data: {}, line_items: [] }],
    });

    fs.writeFileSync(path.join(rootPath, 'other.xlsx'), '');
    insertFile('invoice.xlsx', 'hash-1', 'xlsx', 100);
    insertFile('other.xlsx', 'hash-2', 'xlsx', 100);

    const vault = makeVaultHandle(rootPath, dotPath);
    const queue = new ExtractionQueue(vault, { filterFile: mocks.filterFile } as never);
    await queue['processQueue']();

    // Script generated only once (first file — no scripts in registry yet).
    // Second file finds the registered script via brute-force and reuses it.
    expect(mocks.generateParser).toHaveBeenCalledTimes(1);
    expect(mocks.executeScript).toHaveBeenCalledTimes(1);
  });

  it('marks a structured file as Processing before extraction begins', async () => {
    const file = insertFile('invoice.xlsx', 'hash-xlsx', 'xlsx', 100);
    expect(fileStatus(file.id)).toBe(FileStatus.Unfiltered);

    let statusDuringProcessing = '';
    const vault = makeVaultHandle(rootPath, dotPath);
    const queue = new ExtractionQueue(vault, { filterFile: mocks.filterFile } as never);

    // Intercept the private method directly on the instance
    const originalProcess = queue['processStructuredFile'].bind(queue);
    queue['processStructuredFile'] = async (f: Parameters<typeof originalProcess>[0]) => {
      statusDuringProcessing = fileStatus(f.id);
      return originalProcess(f);
    };

    await queue['processQueue']();

    expect(statusDuringProcessing).toBe(FileStatus.Processing);
  });

  it('emits extraction:started with only the single structured file id', async () => {
    const emittedIds: string[][] = [];
    eventBus.on('extraction:started', ({ fileIds }) => emittedIds.push(fileIds));

    const file = insertFile('invoice.xlsx', 'hash-xlsx', 'xlsx', 100);

    const vault = makeVaultHandle(rootPath, dotPath);
    const queue = new ExtractionQueue(vault, { filterFile: mocks.filterFile } as never);
    await queue['processQueue']();

    expect(emittedIds).toHaveLength(1);
    expect(emittedIds[0]).toEqual([file.id]);
  });

  it('processes interleaved queue (xlsx, pdf, xlsx) without mixing batches', async () => {
    fs.writeFileSync(path.join(rootPath, 'a.xlsx'), '');
    fs.writeFileSync(path.join(rootPath, 'b.xlsx'), '');
    insertFile('a.xlsx', 'hash-a', 'xlsx', 100);
    insertFile('report.pdf', 'hash-pdf', 'pdf', 1000);
    insertFile('b.xlsx', 'hash-b', 'xlsx', 100);

    const vault = makeVaultHandle(rootPath, dotPath);
    const queue = new ExtractionQueue(vault, { filterFile: mocks.filterFile } as never);
    await queue['processQueue']();

    // Both XLSX files generate their own scripts
    expect(mocks.generateParser).toHaveBeenCalledTimes(2);

    // processFiles must never receive xlsx paths
    for (const call of mocks.processFiles.mock.calls) {
      const paths = call[0] as string[];
      expect(paths.every((p: string) => !p.endsWith('.xlsx') && !p.endsWith('.csv'))).toBe(true);
    }
  });
});
