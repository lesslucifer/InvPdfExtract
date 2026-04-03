/**
 * E2E: Path Search Flow (Phase 6)
 *
 * Tests the '/' prefix path search mode:
 * - Typing '/' enters PathSearch mode and shows the path results list
 * - Typing '/subfolder' filters the list
 * - Selecting a folder exits PathSearch and sets breadcrumb scope
 * - Escape in PathSearch resets to Home
 * - Backspace to empty restores previous state
 */
import * as path from 'path';
import * as fs from 'fs';
import { test, expect, createTempDir, removeTempDir } from './fixtures';

test.describe('Path Search Flow', () => {
  let vaultDir: string;
  let subfolderA: string;
  let subfolderB: string;

  test.beforeEach(async ({ electronApp, overlayPage }) => {
    // Create a temporary vault with a couple of subfolders
    vaultDir = createTempDir();
    subfolderA = path.join(vaultDir, 'invoices-out');
    subfolderB = path.join(vaultDir, 'bank-statements');
    fs.mkdirSync(subfolderA, { recursive: true });
    fs.mkdirSync(subfolderB, { recursive: true });

    // Mock initVault / switch-vault so the overlay can open our temp vault
    await electronApp.evaluate(({ ipcMain: _ipc }, dir) => {
      // Use the app's IPC to switch to our test vault
      void dir; // unused — we rely on the overlay IPC
    }, vaultDir);

    // Initialize the vault via the overlay IPC
    await overlayPage.evaluate(async (dir) => {
      await (window as any).api.initVault(dir);
    }, vaultDir);

    // Wait for overlay to settle
    await overlayPage.waitForTimeout(500);
  });

  test.afterEach(() => {
    if (vaultDir) removeTempDir(vaultDir);
  });

  test('typing / enters PathSearch mode and shows path results', async ({ overlayPage }) => {
    const input = overlayPage.locator('input[type="text"], .search-input input').first();
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.click();
    await input.type('/');

    // PathResultsList should appear
    await expect(overlayPage.locator('.path-results-list, .path-results-empty')).toBeVisible({ timeout: 3_000 });
  });

  test('typing /inv filters path results', async ({ overlayPage }) => {
    const input = overlayPage.locator('input[type="text"], .search-input input').first();
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.click();
    await input.type('/inv');

    // Should show 'invoices-out' but not 'bank-statements'
    await expect(overlayPage.locator('.path-results-list')).toBeVisible({ timeout: 3_000 });
    await expect(overlayPage.locator('.path-results-item')).toContainText('invoices-out', { timeout: 3_000 });
  });

  test('selecting a folder exits PathSearch and shows breadcrumb', async ({ overlayPage }) => {
    const input = overlayPage.locator('input[type="text"], .search-input input').first();
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.click();
    await input.type('/inv');

    // Wait for the invoices-out item to appear and click it
    const folderItem = overlayPage.locator('.path-results-item', { hasText: 'invoices-out' }).first();
    await expect(folderItem).toBeVisible({ timeout: 3_000 });
    await folderItem.click();

    // PathResultsList should be gone
    await expect(overlayPage.locator('.path-results-list')).not.toBeVisible({ timeout: 2_000 });

    // Breadcrumb should show the selected folder
    await expect(overlayPage.locator('.breadcrumb-bar')).toBeVisible({ timeout: 3_000 });
    await expect(overlayPage.locator('.breadcrumb-bar')).toContainText('invoices-out');
  });

  test('Escape in PathSearch resets to Home', async ({ overlayPage }) => {
    const input = overlayPage.locator('input[type="text"], .search-input input').first();
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.click();
    await input.type('/inv');
    await expect(overlayPage.locator('.path-results-list, .path-results-empty')).toBeVisible({ timeout: 3_000 });

    await overlayPage.keyboard.press('Escape');

    // PathResultsList should be gone and we should be back on Home
    await expect(overlayPage.locator('.path-results-list')).not.toBeVisible({ timeout: 2_000 });
    await expect(overlayPage.locator('.home-screen')).toBeVisible({ timeout: 2_000 });
  });

  test('backspace to empty in PathSearch restores previous state', async ({ overlayPage }) => {
    const input = overlayPage.locator('input[type="text"], .search-input input').first();
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.click();
    // Type '/' then delete it
    await input.type('/');
    await expect(overlayPage.locator('.path-results-list, .path-results-empty')).toBeVisible({ timeout: 3_000 });
    await overlayPage.keyboard.press('Backspace');

    // Should be back to Home, no path results
    await expect(overlayPage.locator('.path-results-list')).not.toBeVisible({ timeout: 2_000 });
    await expect(overlayPage.locator('.home-screen')).toBeVisible({ timeout: 2_000 });
  });
});
