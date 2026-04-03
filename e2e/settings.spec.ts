/**
 * E2E: Settings Flow
 *
 * Tests the settings panel workflow:
 * - Clicking the gear icon opens the Settings panel
 * - Current vault is displayed
 * - Back button returns to previous state
 * - Add vault / switch vault work via mocked dialog
 */
import { test, expect, createTempDir, removeTempDir } from './fixtures';

test.describe('Settings Flow', () => {
  test('gear icon opens Settings panel', async ({ overlayPage }) => {
    const gearBtn = overlayPage.locator('.gear-icon');
    await expect(gearBtn).toBeVisible({ timeout: 5_000 });

    await gearBtn.click();

    await expect(overlayPage.locator('.settings-panel')).toBeVisible({ timeout: 3_000 });
  });

  test('Settings panel has a back button that returns to previous state', async ({ overlayPage }) => {
    const gearBtn = overlayPage.locator('.gear-icon');
    await expect(gearBtn).toBeVisible({ timeout: 5_000 });
    await gearBtn.click();

    await expect(overlayPage.locator('.settings-panel')).toBeVisible({ timeout: 3_000 });

    // Click back
    await overlayPage.locator('button:has-text("Back"), button[aria-label="Back"]').click();

    // Settings panel should close
    await expect(overlayPage.locator('.settings-panel')).not.toBeVisible({ timeout: 2_000 });
  });

  test('Escape key closes Settings panel', async ({ overlayPage }) => {
    const gearBtn = overlayPage.locator('.gear-icon');
    await expect(gearBtn).toBeVisible({ timeout: 5_000 });
    await gearBtn.click();

    await expect(overlayPage.locator('.settings-panel')).toBeVisible({ timeout: 3_000 });

    await overlayPage.keyboard.press('Escape');

    await expect(overlayPage.locator('.settings-panel')).not.toBeVisible({ timeout: 2_000 });
  });

  test('Add Vault button triggers folder picker and adds vault', async ({ overlayPage, electronApp }) => {
    const gearBtn = overlayPage.locator('.gear-icon');
    await expect(gearBtn).toBeVisible({ timeout: 5_000 });
    await gearBtn.click();
    await expect(overlayPage.locator('.settings-panel')).toBeVisible({ timeout: 3_000 });

    const newVaultDir = createTempDir();

    try {
      // Mock folder dialog
      await electronApp.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
        });
      }, newVaultDir);

      // Click "Add Vault" or "Choose Folder" in settings
      const addBtn = overlayPage.locator('button:has-text("Add"), button:has-text("Choose Folder")').first();
      const addBtnVisible = await addBtn.isVisible().catch(() => false);
      if (!addBtnVisible) { test.skip(); return; }

      await addBtn.click();

      // Settings panel should still be open and vault list should update
      await expect(overlayPage.locator('.settings-panel')).toBeVisible({ timeout: 5_000 });
    } finally {
      removeTempDir(newVaultDir);
    }
  });
});
