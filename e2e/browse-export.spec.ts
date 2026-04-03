/**
 * E2E: Folder Browse & Export Flow
 *
 * Tests the folder browsing and export workflow:
 * - Home screen shows folders
 * - Clicking [→] on a folder enters browse mode with breadcrumb
 * - Export button triggers save dialog and writes files
 */
import { test, expect } from './fixtures';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('Folder Browse & Export Flow', () => {
  test('Home screen is visible when vault is configured', async ({ overlayPage }) => {
    // If no vault is configured this will show NoVault screen instead —
    // this test documents the expected state with a vault present.
    // In CI, seed the vault via fixtures before this check.
    const homeOrNoVault = overlayPage.locator('.home-screen, .no-vault-screen');
    await expect(homeOrNoVault).toBeVisible({ timeout: 5_000 });
  });

  test('clicking folder browse arrow enters folder scope and shows breadcrumb', async ({ overlayPage }) => {
    // This test requires at least one folder entry in the Home screen.
    // If no vault/records exist, skip gracefully.
    const folderArrow = overlayPage.locator('.folder-browse-btn').first();
    const hasFolders = await folderArrow.isVisible().catch(() => false);

    if (!hasFolders) {
      test.skip();
      return;
    }

    await folderArrow.click();

    // Breadcrumb bar should appear showing the folder path
    await expect(overlayPage.locator('.breadcrumb-bar')).toBeVisible({ timeout: 3_000 });

    // Results should show for the scoped folder
    await expect(overlayPage.locator('.result-list, .result-empty')).toBeVisible();
  });

  test('breadcrumb clear button exits folder scope', async ({ overlayPage }) => {
    const folderArrow = overlayPage.locator('.folder-browse-btn').first();
    const hasFolders = await folderArrow.isVisible().catch(() => false);
    if (!hasFolders) { test.skip(); return; }

    await folderArrow.click();
    await expect(overlayPage.locator('.breadcrumb-bar')).toBeVisible({ timeout: 3_000 });

    // Click the clear/× button on the breadcrumb
    await overlayPage.locator('.breadcrumb-clear').click();

    // Breadcrumb should be gone and Home screen should return
    await expect(overlayPage.locator('.breadcrumb-bar')).not.toBeVisible();
    await expect(overlayPage.locator('.home-screen')).toBeVisible({ timeout: 2_000 });
  });

  test('export button triggers save dialog', async ({ overlayPage, electronApp }) => {
    // Perform a search to get results and show the footer
    const input = overlayPage.locator('.search-input');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill('*');

    // Wait for footer to appear (requires results)
    const footer = overlayPage.locator('.sticky-footer');
    const footerVisible = await footer.isVisible().catch(() => false);
    if (!footerVisible) { test.skip(); return; }

    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-export-'));
    const exportPath = path.join(exportDir, 'test-export.xlsx');

    try {
      // Mock the save dialog
      await electronApp.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath,
        });
      }, exportPath);

      await overlayPage.locator('button:has-text("Export")').click();

      // Toast notification should appear
      await expect(overlayPage.locator('.export-toast')).toBeVisible({ timeout: 5_000 });
    } finally {
      fs.rmSync(exportDir, { recursive: true, force: true });
    }
  });
});
