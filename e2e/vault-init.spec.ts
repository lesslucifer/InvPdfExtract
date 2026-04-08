/**
 * E2E: First Launch → Vault Initialization Flow
 *
 * Tests that on first launch (no vault configured), the No Vault screen
 * is shown and the user can initialize a vault via the UI.
 */
import { test, expect, createTempDir, removeTempDir } from './fixtures';
import fs from 'fs';
import path from 'path';

test.describe('Vault Init Flow', () => {
  test('shows No Vault screen on first launch with no config', async ({ overlayPage }) => {
    // On first launch with a clean config dir (no lastVaultPath), the overlay
    // should auto-show and display the No Vault screen
    await expect(overlayPage.locator('.no-vault-screen')).toBeVisible({ timeout: 5_000 });
    await expect(overlayPage.locator('text=No Vault')).toBeVisible();
  });

  test('initializes vault and transitions to Home screen', async ({ overlayPage, electronApp }) => {
    // Verify we start on No Vault screen
    await expect(overlayPage.locator('.no-vault-screen')).toBeVisible({ timeout: 5_000 });

    // Create a fresh temp dir for the vault
    const vaultDir = createTempDir();

    try {
      // Mock the dialog to return our temp dir
      await electronApp.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
        });
      }, vaultDir);

      // Click the "Choose Folder..." button
      await overlayPage.locator('button:has-text("Choose Folder")').click();

      // After vault init, should transition to Home screen
      await expect(overlayPage.locator('.home-screen')).toBeVisible({ timeout: 8_000 });

      // No Vault screen should be gone
      await expect(overlayPage.locator('.no-vault-screen')).not.toBeVisible();
    } finally {
      removeTempDir(vaultDir);
    }
  });

  test('vault directory contains .invoicevault folder after init', async ({ overlayPage, electronApp }) => {
    await expect(overlayPage.locator('.no-vault-screen')).toBeVisible({ timeout: 5_000 });

    const vaultDir = createTempDir();

    try {
      await electronApp.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
        });
      }, vaultDir);

      await overlayPage.locator('button:has-text("Choose Folder")').click();
      await expect(overlayPage.locator('.home-screen')).toBeVisible({ timeout: 8_000 });

      // Verify .invoicevault directory was created
      expect(fs.existsSync(path.join(vaultDir, '.invoicevault'))).toBe(true);
    } finally {
      removeTempDir(vaultDir);
    }
  });
});
