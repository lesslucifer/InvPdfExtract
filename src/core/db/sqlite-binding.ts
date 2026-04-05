import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

/**
 * Resolves the path to the correct better-sqlite3 native prebuilt depending
 * on the runtime:
 *   - Electron (process.versions.electron exists) → electron-v145-<platform>-<arch>
 *   - Node / Vitest                               → node-v137-<platform>-<arch>
 *
 * Both .node files live in node_modules/better-sqlite3/prebuilds/ and are
 * downloaded at install time by scripts/download-prebuilts.js.
 *
 * In a packaged Electron app, .node files are unpacked to app.asar.unpacked/
 * and resolved via process.resourcesPath.
 */
function resolveBinding(): string {
  const platform = process.platform;
  const arch     = process.arch;
  const isElectron = !!process.versions.electron;

  const abi     = isElectron ? '145' : '137';
  const runtime = isElectron ? 'electron' : 'node';
  const dirName = `${runtime}-v${abi}-${platform}-${arch}`;
  const relPath = path.join('node_modules', 'better-sqlite3', 'prebuilds', dirName, 'better_sqlite3.node');

  // Packaged Electron app: .node files live in app.asar.unpacked/
  if (isElectron) {
    try {
      const { app } = require('electron');
      if (app.isPackaged) {
        const candidate = path.join(process.resourcesPath, 'app.asar.unpacked', relPath);
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {
      // Not in main process (e.g. preload) — fall through to walk-up
    }
  }

  // Dev mode / Vitest: walk up from __dirname until we find node_modules/better-sqlite3
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`better-sqlite3 prebuilds not found (started from ${__dirname})`);
}

export function openSqlite(filePath: string, options?: Database.Options): Database.Database {
  return new Database(filePath, { ...options, nativeBinding: resolveBinding() });
}
