import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { DocType, ExtractionScript } from '../shared/types';

export interface RegisterScriptInput {
  name: string;
  docType: DocType;
  scriptPath: string;
  matcherPath: string;
  description?: string;
}

export class ScriptRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  registerScript(input: RegisterScriptInput): ExtractionScript {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO extraction_scripts (id, name, doc_type, script_path, matcher_path, matcher_description, times_used, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, input.name, input.docType, input.scriptPath, input.matcherPath, input.description ?? null, now, now);

    return {
      id,
      name: input.name,
      doc_type: input.docType,
      script_path: input.scriptPath,
      matcher_path: input.matcherPath,
      matcher_description: input.description ?? null,
      times_used: 0,
      created_at: now,
      last_used_at: now,
    };
  }

  getAllScripts(): ExtractionScript[] {
    return this.db.prepare('SELECT * FROM extraction_scripts').all() as ExtractionScript[];
  }

  getScriptById(id: string): ExtractionScript | null {
    const row = this.db.prepare('SELECT * FROM extraction_scripts WHERE id = ?').get(id) as ExtractionScript | undefined;
    return row ?? null;
  }

  getScriptsByDocType(docType: DocType): ExtractionScript[] {
    return this.db.prepare('SELECT * FROM extraction_scripts WHERE doc_type = ?').all(docType) as ExtractionScript[];
  }

  recordUsage(scriptId: string, fileId: string): void {
    this.db.prepare(`
      UPDATE extraction_scripts
      SET times_used = times_used + 1, last_used_at = datetime('now')
      WHERE id = ?
    `).run(scriptId);

    this.db.prepare(`
      INSERT OR REPLACE INTO file_script_assignments (file_id, script_id, assigned_at)
      VALUES (?, ?, datetime('now'))
    `).run(fileId, scriptId);
  }
}
