import { describe, it, expect } from 'vitest';
import { AppConfig } from '../shared/types';
import { DEFAULT_CLAUDE_MODELS } from '../shared/constants';

/**
 * Tests for the vault management logic used by SettingsPanel.
 * Extracted as pure functions to test without React/DOM dependencies.
 */

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

/** Returns vault paths that are not the active one (used by "Other Vaults" section) */
function getOtherVaults(config: AppConfig): string[] {
  return (config.vaultPaths || []).filter(p => p !== config.lastVaultPath);
}

/** Computes the new config after removing a vault */
function computeRemoveVault(config: AppConfig, vaultPath: string): Pick<AppConfig, 'vaultPaths' | 'lastVaultPath'> {
  const vaultPaths = (config.vaultPaths || []).filter(p => p !== vaultPath);
  const isActive = config.lastVaultPath === vaultPath;
  return {
    vaultPaths,
    lastVaultPath: isActive ? (vaultPaths[0] || null) : config.lastVaultPath,
  };
}

describe('settings vault logic', () => {
  describe('getOtherVaults', () => {
    it('returns empty when no vaults exist', () => {
      const config = makeConfig();
      expect(getOtherVaults(config)).toEqual([]);
    });

    it('returns empty when only the active vault exists', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a'],
        lastVaultPath: '/vault/a',
      });
      expect(getOtherVaults(config)).toEqual([]);
    });

    it('returns non-active vaults', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a', '/vault/b', '/vault/c'],
        lastVaultPath: '/vault/a',
      });
      expect(getOtherVaults(config)).toEqual(['/vault/b', '/vault/c']);
    });

    it('returns all vaults when none is active', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a', '/vault/b'],
        lastVaultPath: null,
      });
      expect(getOtherVaults(config)).toEqual(['/vault/a', '/vault/b']);
    });
  });

  describe('computeRemoveVault', () => {
    it('removes the active vault and falls back to next', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a', '/vault/b', '/vault/c'],
        lastVaultPath: '/vault/a',
      });

      const result = computeRemoveVault(config, '/vault/a');

      expect(result.vaultPaths).toEqual(['/vault/b', '/vault/c']);
      expect(result.lastVaultPath).toBe('/vault/b');
    });

    it('removes a non-active vault without changing active', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a', '/vault/b', '/vault/c'],
        lastVaultPath: '/vault/a',
      });

      const result = computeRemoveVault(config, '/vault/c');

      expect(result.vaultPaths).toEqual(['/vault/a', '/vault/b']);
      expect(result.lastVaultPath).toBe('/vault/a');
    });

    it('sets lastVaultPath to null when last vault is removed', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a'],
        lastVaultPath: '/vault/a',
      });

      const result = computeRemoveVault(config, '/vault/a');

      expect(result.vaultPaths).toEqual([]);
      expect(result.lastVaultPath).toBeNull();
    });

    it('handles removing a vault that does not exist (no-op)', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a', '/vault/b'],
        lastVaultPath: '/vault/a',
      });

      const result = computeRemoveVault(config, '/vault/nonexistent');

      expect(result.vaultPaths).toEqual(['/vault/a', '/vault/b']);
      expect(result.lastVaultPath).toBe('/vault/a');
    });

    it('handles removing from empty vault list', () => {
      const config = makeConfig();

      const result = computeRemoveVault(config, '/vault/a');

      expect(result.vaultPaths).toEqual([]);
      expect(result.lastVaultPath).toBeNull();
    });
  });

  describe('vault switch flow', () => {
    it('switch only changes lastVaultPath, not vaultPaths', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a', '/vault/b'],
        lastVaultPath: '/vault/a',
      });

      // Simulate switch: only lastVaultPath changes
      const updated = { ...config, lastVaultPath: '/vault/b' };

      expect(updated.vaultPaths).toEqual(['/vault/a', '/vault/b']);
      expect(updated.lastVaultPath).toBe('/vault/b');
      expect(getOtherVaults(updated)).toEqual(['/vault/a']);
    });
  });

  describe('add vault flow', () => {
    it('new vault is added to vaultPaths and becomes active', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a'],
        lastVaultPath: '/vault/a',
      });

      // Simulate: initVault adds the new path and switches to it
      const updated: AppConfig = {
        ...config,
        vaultPaths: [...config.vaultPaths, '/vault/b'],
        lastVaultPath: '/vault/b',
      };

      expect(updated.vaultPaths).toEqual(['/vault/a', '/vault/b']);
      expect(updated.lastVaultPath).toBe('/vault/b');
    });

    it('first vault added to empty list becomes active', () => {
      const config = makeConfig();

      const updated: AppConfig = {
        ...config,
        vaultPaths: ['/vault/a'],
        lastVaultPath: '/vault/a',
      };

      expect(updated.vaultPaths).toHaveLength(1);
      expect(updated.lastVaultPath).toBe('/vault/a');
    });
  });

  describe('disconnect vault with modifier key (clear data)', () => {
    type ClearConfirm = string | null;

    /** Simulates the disconnect button logic: normal click = disconnect, Cmd/Ctrl+click = clear data with confirmation */
    function handleDisconnect(
      clearConfirm: ClearConfirm,
      vaultPath: string,
      modifierKey: boolean,
    ): { clearConfirm: ClearConfirm; action: 'disconnect' | 'clear' | 'await-confirm' } {
      if (!modifierKey) {
        return { clearConfirm: null, action: 'disconnect' };
      }
      // Modifier held: clear data flow
      if (clearConfirm !== vaultPath) {
        return { clearConfirm: vaultPath, action: 'await-confirm' };
      }
      return { clearConfirm: null, action: 'clear' };
    }

    it('normal click disconnects immediately', () => {
      const result = handleDisconnect(null, '/vault/a', false);
      expect(result.action).toBe('disconnect');
      expect(result.clearConfirm).toBeNull();
    });

    it('Cmd+click on first press asks for confirmation', () => {
      const result = handleDisconnect(null, '/vault/a', true);
      expect(result.action).toBe('await-confirm');
      expect(result.clearConfirm).toBe('/vault/a');
    });

    it('second click on confirmed vault clears data', () => {
      const result = handleDisconnect('/vault/a', '/vault/a', true);
      expect(result.action).toBe('clear');
      expect(result.clearConfirm).toBeNull();
    });

    it('Cmd+click on different vault resets confirmation', () => {
      const result = handleDisconnect('/vault/a', '/vault/b', true);
      expect(result.action).toBe('await-confirm');
      expect(result.clearConfirm).toBe('/vault/b');
    });

    it('clear data also removes vault from config (same as remove)', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a', '/vault/b'],
        lastVaultPath: '/vault/a',
      });
      const result = computeRemoveVault(config, '/vault/a');
      expect(result.vaultPaths).toEqual(['/vault/b']);
      expect(result.lastVaultPath).toBe('/vault/b');
    });
  });

  describe('switch vault confirmation flow', () => {
    type SwitchState = string | null; // vaultPath pending confirmation, or null

    /** Simulates the two-click switch confirmation logic */
    function handleSwitchConfirm(currentConfirm: SwitchState, vaultPath: string): { confirm: SwitchState; shouldSwitch: boolean } {
      if (currentConfirm !== vaultPath) {
        return { confirm: vaultPath, shouldSwitch: false };
      }
      return { confirm: null, shouldSwitch: true };
    }

    it('first click sets confirmation, does not switch', () => {
      const result = handleSwitchConfirm(null, '/vault/b');
      expect(result.confirm).toBe('/vault/b');
      expect(result.shouldSwitch).toBe(false);
    });

    it('second click on same vault confirms and switches', () => {
      const result = handleSwitchConfirm('/vault/b', '/vault/b');
      expect(result.confirm).toBeNull();
      expect(result.shouldSwitch).toBe(true);
    });

    it('clicking a different vault resets confirmation to that vault', () => {
      const result = handleSwitchConfirm('/vault/b', '/vault/c');
      expect(result.confirm).toBe('/vault/c');
      expect(result.shouldSwitch).toBe(false);
    });
  });

  describe('disconnect inactive vault', () => {
    it('removes a non-active vault from the list', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a', '/vault/b', '/vault/c'],
        lastVaultPath: '/vault/a',
      });

      const result = computeRemoveVault(config, '/vault/c');

      expect(result.vaultPaths).toEqual(['/vault/a', '/vault/b']);
      expect(result.lastVaultPath).toBe('/vault/a');
    });

    it('other vaults list updates after disconnecting an inactive vault', () => {
      const config = makeConfig({
        vaultPaths: ['/vault/a', '/vault/b', '/vault/c'],
        lastVaultPath: '/vault/a',
      });

      const result = computeRemoveVault(config, '/vault/b');
      const updatedConfig = makeConfig({ ...result });

      expect(getOtherVaults(updatedConfig)).toEqual(['/vault/c']);
    });
  });
});
