/**
 * E2E integration tests for the "clear vault" flow.
 *
 * These tests use a real filesystem (under /tmp) and exercise the same
 * sequence the `clear-vault-data` IPC handler runs:
 *   1. Stop vault (close DB)
 *   2. Auto-backup (vault data → .zip)
 *   3. Delete vault data directory
 *   4. Update app config
 *
 * The suite intentionally avoids mocking the filesystem so failures are
 * visible as real deletion failures rather than mock artefacts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_FILE, VAULT_SUBDIRS } from '../shared/constants';
import { clearVaultData, backupVault, isVault, initVault } from '../core/vault';
import { setUserDataPath, getVaultDotPath } from '../core/vault-paths';
import { AppConfig } from '../shared/types';
import { DEFAULT_CLAUDE_MODELS } from '../shared/constants';

vi.mock('../core/db/database', () => ({
  openDatabase: vi.fn(() => ({ close: vi.fn() })),
  closeDatabase: vi.fn(),
  setActiveDatabase: vi.fn(),
}));

const TEST_ROOT = '/tmp/iv-clear-e2e';
const TEST_USER_DATA = '/tmp/iv-clear-e2e-userdata';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildVault(vaultPath: string): void {
  const dotPath = getVaultDotPath(vaultPath);
  fs.mkdirSync(dotPath, { recursive: true });
  for (const sub of VAULT_SUBDIRS) {
    fs.mkdirSync(path.join(dotPath, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(dotPath, CONFIG_FILE), JSON.stringify({ version: 1, created_at: new Date().toISOString(), confidence_threshold: 0.8 }));
  // Simulate a small DB file so backup has something to include
  fs.writeFileSync(path.join(dotPath, 'vault.db'), 'FAKE_DB');
  // Add a file inside a subdir
  if (VAULT_SUBDIRS.length > 0) {
    fs.writeFileSync(path.join(dotPath, VAULT_SUBDIRS[0], 'sample.txt'), 'data');
  }
}

function makeConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    lastVaultPath: null,
    claudeCliPath: null,
    vaultPaths: [],
    autoStart: false,
    claudeModels: DEFAULT_CLAUDE_MODELS,
    locale: 'en',
    aiProvider: 'claude-cli',
    deepseekApiKey: null,
    deepseekModel: 'deepseek-v4-flash',
    deepseekThinking: false,
    ...overrides,
  };
}

/**
 * Simulates the exact sequence inside the `clear-vault-data` IPC handler,
 * but without Electron dependencies. Returns the final computed config state.
 */
async function runClearFlow(
  vaultPath: string,
  config: AppConfig,
  callbacks: {
    onStopVault: () => Promise<void>;
    onSwitchVault: (path: string) => Promise<void>;
  },
): Promise<{ finalConfig: Pick<AppConfig, 'vaultPaths' | 'lastVaultPath'>; backupCreated: boolean; dotPathDeleted: boolean }> {
  const isActive = config.lastVaultPath === vaultPath;

  if (isActive) {
    await callbacks.onStopVault();
  }

  // Auto-backup before clearing
  let backupCreated = false;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  const backupPath = path.join(vaultPath, `invoicevault.backup.${stamp}.zip`);
  try {
    await backupVault(vaultPath, backupPath);
    backupCreated = true;
  } catch {
    // swallow — same as the IPC handler
  }

  // Delete vault data
  await clearVaultData(vaultPath);
  const dotPathDeleted = !fs.existsSync(getVaultDotPath(vaultPath));

  // Update config
  const vaultPaths = (config.vaultPaths || []).filter(p => p !== vaultPath);
  const finalConfig: Pick<AppConfig, 'vaultPaths' | 'lastVaultPath'> = {
    vaultPaths,
    lastVaultPath: isActive ? (vaultPaths[0] || null) : config.lastVaultPath,
  };

  if (isActive && vaultPaths.length > 0) {
    await callbacks.onSwitchVault(vaultPaths[0]);
  }

  return { finalConfig, backupCreated, dotPathDeleted };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  if (fs.existsSync(TEST_USER_DATA)) fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  fs.mkdirSync(TEST_USER_DATA, { recursive: true });
  setUserDataPath(TEST_USER_DATA);
});

afterEach(() => {
  if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  if (fs.existsSync(TEST_USER_DATA)) fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('clear vault e2e', () => {
  describe('clearVaultData (core function)', () => {
    it('deletes vault data directory and all its contents', async () => {
      const vaultPath = path.join(TEST_ROOT, 'vault-a');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);

      const dotPath = getVaultDotPath(vaultPath);
      expect(fs.existsSync(dotPath)).toBe(true);

      await clearVaultData(vaultPath);

      expect(fs.existsSync(dotPath)).toBe(false);
    });

    it('leaves the root vault folder intact after clearing', async () => {
      const vaultPath = path.join(TEST_ROOT, 'vault-root-intact');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);

      await clearVaultData(vaultPath);

      expect(fs.existsSync(vaultPath)).toBe(true);
    });

    it('does not throw when vault data does not exist (idempotent)', async () => {
      const vaultPath = path.join(TEST_ROOT, 'no-vault-dir');
      fs.mkdirSync(vaultPath, { recursive: true });

      await expect(clearVaultData(vaultPath)).resolves.toBeUndefined();
    });

    it('deletes even when subdirectories contain files', async () => {
      const vaultPath = path.join(TEST_ROOT, 'vault-with-files');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);

      // Add extra nested content
      const dotPath = getVaultDotPath(vaultPath);
      fs.mkdirSync(path.join(dotPath, 'deep', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(dotPath, 'deep', 'nested', 'file.txt'), 'content');

      await clearVaultData(vaultPath);

      expect(fs.existsSync(dotPath)).toBe(false);
    });
  });

  describe('full clear flow (IPC handler simulation)', () => {
    it('deletes vault data when clearing the active vault', async () => {
      const vaultPath = path.join(TEST_ROOT, 'active-vault');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);

      const config = makeConfig({ vaultPaths: [vaultPath], lastVaultPath: vaultPath });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      const { dotPathDeleted } = await runClearFlow(vaultPath, config, { onStopVault, onSwitchVault });

      expect(dotPathDeleted).toBe(true);
      expect(fs.existsSync(getVaultDotPath(vaultPath))).toBe(false);
    });

    it('calls onStopVault before deleting when the vault is active', async () => {
      const vaultPath = path.join(TEST_ROOT, 'stop-order');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);

      const config = makeConfig({ vaultPaths: [vaultPath], lastVaultPath: vaultPath });
      const callOrder: string[] = [];
      const onStopVault = vi.fn().mockImplementation(async () => { callOrder.push('stop'); });
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      await runClearFlow(vaultPath, config, { onStopVault, onSwitchVault });

      expect(callOrder[0]).toBe('stop');
      expect(onStopVault).toHaveBeenCalledTimes(1);
    });

    it('does not call onStopVault when clearing an inactive vault', async () => {
      const activeVault = path.join(TEST_ROOT, 'active');
      const inactiveVault = path.join(TEST_ROOT, 'inactive');
      fs.mkdirSync(activeVault, { recursive: true });
      fs.mkdirSync(inactiveVault, { recursive: true });
      buildVault(inactiveVault);

      const config = makeConfig({ vaultPaths: [activeVault, inactiveVault], lastVaultPath: activeVault });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      await runClearFlow(inactiveVault, config, { onStopVault, onSwitchVault });

      expect(onStopVault).not.toHaveBeenCalled();
    });

    it('creates a backup zip before deleting', async () => {
      const vaultPath = path.join(TEST_ROOT, 'backup-before-clear');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);

      const config = makeConfig({ vaultPaths: [vaultPath], lastVaultPath: vaultPath });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      const { backupCreated } = await runClearFlow(vaultPath, config, { onStopVault, onSwitchVault });

      expect(backupCreated).toBe(true);
      // The backup zip is placed in the vault root (not inside vault data)
      const zips = fs.readdirSync(vaultPath).filter(f => f.endsWith('.zip'));
      expect(zips.length).toBe(1);
      expect(zips[0]).toMatch(/^invoicevault\.backup\.\d+\.zip$/);
    });

    it('proceeds with deletion even when backup fails', async () => {
      const vaultPath = path.join(TEST_ROOT, 'backup-fail');
      fs.mkdirSync(vaultPath, { recursive: true });

      const config = makeConfig({ vaultPaths: [vaultPath], lastVaultPath: vaultPath });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      const { backupCreated, dotPathDeleted } = await runClearFlow(vaultPath, config, { onStopVault, onSwitchVault });

      expect(backupCreated).toBe(false);
      expect(dotPathDeleted).toBe(true);
    });

    it('removes the cleared vault from the config', async () => {
      const vaultPath = path.join(TEST_ROOT, 'config-update');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);

      const config = makeConfig({ vaultPaths: [vaultPath], lastVaultPath: vaultPath });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      const { finalConfig } = await runClearFlow(vaultPath, config, { onStopVault, onSwitchVault });

      expect(finalConfig.vaultPaths).not.toContain(vaultPath);
      expect(finalConfig.lastVaultPath).toBeNull();
    });

    it('switches to the next vault after clearing the active one', async () => {
      const vault1 = path.join(TEST_ROOT, 'v1');
      const vault2 = path.join(TEST_ROOT, 'v2');
      fs.mkdirSync(vault1, { recursive: true });
      fs.mkdirSync(vault2, { recursive: true });
      buildVault(vault1);

      const config = makeConfig({ vaultPaths: [vault1, vault2], lastVaultPath: vault1 });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      const { finalConfig } = await runClearFlow(vault1, config, { onStopVault, onSwitchVault });

      expect(finalConfig.lastVaultPath).toBe(vault2);
      expect(onSwitchVault).toHaveBeenCalledWith(vault2);
    });

    it('sets lastVaultPath to null when no other vault exists', async () => {
      const vaultPath = path.join(TEST_ROOT, 'only-vault');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);

      const config = makeConfig({ vaultPaths: [vaultPath], lastVaultPath: vaultPath });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      const { finalConfig } = await runClearFlow(vaultPath, config, { onStopVault, onSwitchVault });

      expect(finalConfig.lastVaultPath).toBeNull();
      expect(onSwitchVault).not.toHaveBeenCalled();
    });

    it('does not change lastVaultPath when clearing an inactive vault', async () => {
      const activeVault = path.join(TEST_ROOT, 'still-active');
      const inactiveVault = path.join(TEST_ROOT, 'inactive-cleared');
      fs.mkdirSync(activeVault, { recursive: true });
      fs.mkdirSync(inactiveVault, { recursive: true });
      buildVault(inactiveVault);

      const config = makeConfig({ vaultPaths: [activeVault, inactiveVault], lastVaultPath: activeVault });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      const { finalConfig } = await runClearFlow(inactiveVault, config, { onStopVault, onSwitchVault });

      expect(finalConfig.lastVaultPath).toBe(activeVault);
      expect(finalConfig.vaultPaths).toEqual([activeVault]);
      expect(onSwitchVault).not.toHaveBeenCalled();
    });

    it('vault is no longer recognized as a vault after the full clear flow', async () => {
      const vaultPath = path.join(TEST_ROOT, 'post-clear-isvault');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);
      expect(await isVault(vaultPath)).toBe(true);

      const config = makeConfig({ vaultPaths: [vaultPath], lastVaultPath: vaultPath });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      await runClearFlow(vaultPath, config, { onStopVault, onSwitchVault });

      expect(await isVault(vaultPath)).toBe(false);
    });

    it('vault can be re-initialized after clearing', async () => {
      const vaultPath = path.join(TEST_ROOT, 'reinit-after-clear');
      fs.mkdirSync(vaultPath, { recursive: true });
      buildVault(vaultPath);

      const config = makeConfig({ vaultPaths: [vaultPath], lastVaultPath: vaultPath });
      const onStopVault = vi.fn().mockResolvedValue(undefined);
      const onSwitchVault = vi.fn().mockResolvedValue(undefined);

      await runClearFlow(vaultPath, config, { onStopVault, onSwitchVault });

      const handle = await initVault(vaultPath);
      expect(handle.rootPath).toBe(vaultPath);
      expect(await isVault(vaultPath)).toBe(true);
    });
  });
});
