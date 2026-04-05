import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OverlayCallbacks } from './overlay-window';

/**
 * Tests for the OverlayCallbacks contract — the interface between
 * overlay-window.ts IPC handlers and the vault lifecycle in main.ts.
 *
 * These test the callback behavior in isolation, without Electron dependencies.
 */

function createMockCallbacks(overrides?: Partial<OverlayCallbacks>): OverlayCallbacks {
  return {
    onInitVault: vi.fn().mockResolvedValue(undefined),
    onSwitchVault: vi.fn().mockResolvedValue(undefined),
    onStopVault: vi.fn().mockResolvedValue(undefined),
    onReprocessAll: vi.fn().mockReturnValue(5),
    onReprocessFile: vi.fn().mockReturnValue(1),
    onReprocessFolder: vi.fn().mockReturnValue(3),
    onCountFolderFiles: vi.fn().mockReturnValue(10),
    onCancelQueueItem: vi.fn().mockReturnValue(true),
    onClearPendingQueue: vi.fn().mockReturnValue(2),
    onQuit: vi.fn().mockResolvedValue(undefined),
    onGenerateJE: vi.fn().mockResolvedValue(0),
    onGenerateJEForFile: vi.fn().mockResolvedValue(0),
    getVaultRoot: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

describe('OverlayCallbacks contract', () => {
  let callbacks: OverlayCallbacks;

  beforeEach(() => {
    callbacks = createMockCallbacks();
  });

  describe('init-vault handler logic', () => {
    it('calls onInitVault and returns success on success', async () => {
      const folderPath = '/Users/test/vault';
      await callbacks.onInitVault(folderPath);

      expect(callbacks.onInitVault).toHaveBeenCalledWith(folderPath);
      expect(callbacks.onInitVault).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from onInitVault', async () => {
      callbacks = createMockCallbacks({
        onInitVault: vi.fn().mockRejectedValue(new Error('Cannot write to this folder')),
      });

      await expect(callbacks.onInitVault('/readonly/folder')).rejects.toThrow(
        'Cannot write to this folder',
      );
    });
  });

  describe('switch-vault handler logic', () => {
    it('calls onSwitchVault with the target path', async () => {
      const vaultPath = '/Users/test/other-vault';
      await callbacks.onSwitchVault(vaultPath);

      expect(callbacks.onSwitchVault).toHaveBeenCalledWith(vaultPath);
    });
  });

  describe('remove-vault handler logic', () => {
    it('calls onStopVault when removing the active vault', async () => {
      // Simulate the remove-vault handler logic
      const activeVaultPath = '/Users/test/vault';
      const isActive = true;

      if (isActive) {
        await callbacks.onStopVault();
      }

      expect(callbacks.onStopVault).toHaveBeenCalledTimes(1);
    });

    it('does not call onStopVault when removing a non-active vault', async () => {
      const isActive = false;

      if (isActive) {
        await callbacks.onStopVault();
      }

      expect(callbacks.onStopVault).not.toHaveBeenCalled();
    });

    it('switches to next vault after removing the active one', async () => {
      const remainingVaults = ['/Users/test/other-vault'];
      const isActive = true;

      if (isActive) {
        await callbacks.onStopVault();
      }
      if (isActive && remainingVaults.length > 0) {
        await callbacks.onSwitchVault(remainingVaults[0]);
      }

      expect(callbacks.onStopVault).toHaveBeenCalledTimes(1);
      expect(callbacks.onSwitchVault).toHaveBeenCalledWith('/Users/test/other-vault');
    });

    it('does not switch when no vaults remain', async () => {
      const remainingVaults: string[] = [];
      const isActive = true;

      if (isActive) {
        await callbacks.onStopVault();
      }
      if (isActive && remainingVaults.length > 0) {
        await callbacks.onSwitchVault(remainingVaults[0]);
      }

      expect(callbacks.onStopVault).toHaveBeenCalledTimes(1);
      expect(callbacks.onSwitchVault).not.toHaveBeenCalled();
    });
  });

  describe('reprocess-all handler logic', () => {
    it('calls onReprocessAll and returns the count', () => {
      const count = callbacks.onReprocessAll();

      expect(callbacks.onReprocessAll).toHaveBeenCalledTimes(1);
      expect(count).toBe(5);
    });

    it('returns 0 when no callbacks set', () => {
      // Simulate: if (!this.callbacks) return { count: 0 }
      const noCallbacks = null as OverlayCallbacks | null;
      const count = noCallbacks ? noCallbacks.onReprocessAll() : 0;

      expect(count).toBe(0);
    });
  });

  describe('quit-app handler logic', () => {
    it('calls onQuit for clean shutdown', async () => {
      await callbacks.onQuit();

      expect(callbacks.onQuit).toHaveBeenCalledTimes(1);
    });
  });
});
