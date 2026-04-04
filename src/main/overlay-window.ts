import { BrowserWindow, globalShortcut, screen, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  searchRecords, getLineItemsByRecord, getFieldOverrides, getFieldOverridesByLineItemId,
  upsertFieldOverride, resolveConflictKeep, resolveConflictAccept,
  resolveAllConflictsForRecord, updateFtsIndex,
  listRecentFolders, listTopFolders,
  getAggregates, gatherFilteredExportData,
  getErrorLogsWithPath, getProcessedFilesWithStats,
} from '../core/db/records';
import { getDatabase } from '../core/db/database';
import { getFilesByStatuses, getFileStatusesByPaths, getFolderStatuses } from '../core/db/files';
import { FieldOverrideInput, LineItemFieldInput, SearchFilters, FileStatus } from '../shared/types';
import { loadAppConfig, saveAppConfig } from '../core/app-config';
import { isVault, clearVaultData } from '../core/vault';
import { eventBus } from '../core/event-bus';
import { VaultPathCache } from '../core/vault-path-cache';

export type StatusIndicator = 'idle' | 'processing' | 'review' | 'error';

export interface OverlayCallbacks {
  onInitVault: (folderPath: string) => Promise<void>;
  onSwitchVault: (vaultPath: string) => Promise<void>;
  onStopVault: () => Promise<void>;
  onReprocessAll: () => number;
  onReprocessFile: (relativePath: string) => number;
  onReprocessFolder: (folderPrefix: string) => number;
  onCountFolderFiles: (folderPrefix: string) => number;
  onCancelQueueItem: (fileId: string) => boolean;
  onClearPendingQueue: () => number;
  onQuit: () => Promise<void>;
}

const OVERLAY_WIDTH = 700;
const OVERLAY_MAX_HEIGHT = 500;

export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private vaultPath: string | null = null;
  private callbacks: OverlayCallbacks | null = null;
  private isHiding = false;
  private isPinned = false;
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
      if (!this.isHiding && !this.isPinned) {
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
    const sendFileStatus = (fileIds: string[], status: FileStatus) => {
      this.window?.webContents.send('file-status-changed', { fileIds, status });
    };
    eventBus.on('extraction:started', (data) => {
      send('processing');
      sendFileStatus(data.fileIds, FileStatus.Processing);
    });
    eventBus.on('extraction:completed', (data) => {
      send('idle');
      sendFileStatus([data.fileId], FileStatus.Done);
    });
    eventBus.on('extraction:error', (data) => {
      send('error');
      sendFileStatus([data.fileId], FileStatus.Error);
    });
    eventBus.on('review:needed', (data) => {
      send('review');
      sendFileStatus([data.fileId], FileStatus.Review);
    });
  }

  registerIpcHandlers(): void {
    ipcMain.handle('search', async (_event, query: string, offset: number = 0, folder: string | null = null, filePath: string | null = null) => {
      try {
        return searchRecords((query || '').trim(), 50, offset, folder, filePath);
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

    ipcMain.handle('save-line-item-field', async (_event, input: LineItemFieldInput) => {
      try {
        const db = getDatabase();
        const allowedFields = ['mo_ta', 'don_gia', 'so_luong', 'thue_suat', 'thanh_tien_truoc_thue', 'thanh_tien'];
        if (!allowedFields.includes(input.fieldName)) {
          throw new Error(`Invalid line item field: ${input.fieldName}`);
        }

        // Get current AI value
        const row = db.prepare('SELECT * FROM invoice_line_items WHERE id = ?').get(input.lineItemId) as any;
        if (!row) throw new Error(`Line item not found: ${input.lineItemId}`);
        const currentAiValue = String(row[input.fieldName] ?? '');

        // Update the field value
        const numericFields = ['don_gia', 'so_luong', 'thue_suat', 'thanh_tien_truoc_thue', 'thanh_tien'];
        const value = numericFields.includes(input.fieldName)
          ? (input.userValue === '' ? null : parseFloat(input.userValue))
          : input.userValue;
        db.prepare(`UPDATE invoice_line_items SET ${input.fieldName} = ? WHERE id = ?`)
          .run(value, input.lineItemId);

        // Create/update the field override (use the line item's record_id for FK, and lineItemId to identify which line item)
        upsertFieldOverride(row.record_id, 'invoice_line_items', input.fieldName, input.userValue, currentAiValue, input.lineItemId);
      } catch (err) {
        console.error('[Override] Save line item field failed:', err);
        throw err;
      }
    });

    ipcMain.handle('get-line-item-overrides', async (_event, lineItemIds: string[]) => {
      try {
        const result: Record<string, any[]> = {};
        for (const id of lineItemIds) {
          const overrides = getFieldOverridesByLineItemId(id);
          if (overrides.length > 0) {
            result[id] = overrides.map((o: any) => ({
              field_name: o.field_name,
              status: o.status,
              user_value: o.user_value,
              ai_value_at_lock: o.ai_value_at_lock,
              ai_value_latest: o.ai_value_latest,
            }));
          }
        }
        return result;
      } catch (err) {
        console.error('[Override] Get line item overrides failed:', err);
        return {};
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

    ipcMain.handle('clear-vault-data', async (_event, vaultPath: string) => {
      const config = loadAppConfig();
      const isActive = config.lastVaultPath === vaultPath;

      // Stop the vault if it's active
      if (isActive && this.callbacks) {
        await this.callbacks.onStopVault();
      }

      // Delete the .invoicevault directory
      clearVaultData(vaultPath);

      // Remove from config
      const vaultPaths = (config.vaultPaths || []).filter(p => p !== vaultPath);
      saveAppConfig({
        vaultPaths,
        lastVaultPath: isActive ? (vaultPaths[0] || null) : config.lastVaultPath,
      });

      // Switch to next vault if available
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

    ipcMain.handle('reprocess-file', async (_event, relativePath: string) => {
      if (!this.callbacks) return { count: 0 };
      const count = this.callbacks.onReprocessFile(relativePath);
      return { count };
    });

    ipcMain.handle('reprocess-folder', async (_event, folderPrefix: string) => {
      if (!this.callbacks) return { count: 0 };
      const count = this.callbacks.onReprocessFolder(folderPrefix);
      return { count };
    });

    ipcMain.handle('count-folder-files', async (_event, folderPrefix: string) => {
      if (!this.callbacks) return { count: 0 };
      const count = this.callbacks.onCountFolderFiles(folderPrefix);
      return { count };
    });

    ipcMain.handle('cancel-queue-item', async (_event, fileId: string) => {
      if (!this.callbacks) return { success: false };
      const success = this.callbacks.onCancelQueueItem(fileId);
      return { success };
    });

    ipcMain.handle('clear-pending-queue', async () => {
      if (!this.callbacks) return { count: 0 };
      const count = this.callbacks.onClearPendingQueue();
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

    ipcMain.handle('set-pinned', async (_event, pinned: boolean) => {
      this.isPinned = pinned;
    });

    ipcMain.handle('get-pinned', async () => {
      return this.isPinned;
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

    // Processing status handlers
    ipcMain.handle('get-files-by-statuses', async (_event, statuses: FileStatus[]) => {
      try {
        return getFilesByStatuses(statuses);
      } catch (err) {
        console.error('[Overlay] get-files-by-statuses failed:', err);
        return [];
      }
    });

    ipcMain.handle('get-error-logs-with-path', async () => {
      try {
        return getErrorLogsWithPath();
      } catch (err) {
        console.error('[Overlay] get-error-logs-with-path failed:', err);
        return [];
      }
    });

    ipcMain.handle('get-processed-files-with-stats', async () => {
      try {
        return getProcessedFilesWithStats();
      } catch (err) {
        console.error('[Overlay] get-processed-files-with-stats failed:', err);
        return [];
      }
    });

    ipcMain.handle('get-file-statuses-by-paths', async (_event, paths: string[]) => {
      try {
        return getFileStatusesByPaths(paths);
      } catch (err) {
        console.error('[Overlay] get-file-statuses-by-paths failed:', err);
        return {};
      }
    });

    ipcMain.handle('get-folder-statuses', async () => {
      try {
        return getFolderStatuses();
      } catch (err) {
        console.error('[Overlay] get-folder-statuses failed:', err);
        return {};
      }
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
