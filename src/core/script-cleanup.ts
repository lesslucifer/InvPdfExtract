import * as fs from 'fs';
import * as path from 'path';
import { getDatabase } from './db/database';

const GRACE_PERIOD_DAYS = 7;

interface UnusedScript {
  id: string;
  name: string;
  script_path: string;
  matcher_path: string;
}

export function cleanupUnusedScripts(vaultDotPath: string): number {
  const db = getDatabase();

  const unusedScripts = db.prepare(`
    SELECT es.id, es.name, es.script_path, es.matcher_path
    FROM extraction_scripts es
    WHERE es.created_at < datetime('now', ?)
      AND NOT EXISTS (
        SELECT 1 FROM file_script_assignments fsa
        JOIN files f ON f.id = fsa.file_id
        WHERE fsa.script_id = es.id AND f.deleted_at IS NULL
      )
  `).all(`-${GRACE_PERIOD_DAYS} days`) as UnusedScript[];

  if (unusedScripts.length === 0) return 0;

  const trashDir = path.join(vaultDotPath, 'scripts', 'trash');
  if (!fs.existsSync(trashDir)) {
    fs.mkdirSync(trashDir, { recursive: true });
  }

  const deleteAssignments = db.prepare('DELETE FROM file_script_assignments WHERE script_id = ?');
  const deleteScript = db.prepare('DELETE FROM extraction_scripts WHERE id = ?');

  for (const script of unusedScripts) {
    for (const relPath of [script.script_path, script.matcher_path]) {
      if (!relPath) continue;
      const src = path.join(vaultDotPath, relPath);
      if (fs.existsSync(src)) {
        const dest = path.join(trashDir, path.basename(relPath));
        fs.renameSync(src, dest);
      }
    }
    deleteAssignments.run(script.id);
    deleteScript.run(script.id);
  }

  console.log(`[ScriptCleanup] Removed ${unusedScripts.length} unused script(s)`);
  return unusedScripts.length;
}
