import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock electron's app module before importing app-config
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/iv-test-appconfig'),
  },
}));

import { loadAppConfig, saveAppConfig } from './app-config';
import { DEFAULT_CLAUDE_MODELS } from '../shared/constants';

const CONFIG_DIR = '/tmp/iv-test-appconfig';
const CONFIG_PATH = path.join(CONFIG_DIR, 'app-config.json');

beforeEach(() => {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // Clean up any existing config
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
});

afterEach(() => {
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
});

describe('app-config', () => {
  describe('loadAppConfig', () => {
    it('returns defaults when no config file exists', async () => {
      const config = await loadAppConfig();

      expect(config).toEqual({
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
      });
    });

    it('loads saved config from disk', async () => {
      const saved = {
        lastVaultPath: '/Users/test/vault1',
        vaultPaths: ['/Users/test/vault1', '/Users/test/vault2'],
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(saved));

      const config = await loadAppConfig();

      expect(config.lastVaultPath).toBe('/Users/test/vault1');
      expect(config.vaultPaths).toEqual(['/Users/test/vault1', '/Users/test/vault2']);
      // Defaults should be merged in
      expect(config.claudeCliPath).toBeNull();
      expect(config.autoStart).toBe(false);
    });

    it('returns defaults for corrupted config file', async () => {
      fs.writeFileSync(CONFIG_PATH, 'not json {{{');

      const config = await loadAppConfig();

      expect(config.lastVaultPath).toBeNull();
      expect(config.vaultPaths).toEqual([]);
    });
  });

  describe('saveAppConfig', () => {
    it('creates config file with partial data merged into defaults', async () => {
      await saveAppConfig({ lastVaultPath: '/Users/test/vault1' });

      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(raw.lastVaultPath).toBe('/Users/test/vault1');
      expect(raw.vaultPaths).toEqual([]);
      expect(raw.autoStart).toBe(false);
    });

    it('merges with existing config on save', async () => {
      await saveAppConfig({
        lastVaultPath: '/Users/test/vault1',
        vaultPaths: ['/Users/test/vault1'],
      });
      await saveAppConfig({
        lastVaultPath: '/Users/test/vault2',
      });

      const config = await loadAppConfig();
      expect(config.lastVaultPath).toBe('/Users/test/vault2');
      // vaultPaths from the first save should be preserved
      expect(config.vaultPaths).toEqual(['/Users/test/vault1']);
    });
  });

  describe('multi-vault operations', () => {
    it('supports adding multiple vaults', async () => {
      const vaults = ['/vault/a', '/vault/b', '/vault/c'];
      await saveAppConfig({ vaultPaths: vaults, lastVaultPath: vaults[0] });

      const config = await loadAppConfig();
      expect(config.vaultPaths).toHaveLength(3);
      expect(config.lastVaultPath).toBe('/vault/a');
    });

    it('supports switching active vault', async () => {
      await saveAppConfig({
        vaultPaths: ['/vault/a', '/vault/b'],
        lastVaultPath: '/vault/a',
      });

      // Simulate switch
      await saveAppConfig({ lastVaultPath: '/vault/b' });

      const config = await loadAppConfig();
      expect(config.lastVaultPath).toBe('/vault/b');
      expect(config.vaultPaths).toEqual(['/vault/a', '/vault/b']);
    });

    it('supports removing a vault from the list', async () => {
      await saveAppConfig({
        vaultPaths: ['/vault/a', '/vault/b', '/vault/c'],
        lastVaultPath: '/vault/b',
      });

      // Simulate remove-vault for /vault/b (active)
      const config = await loadAppConfig();
      const remaining = config.vaultPaths.filter(p => p !== '/vault/b');
      await saveAppConfig({
        vaultPaths: remaining,
        lastVaultPath: remaining[0] || null,
      });

      const updated = await loadAppConfig();
      expect(updated.vaultPaths).toEqual(['/vault/a', '/vault/c']);
      expect(updated.lastVaultPath).toBe('/vault/a');
    });

    it('sets lastVaultPath to null when all vaults removed', async () => {
      await saveAppConfig({
        vaultPaths: ['/vault/a'],
        lastVaultPath: '/vault/a',
      });

      await saveAppConfig({ vaultPaths: [], lastVaultPath: null });

      const config = await loadAppConfig();
      expect(config.vaultPaths).toEqual([]);
      expect(config.lastVaultPath).toBeNull();
    });

    it('preserves lastVaultPath when removing a non-active vault', async () => {
      await saveAppConfig({
        vaultPaths: ['/vault/a', '/vault/b', '/vault/c'],
        lastVaultPath: '/vault/a',
      });

      // Remove /vault/c (not active)
      const config = await loadAppConfig();
      const remaining = config.vaultPaths.filter(p => p !== '/vault/c');
      const isActive = config.lastVaultPath === '/vault/c';
      await saveAppConfig({
        vaultPaths: remaining,
        lastVaultPath: isActive ? (remaining[0] || null) : config.lastVaultPath,
      });

      const updated = await loadAppConfig();
      expect(updated.vaultPaths).toEqual(['/vault/a', '/vault/b']);
      expect(updated.lastVaultPath).toBe('/vault/a'); // unchanged
    });
  });
});
