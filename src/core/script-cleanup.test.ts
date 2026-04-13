import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { createInMemoryDb } from '../__tests__/helpers/mock-db';
import { DocType } from '../shared/types';
import { ScriptRegistry } from './script-registry';

let _testDb: Database.Database;

vi.mock('./db/database', () => ({
  getDatabase: () => _testDb,
}));

import { cleanupUnusedScripts } from './script-cleanup';

function insertDummyFile(db: Database.Database, id: string, deleted = false): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO files (id, relative_path, file_hash, file_type, file_size, status, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, `test/${id}.xlsx`, 'hash', 'xlsx', 100, 'done', now, now, deleted ? now : null);
}

describe('cleanupUnusedScripts', () => {
  let db: Database.Database;
  let registry: ScriptRegistry;
  let tmpDir: string;

  beforeEach(() => {
    db = createInMemoryDb();
    _testDb = db;
    registry = new ScriptRegistry(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-cleanup-'));
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes scripts with no file assignments older than grace period', () => {
    db.prepare(`
      INSERT INTO extraction_scripts (id, name, doc_type, script_path, matcher_path, times_used, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, 0, datetime('now', '-10 days'), datetime('now', '-10 days'))
    `).run('old-script', 'old', DocType.InvoiceIn, 'scripts/old-parser.js', 'scripts/old-matcher.js');

    fs.writeFileSync(path.join(tmpDir, 'scripts', 'old-parser.js'), '// parser');
    fs.writeFileSync(path.join(tmpDir, 'scripts', 'old-matcher.js'), '// matcher');

    const removed = cleanupUnusedScripts(tmpDir);

    expect(removed).toBe(1);
    expect(db.prepare('SELECT * FROM extraction_scripts WHERE id = ?').get('old-script')).toBeUndefined();
    expect(fs.existsSync(path.join(tmpDir, 'scripts', 'trash', 'old-parser.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'scripts', 'trash', 'old-matcher.js'))).toBe(true);
  });

  it('skips scripts created within grace period', () => {
    const script = registry.registerScript({
      name: 'recent',
      docType: DocType.InvoiceIn,
      scriptPath: 'scripts/recent-parser.js',
      matcherPath: 'scripts/recent-matcher.js',
    });

    const removed = cleanupUnusedScripts(tmpDir);

    expect(removed).toBe(0);
    expect(registry.getScriptById(script.id)).toBeTruthy();
  });

  it('skips scripts with active (non-deleted) file assignments', () => {
    db.prepare(`
      INSERT INTO extraction_scripts (id, name, doc_type, script_path, matcher_path, times_used, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now', '-10 days'), datetime('now'))
    `).run('used-script', 'used', DocType.InvoiceIn, 'scripts/used-parser.js', 'scripts/used-matcher.js');

    insertDummyFile(db, 'file-1');
    db.prepare("INSERT INTO file_script_assignments (file_id, script_id, assigned_at) VALUES (?, ?, datetime('now'))").run('file-1', 'used-script');

    const removed = cleanupUnusedScripts(tmpDir);

    expect(removed).toBe(0);
    expect(db.prepare('SELECT * FROM extraction_scripts WHERE id = ?').get('used-script')).toBeTruthy();
  });

  it('removes scripts whose only assigned files are deleted', () => {
    db.prepare(`
      INSERT INTO extraction_scripts (id, name, doc_type, script_path, matcher_path, times_used, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now', '-10 days'), datetime('now'))
    `).run('orphan-script', 'orphan', DocType.InvoiceIn, 'scripts/orphan-parser.js', 'scripts/orphan-matcher.js');

    insertDummyFile(db, 'deleted-file', true);
    db.prepare("INSERT INTO file_script_assignments (file_id, script_id, assigned_at) VALUES (?, ?, datetime('now'))").run('deleted-file', 'orphan-script');

    fs.writeFileSync(path.join(tmpDir, 'scripts', 'orphan-parser.js'), '// parser');
    fs.writeFileSync(path.join(tmpDir, 'scripts', 'orphan-matcher.js'), '// matcher');

    const removed = cleanupUnusedScripts(tmpDir);

    expect(removed).toBe(1);
    expect(db.prepare('SELECT * FROM extraction_scripts WHERE id = ?').get('orphan-script')).toBeUndefined();
  });

  it('returns 0 when no unused scripts exist', () => {
    const removed = cleanupUnusedScripts(tmpDir);
    expect(removed).toBe(0);
  });
});
