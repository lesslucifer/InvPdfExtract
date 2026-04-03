import { BrowserWindow, globalShortcut, screen, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  searchRecords, getLineItemsByRecord, getFieldOverrides,
  upsertFieldOverride, resolveConflictKeep, resolveConflictAccept,
  resolveAllConflictsForRecord, updateFtsIndex,
  listRecentFolders, listTopFolders,
  getAggregates, gatherFilteredExportData,
} from '../core/db/records';
import { getDatabase } from '../core/db/database';
import { FieldOverrideInput, SearchFilters } from '../shared/types';
import { loadAppConfig, saveAppConfig } from '../core/app-config';
import { isVault } from '../core/vault';
import { eventBus } from '../core/event-bus';
import { VaultPathCache } from '../core/vault-path-cache';

export type StatusIndicator = 'idle' | 'processing' | 'review' | 'error';

export interface OverlayCallbacks {
  onInitVault: (folderPath: string) => Promise<void>;
  onSwitchVault: (vaultPath: string) => Promise<void>;
  onStopVault: () => Promise<void>;
  onReprocessAll: () => number;
  onQuit: () => Promise<void>;
}

const OVERLAY_WIDTH = 700;
const OVERLAY_MAX_HEIGHT = 500;

export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private vaultPath: string | null = null;
  private callbacks: OverlayCallbacks | null = null;
  private isHiding = false;
  private pathCache: VaultPathCache | null = null;

  setCallbacks(callbacks: OverlayCallbacks): void {
    this.callbacks = callbacks;
  }

  setPathCache(cache: VaultPathCache): void {
    this.pathCache = cache;
  }

  registerShortcut(): void {
    const accelerator = process.platform === 'darwin' ? 'Cmd+Shift+I' : 'Ctrl+Shift+I';
    const registered = globalShortcut.register(accelerator, () => {
      this.toggle();
    });
    if (!registered) {
      console.warn('[Overlay] Failed to register shortcut — it may be in use by another app');
    }
  }

  /** Allow triggering the overlay from tray menu or other callers */
  showOverlay(): void {
    this.show();
  }

  unregisterShortcut(): void {
    globalShortcut.unregisterAll();
  }

  setVaultPath(vaultPath: string | null): void {
    this.vaultPath = vaultPath;
  }

  toggle(): void {
    if (this.window && this.window.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    if (!this.window) {
      this.createWindow();
    }
    this.positionWindow();
    // Guard against spurious blur events during show/focus sequence
    this.isHiding = true;
    this.window!.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window!.show();
    this.window!.setVisibleOnAllWorkspaces(false);
    this.window!.focus();
    // Re-enable blur handler after the show/focus settles
    setTimeout(() => { this.isHiding = false; }, 100);
  }

  hide(): void {
    if (this.window && this.window.isVisible()) {
      this.isHiding = true;
      this.window.hide();
      this.isHiding = false;
    }
  }

  destroy(): void {
    this.unregisterShortcut();
    if (this.window) {
      this.window.destroy();
      this.window = null;
    }
  }

  private createWindow(): void {
    this.window = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_MAX_HEIGHT,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    this.window.on('blur', () => {
      if (!this.isHiding) {
        this.hide();
      }
    });
  }

  private positionWindow(): void {
    if (!this.window) return;
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.round((width - OVERLAY_WIDTH) / 2);
    const y = Math.round(height * 0.2); // 20% from top
    this.window.setPosition(x, y);
  }

  subscribeToStatusEvents(): void {
    const send = (status: StatusIndicator) => {
      this.window?.webContents.send('overlay-status-update', status);
    };
    eventBus.on('extraction:started', () => send('processing'));
    eventBus.on('extraction:completed', () => send('idle'));
    eventBus.on('extraction:error', () => send('error'));
    eventBus.on('review:needed', () => send('review'));
  }

  registerIpcHandlers(): void {
    ipcMain.handle('search', async (_event, query: string) => {
      if (!query || query.trim().length === 0) return [];
      try {
        return searchRecords(query.trim(), 50);
      } catch (err) {
        console.error('[Search] Query failed:', err);
        return [];
      }
    });

    ipcMain.handle('open-file', async (_event, relativePath: string) => {
      if (!this.vaultPath || !relativePath) return;
      const fullPath = path.join(this.vaultPath, relativePath);
      await shell.openPath(fullPath);
    });

    ipcMain.handle('get-line-items', async (_event, recordId: string) => {
      try {
        return getLineItemsByRecord(recordId);
      } catch (err) {
        console.error('[Search] Get line items failed:', err);
        return [];
      }
    });

    ipcMain.handle('save-field-override', async (_event, input: FieldOverrideInput) => {
      try {
        const db = getDatabase();
        // Get the current AI value for this field
        const row = db.prepare(`SELECT * FROM ${input.tableName} WHERE record_id = ?`).get(input.recordId) as any;
        const currentAiValue = row ? String(row[input.fieldName] ?? '') : '';

        // Update the field value in the extension table
        db.prepare(`UPDATE ${input.tableName} SET ${input.fieldName} = ? WHERE record_id = ?`)
          .run(input.userValue, input.recordId);

        // Create/update the field override
        upsertFieldOverride(input.recordId, input.tableName, input.fieldName, input.userValue, currentAiValue);

        // Update FTS index if applicable
        const ftsFields = ['so_hoa_don', 'mst', 'ten_doi_tac', 'dia_chi_doi_tac', 'mo_ta', 'ten_ngan_hang', 'stk'];
        if (ftsFields.includes(input.fieldName)) {
          const invoiceData = db.prepare('SELECT * FROM invoice_data WHERE record_id = ?').get(input.recordId) as any;
          const bankData = db.prepare('SELECT * FROM bank_statement_data WHERE record_id = ?').get(input.recordId) as any;
          updateFtsIndex(input.recordId, {
            so_hoa_don: invoiceData?.so_hoa_don,
            mst: invoiceData?.mst,
            ten_doi_tac: invoiceData?.ten_doi_tac ?? bankData?.ten_doi_tac,
            dia_chi_doi_tac: invoiceData?.dia_chi_doi_tac,
            mo_ta: bankData?.mo_ta,
            ten_ngan_hang: bankData?.ten_ngan_hang,
            stk: bankData?.stk,
          });
        }
      } catch (err) {
        console.error('[Override] Save field override failed:', err);
        throw err;
      }
    });

    ipcMain.handle('get-field-overrides', async (_event, recordId: string) => {
      try {
        const overrides = getFieldOverrides(recordId);
        return overrides.map((o: any) => ({
          field_name: o.field_name,
          status: o.status,
          user_value: o.user_value,
          ai_value_at_lock: o.ai_value_at_lock,
          ai_value_latest: o.ai_value_latest,
        }));
      } catch (err) {
        console.error('[Override] Get field overrides failed:', err);
        return [];
      }
    });

    ipcMain.handle('resolve-conflict', async (_event, recordId: string, fieldName: string, action: string) => {
      try {
        if (action === 'keep') {
          resolveConflictKeep(recordId, fieldName);
        } else {
          resolveConflictAccept(recordId, fieldName);
        }
      } catch (err) {
        console.error('[Override] Resolve conflict failed:', err);
        throw err;
      }
    });

    ipcMain.handle('resolve-all-conflicts', async (_event, recordId: string, action: string) => {
      try {
        resolveAllConflictsForRecord(recordId, action as 'keep' | 'accept');
      } catch (err) {
        console.error('[Override] Resolve all conflicts failed:', err);
        throw err;
      }
    });

    // === Spotlight UX IPC Handlers ===

    ipcMain.handle('get-app-config', async () => {
      return loadAppConfig();
    });

    ipcMain.handle('pick-folder', async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    });

    ipcMain.handle('init-vault', async (_event, folderPath: string) => {
      try {
        if (!this.callbacks) throw new Error('Overlay callbacks not set');
        await this.callbacks.onInitVault(folderPath);
        return { success: true };
      } catch (err) {
        console.error('[Overlay] init-vault failed:', err);
        return { success: false, error: (err as Error).message };
      }
    });

    ipcMain.handle('switch-vault', async (_event, vaultPath: string) => {
      try {
        if (!this.callbacks) throw new Error('Overlay callbacks not set');
        await this.callbacks.onSwitchVault(vaultPath);
        return { success: true };
      } catch (err) {
        console.error('[Overlay] switch-vault failed:', err);
        return { success: false };
      }
    });

    ipcMain.handle('remove-vault', async (_event, vaultPath: string) => {
      const config = loadAppConfig();
      const vaultPaths = (config.vaultPaths || []).filter(p => p !== vaultPath);
      const isActive = config.lastVaultPath === vaultPath;

      if (isActive && this.callbacks) {
        await this.callbacks.onStopVault();
      }

      saveAppConfig({
        vaultPaths,
        lastVaultPath: isActive ? (vaultPaths[0] || null) : config.lastVaultPath,
      });

      // If there's another vault, switch to it
      if (isActive && vaultPaths.length > 0 && this.callbacks) {
        await this.callbacks.onSwitchVault(vaultPaths[0]);
      }
    });

    ipcMain.handle('open-folder', async (_event, relativePath: string) => {
      if (!this.vaultPath) return;
      const fullPath = path.join(this.vaultPath, relativePath);
      await shell.openPath(fullPath);
    });

    ipcMain.handle('show-item-in-folder', async (_event, absolutePath: string) => {
      shell.showItemInFolder(absolutePath);
    });

    ipcMain.handle('check-claude-cli', async () => {
      try {
        const version = execSync('claude --version', { stdio: 'pipe' }).toString().trim();
        return { available: true, version };
      } catch {
        return { available: false };
      }
    });

    ipcMain.handle('reprocess-all', async () => {
      if (!this.callbacks) return { count: 0 };
      const count = this.callbacks.onReprocessAll();
      return { count };
    });

    ipcMain.handle('quit-app', async () => {
      if (this.callbacks) {
        await this.callbacks.onQuit();
      }
    });

    ipcMain.handle('list-recent-folders', async (_event, limit?: number) => {
      try {
        return listRecentFolders(limit);
      } catch (err) {
        console.error('[Overlay] list-recent-folders failed:', err);
        return [];
      }
    });

    ipcMain.handle('list-top-folders', async () => {
      try {
        return listTopFolders();
      } catch (err) {
        console.error('[Overlay] list-top-folders failed:', err);
        return [];
      }
    });

    ipcMain.handle('hide-overlay', async () => {
      this.hide();
    });

    ipcMain.handle('get-aggregates', async (_event, filters: SearchFilters) => {
      try {
        return getAggregates(filters);
      } catch (err) {
        console.error('[Overlay] get-aggregates failed:', err);
        return { totalRecords: 0, totalAmount: 0 };
      }
    });

    ipcMain.handle('list-vault-paths', async (_event, query: string, scope?: string) => {
      if (typeof query === 'string' && query.includes('..')) return [];
      return this.pathCache?.query(query ?? '', scope ?? undefined) ?? [];
    });

    ipcMain.handle('export-filtered', async (_event, filters: SearchFilters) => {
      try {
        const result = await dialog.showSaveDialog({
          title: 'Export to XLSX',
          defaultPath: 'invoicevault-export.xlsx',
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });
        if (result.canceled || !result.filePath) return { filePath: null };

        const { exportToXlsx } = await import('../core/export');
        const data = gatherFilteredExportData(filters);
        const buffer = exportToXlsx(data);
        const fs = await import('fs');
        fs.writeFileSync(result.filePath, buffer);
        return { filePath: result.filePath };
      } catch (err) {
        console.error('[Overlay] export-filtered failed:', err);
        return { filePath: null };
      }
    });
  }
}
