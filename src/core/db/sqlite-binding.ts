import path from 'path';
import Database from 'better-sqlite3';

/**
 * Resolves the path to the correct better-sqlite3 native prebuilt depending
 * on the runtime:
 *   - Electron (process.versions.electron exists) → electron-v145-darwin-arm64
 *   - Node / Vitest                               → node-v137-darwin-arm64
 *
 * Both .node files live in node_modules/better-sqlite3/prebuilds/ and are
 * downloaded at install time by scripts/download-prebuilts.js.
 */
function resolveBinding(): string {
  const platform = process.platform;
  const arch     = process.arch;
  const isElectron = !!process.versions.electron;

  const abi     = isElectron ? '145' : '137';
  const runtime = isElectron ? 'electron' : 'node';
  const dirName = `${runtime}-v${abi}-${platform}-${arch}`;

  // Walk up from __dirname until we find a node_modules/better-sqlite3 directory.
  // This works regardless of whether we're in src/core/db (vitest) or .webpack/main (Electron).
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'node_modules', 'better-sqlite3', 'prebuilds');
    if (require('fs').existsSync(candidate)) {
      return path.join(candidate, dirName, 'better_sqlite3.node');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`better-sqlite3 prebuilds not found (started from ${__dirname})`);
}

export function openSqlite(filePath: string, options?: Database.Options): Database.Database {
  return new Database(filePath, { ...options, nativeBinding: resolveBinding() });
}
