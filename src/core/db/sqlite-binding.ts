import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { getAppRoot } from '../app-paths';

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
      // Not in main process (e.g. preload) — fall through
    }
  }

  // Dev mode / Vitest: resolve from project root
  const root = getAppRoot();
  const candidate = path.join(root, relPath);
  if (fs.existsSync(candidate)) return candidate;

  throw new Error(`better-sqlite3 prebuilds not found (looked in ${path.join(root, 'node_modules')})`);
}

export function openSqlite(filePath: string, options?: Database.Options): Database.Database {
  return new Database(filePath, { ...options, nativeBinding: resolveBinding() });
}
