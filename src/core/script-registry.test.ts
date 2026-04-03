import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { createInMemoryDb } from '../__tests__/helpers/mock-db';
import { DocType } from '../shared/types';
import { ScriptRegistry } from './script-registry';

/** Insert a dummy file row to satisfy FK constraints on file_script_assignments */
function insertDummyFile(db: Database.Database, fileId?: string): string {
  const id = fileId ?? uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO files (id, relative_path, file_hash, file_type, file_size, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, `test/${id}.xml`, 'hash123', 'xml', 100, 'pending', now, now);
  return id;
}

describe('ScriptRegistry', () => {
  let db: Database.Database;
  let registry: ScriptRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new ScriptRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Registration ──

  describe('registerScript', () => {
    it('inserts a script into extraction_scripts and returns it with a UUID id', () => {
      const script = registry.registerScript({
        name: 'vn-xml-invoice',
        docType: DocType.InvoiceIn,
        scriptPath: '.invoicevault/scripts/vn-xml-invoice-parser.js',
        matcherPath: '.invoicevault/scripts/vn-xml-invoice-matcher.js',
        description: 'Vietnamese e-invoice XML parser',
      });

      expect(script.id).toBeTruthy();
      expect(script.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(script.name).toBe('vn-xml-invoice');
      expect(script.doc_type).toBe(DocType.InvoiceIn);
      expect(script.script_path).toBe('.invoicevault/scripts/vn-xml-invoice-parser.js');
      expect(script.matcher_path).toBe('.invoicevault/scripts/vn-xml-invoice-matcher.js');
      expect(script.times_used).toBe(0);

      // Verify in database
      const row = db.prepare('SELECT * FROM extraction_scripts WHERE id = ?').get(script.id) as any;
      expect(row).toBeTruthy();
      expect(row.name).toBe('vn-xml-invoice');
    });
  });

  // ── Lookup ──

  describe('getAllScripts', () => {
    it('returns all registered scripts', () => {
      registry.registerScript({
        name: 'parser-a',
        docType: DocType.InvoiceIn,
        scriptPath: 'a-parser.js',
        matcherPath: 'a-matcher.js',
      });
      registry.registerScript({
        name: 'parser-b',
        docType: DocType.InvoiceOut,
        scriptPath: 'b-parser.js',
        matcherPath: 'b-matcher.js',
      });
      registry.registerScript({
        name: 'parser-c',
        docType: DocType.BankStatement,
        scriptPath: 'c-parser.js',
        matcherPath: 'c-matcher.js',
      });

      const all = registry.getAllScripts();
      expect(all).toHaveLength(3);
    });
  });

  describe('getScriptById', () => {
    it('returns the correct script', () => {
      const script = registry.registerScript({
        name: 'target-script',
        docType: DocType.InvoiceIn,
        scriptPath: 'parser.js',
        matcherPath: 'matcher.js',
      });

      const found = registry.getScriptById(script.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(script.id);
      expect(found!.name).toBe('target-script');
    });

    it('returns null for non-existent id', () => {
      const found = registry.getScriptById('nonexistent-id');
      expect(found).toBeNull();
    });
  });

  describe('getScriptsByDocType', () => {
    it('filters scripts by doc_type', () => {
      registry.registerScript({
        name: 'inv-1',
        docType: DocType.InvoiceIn,
        scriptPath: 'p1.js',
        matcherPath: 'm1.js',
      });
      registry.registerScript({
        name: 'inv-2',
        docType: DocType.InvoiceIn,
        scriptPath: 'p2.js',
        matcherPath: 'm2.js',
      });
      registry.registerScript({
        name: 'bank-1',
        docType: DocType.BankStatement,
        scriptPath: 'p3.js',
        matcherPath: 'm3.js',
      });

      const invoiceScripts = registry.getScriptsByDocType(DocType.InvoiceIn);
      expect(invoiceScripts).toHaveLength(2);

      const bankScripts = registry.getScriptsByDocType(DocType.BankStatement);
      expect(bankScripts).toHaveLength(1);

      const outScripts = registry.getScriptsByDocType(DocType.InvoiceOut);
      expect(outScripts).toHaveLength(0);
    });
  });

  // ── Usage tracking ──

  describe('recordUsage', () => {
    it('increments times_used and updates last_used_at', () => {
      const script = registry.registerScript({
        name: 'usage-test',
        docType: DocType.InvoiceIn,
        scriptPath: 'parser.js',
        matcherPath: 'matcher.js',
      });

      expect(script.times_used).toBe(0);

      const fileId = insertDummyFile(db);
      registry.recordUsage(script.id, fileId);

      const updated = registry.getScriptById(script.id)!;
      expect(updated.times_used).toBe(1);
    });

    it('creates file_script_assignments row', () => {
      const script = registry.registerScript({
        name: 'assign-test',
        docType: DocType.InvoiceIn,
        scriptPath: 'parser.js',
        matcherPath: 'matcher.js',
      });

      const fileId = insertDummyFile(db);
      registry.recordUsage(script.id, fileId);

      const assignment = db
        .prepare('SELECT * FROM file_script_assignments WHERE file_id = ? AND script_id = ?')
        .get(fileId, script.id) as any;

      expect(assignment).toBeTruthy();
      expect(assignment.file_id).toBe(fileId);
      expect(assignment.script_id).toBe(script.id);
    });

    it('increments correctly with multiple calls', () => {
      const script = registry.registerScript({
        name: 'multi-usage',
        docType: DocType.InvoiceIn,
        scriptPath: 'parser.js',
        matcherPath: 'matcher.js',
      });

      const fileId1 = insertDummyFile(db);
      const fileId2 = insertDummyFile(db);
      const fileId3 = insertDummyFile(db);

      registry.recordUsage(script.id, fileId1);
      registry.recordUsage(script.id, fileId2);
      registry.recordUsage(script.id, fileId3);

      const updated = registry.getScriptById(script.id)!;
      expect(updated.times_used).toBe(3);
    });
  });
});
