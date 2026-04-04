import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { INVOICEVAULT_DIR, CONFIG_FILE, DB_FILE, VAULT_SUBDIRS } from '../shared/constants';

// Mock the database module to avoid native module issues in tests
vi.mock('./db/database', () => ({
  openDatabase: vi.fn(),
  closeDatabase: vi.fn(),
}));

import { isVault, initVault, openVault, closeVault, getVaultConfig, updateVaultConfig, clearVaultData } from './vault';
import { openDatabase, closeDatabase } from './db/database';

const TEST_ROOT = '/tmp/iv-test-vault';

function createTestVault(vaultPath: string): void {
  const dotPath = path.join(vaultPath, INVOICEVAULT_DIR);
  fs.mkdirSync(dotPath, { recursive: true });
  for (const sub of VAULT_SUBDIRS) {
    fs.mkdirSync(path.join(dotPath, sub), { recursive: true });
  }
  fs.writeFileSync(
    path.join(dotPath, CONFIG_FILE),
    JSON.stringify({
      version: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      confidence_threshold: 0.8,
    }),
  );
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  cleanDir(TEST_ROOT);
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  cleanDir(TEST_ROOT);
});

describe('vault core', () => {
  describe('isVault', () => {
    it('returns false for a plain folder', () => {
      expect(isVault(TEST_ROOT)).toBe(false);
    });

    it('returns false when .invoicevault exists but config.json is missing', () => {
      fs.mkdirSync(path.join(TEST_ROOT, INVOICEVAULT_DIR), { recursive: true });
      expect(isVault(TEST_ROOT)).toBe(false);
    });

    it('returns true when .invoicevault and config.json exist', () => {
      createTestVault(TEST_ROOT);
      expect(isVault(TEST_ROOT)).toBe(true);
    });
  });

  describe('initVault', () => {
    it('creates .invoicevault directory structure', () => {
      const vaultPath = path.join(TEST_ROOT, 'new-vault');
      fs.mkdirSync(vaultPath, { recursive: true });

      initVault(vaultPath);

      const dotPath = path.join(vaultPath, INVOICEVAULT_DIR);
      expect(fs.existsSync(dotPath)).toBe(true);
      for (const sub of VAULT_SUBDIRS) {
        expect(fs.existsSync(path.join(dotPath, sub))).toBe(true);
      }
    });

    it('writes config.json with correct structure', () => {
      const vaultPath = path.join(TEST_ROOT, 'new-vault');
      fs.mkdirSync(vaultPath, { recursive: true });

      initVault(vaultPath);

      const configPath = path.join(vaultPath, INVOICEVAULT_DIR, CONFIG_FILE);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.version).toBe(1);
      expect(config.confidence_threshold).toBe(0.8);
      expect(config.created_at).toBeDefined();
    });

    it('calls openDatabase with the correct db path', () => {
      const vaultPath = path.join(TEST_ROOT, 'new-vault');
      fs.mkdirSync(vaultPath, { recursive: true });

      initVault(vaultPath);

      const expectedDbPath = path.join(vaultPath, INVOICEVAULT_DIR, DB_FILE);
      expect(openDatabase).toHaveBeenCalledWith(expectedDbPath);
    });

    it('returns a VaultHandle with correct paths', () => {
      const vaultPath = path.join(TEST_ROOT, 'new-vault');
      fs.mkdirSync(vaultPath, { recursive: true });

      const handle = initVault(vaultPath);

      expect(handle.rootPath).toBe(vaultPath);
      expect(handle.dotPath).toBe(path.join(vaultPath, INVOICEVAULT_DIR));
      expect(handle.dbPath).toBe(path.join(vaultPath, INVOICEVAULT_DIR, DB_FILE));
      expect(handle.config.version).toBe(1);
    });

    it('writes default extraction prompt', () => {
      const vaultPath = path.join(TEST_ROOT, 'new-vault');
      fs.mkdirSync(vaultPath, { recursive: true });

      initVault(vaultPath);

      const promptPath = path.join(vaultPath, INVOICEVAULT_DIR, 'extraction-prompt.md');
      expect(fs.existsSync(promptPath)).toBe(true);
    });

    it('throws when folder is already a vault', () => {
      createTestVault(TEST_ROOT);

      expect(() => initVault(TEST_ROOT)).toThrow('Folder is already an InvoiceVault');
    });
  });

  describe('openVault', () => {
    it('opens an existing vault and returns a handle', () => {
      createTestVault(TEST_ROOT);

      const handle = openVault(TEST_ROOT);

      expect(handle.rootPath).toBe(TEST_ROOT);
      expect(handle.config.version).toBe(1);
      expect(openDatabase).toHaveBeenCalledWith(
        path.join(TEST_ROOT, INVOICEVAULT_DIR, DB_FILE),
      );
    });

    it('throws when folder is not a vault', () => {
      expect(() => openVault(TEST_ROOT)).toThrow('Not an InvoiceVault');
    });
  });

  describe('closeVault', () => {
    it('delegates to closeDatabase', () => {
      closeVault();
      expect(closeDatabase).toHaveBeenCalledTimes(1);
    });
  });

  describe('getVaultConfig / updateVaultConfig', () => {
    it('reads config from disk', () => {
      createTestVault(TEST_ROOT);
      const dotPath = path.join(TEST_ROOT, INVOICEVAULT_DIR);

      const config = getVaultConfig(dotPath);

      expect(config.version).toBe(1);
      expect(config.confidence_threshold).toBe(0.8);
    });

    it('updates config fields while preserving others', () => {
      createTestVault(TEST_ROOT);
      const dotPath = path.join(TEST_ROOT, INVOICEVAULT_DIR);

      updateVaultConfig(dotPath, { confidence_threshold: 0.9 });

      const config = getVaultConfig(dotPath);
      expect(config.confidence_threshold).toBe(0.9);
      expect(config.version).toBe(1); // preserved
    });
  });

  describe('multi-vault isolation', () => {
    it('each vault has independent config', () => {
      const vault1 = path.join(TEST_ROOT, 'vault1');
      const vault2 = path.join(TEST_ROOT, 'vault2');
      fs.mkdirSync(vault1, { recursive: true });
      fs.mkdirSync(vault2, { recursive: true });

      initVault(vault1);
      initVault(vault2);

      // Update vault1 config
      updateVaultConfig(
        path.join(vault1, INVOICEVAULT_DIR),
        { confidence_threshold: 0.5 },
      );

      // vault2 should be unchanged
      const config2 = getVaultConfig(path.join(vault2, INVOICEVAULT_DIR));
      expect(config2.confidence_threshold).toBe(0.8);
    });

    it('each vault gets its own database path', () => {
      const vault1 = path.join(TEST_ROOT, 'vault1');
      const vault2 = path.join(TEST_ROOT, 'vault2');
      fs.mkdirSync(vault1, { recursive: true });
      fs.mkdirSync(vault2, { recursive: true });

      const handle1 = initVault(vault1);
      const handle2 = initVault(vault2);

      expect(handle1.dbPath).not.toBe(handle2.dbPath);
      expect(handle1.dbPath).toContain('vault1');
      expect(handle2.dbPath).toContain('vault2');
    });
  });

  describe('clearVaultData', () => {
    it('deletes the .invoicevault directory', () => {
      const vaultPath = path.join(TEST_ROOT, 'clear-test');
      fs.mkdirSync(vaultPath, { recursive: true });
      initVault(vaultPath);

      const dotPath = path.join(vaultPath, INVOICEVAULT_DIR);
      expect(fs.existsSync(dotPath)).toBe(true);

      clearVaultData(vaultPath);

      expect(fs.existsSync(dotPath)).toBe(false);
      // The root folder itself should still exist
      expect(fs.existsSync(vaultPath)).toBe(true);
    });

    it('is a no-op for a folder without .invoicevault', () => {
      const vaultPath = path.join(TEST_ROOT, 'no-vault');
      fs.mkdirSync(vaultPath, { recursive: true });

      // Should not throw
      clearVaultData(vaultPath);

      expect(fs.existsSync(vaultPath)).toBe(true);
    });

    it('folder is no longer recognized as a vault after clearing', () => {
      const vaultPath = path.join(TEST_ROOT, 'clear-check');
      fs.mkdirSync(vaultPath, { recursive: true });
      initVault(vaultPath);
      expect(isVault(vaultPath)).toBe(true);

      clearVaultData(vaultPath);

      expect(isVault(vaultPath)).toBe(false);
    });

    it('allows re-initializing a vault after clearing', () => {
      const vaultPath = path.join(TEST_ROOT, 'reinit');
      fs.mkdirSync(vaultPath, { recursive: true });
      initVault(vaultPath);
      clearVaultData(vaultPath);

      // Should not throw — the vault was cleared
      const handle = initVault(vaultPath);
      expect(handle.rootPath).toBe(vaultPath);
      expect(isVault(vaultPath)).toBe(true);
    });
  });
});
