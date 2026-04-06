import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolves the project root directory reliably across all runtimes:
 *   - Packaged Electron app → app.getAppPath() (inside .asar or unpacked)
 *   - Dev mode (electron-forge webpack) → process.cwd() (project root)
 *   - Vitest / Node CLI → process.cwd() (project root)
 *
 * IMPORTANT: Do NOT use __dirname in webpack-bundled code.
 * Webpack replaces __dirname with "/" which breaks path resolution
 * in packaged builds.
 */

let _cachedRoot: string | null = null;

export function getAppRoot(): string {
  if (_cachedRoot !== null) return _cachedRoot;

  // Packaged Electron: use app.getAppPath() which points to the .asar
  if (process.versions.electron) {
    try {
      const { app } = require('electron');
      if (app.isPackaged) {
        _cachedRoot = app.getAppPath();
        return _cachedRoot;
      }
    } catch {
      // Not in main process — fall through
    }
  }

  // Dev mode / Vitest: process.cwd() is the project root
  _cachedRoot = process.cwd();
  return _cachedRoot;
}

/**
 * Finds node_modules directory by walking up from the app root.
 * In packaged Electron apps, node_modules is at app.asar.unpacked/node_modules
 * or alongside the .asar.
 */
export function findNodeModules(): string[] {
  // Packaged Electron: node_modules lives in app.asar.unpacked/
  if (process.versions.electron) {
    try {
      const { app } = require('electron');
      if (app.isPackaged) {
        const unpackedModules = path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
        );
        if (fs.existsSync(unpackedModules)) return [unpackedModules];

        // Also try alongside .asar
        const siblingModules = path.join(process.resourcesPath, 'node_modules');
        if (fs.existsSync(siblingModules)) return [siblingModules];
      }
    } catch {
      // Not in main process — fall through
    }
  }

  // Dev mode / Vitest: node_modules is at project root
  const root = getAppRoot();
  const candidate = path.join(root, 'node_modules');
  if (fs.existsSync(candidate)) return [candidate];

  return [];
}
