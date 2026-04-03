import { test as base, ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface AppFixtures {
  electronApp: ElectronApplication;
  overlayPage: Page;
  tempVaultDir: string;
}

/**
 * Create a temporary directory to use as a test vault.
 * Caller is responsible for cleanup (done automatically via fixture teardown).
 */
export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'invoicevault-e2e-'));
}

/**
 * Remove a temp directory recursively.
 */
export function removeTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Base test fixture that launches Electron and provides the overlay window.
 *
 * Usage:
 *   import { test } from './fixtures';
 *   test('my test', async ({ overlayPage }) => { ... });
 */
export const test = base.extend<AppFixtures>({
  tempVaultDir: async ({}, use) => {
    const dir = createTempDir();
    await use(dir);
    removeTempDir(dir);
  },

  electronApp: async ({ tempVaultDir }, use) => {
    // Point to the webpack-compiled main process entry
    const mainEntry = path.join(__dirname, '..', '.webpack', 'main');

    const app = await electron.launch({
      args: [mainEntry],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        // Override config path so tests don't touch the real user config
        INVOICEVAULT_CONFIG_DIR: tempVaultDir,
      },
    });

    await use(app);
    await app.close();
  },

  overlayPage: async ({ electronApp }, use) => {
    // The overlay window is the first (and only) window
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
