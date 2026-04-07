import { BrowserWindow, globalShortcut, screen, ipcMain, shell, dialog, app, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import {
  searchRecords, getLineItemsByRecord, getFieldOverrides, getFieldOverridesByLineItemId,
  upsertFieldOverride, resolveConflictKeep, resolveConflictAccept,
  resolveAllConflictsForRecord, updateFtsIndex,
  listRecentFolders, listTopFolders,
  getAggregates, gatherJEExportData,
  getErrorLogsWithPath, getProcessedFilesWithStats,
  updateJeStatus, getJeQueueItems, getJeErrorItems,
  getSessionLogForFile, getRecordIdsByFilters,
} from '../core/db/records';
import { getDatabase } from '../core/db/database';
import { getFilesByStatuses, getFileStatusesByPaths, getFolderStatuses } from '../core/db/files';
import { listPresets, savePreset, deletePreset } from '../core/db/presets';
import {
  getJournalEntriesByRecord, insertJournalEntry, updateJournalEntry,
  deleteJournalEntry as dbDeleteJE, findExistingEntry,
} from '../core/db/journal-entries';
import { readInstructions, writeInstructions } from '../core/je-instructions';
import { BankStatementData, FieldOverrideInfo, FieldOverrideInput, InvoiceData, InvoiceLineItem, JournalEntryInput, LineItemFieldInput, SearchFilters, FileStatus } from '../shared/types';
import { loadAppConfig, saveAppConfig } from '../core/app-config';
import { clearVaultData } from '../core/vault';
import { eventBus } from '../core/event-bus';
import { VaultPathCache } from '../core/vault-path-cache';
import { t } from '../lib/i18n';

export type StatusIndicator = 'idle' | 'processing' | 'review' | 'error';

export interface OverlayCallbacks {
  onInitVault: (folderPath: string) => Promise<void>;
  onSwitchVault: (vaultPath: string) => Promise<void>;
  onStopVault: () => Promise<void>;
  onReprocessAll: () => number;
  onReprocessFile: (relativePath: string) => number;
  onReprocessFolder: (folderPrefix: string) => Promise<number>;
  onCountFolderFiles: (folderPrefix: string) => Promise<number>;
  onCancelQueueItem: (fileId: string) => boolean;
  onClearPendingQueue: () => number;
  onQuit: () => Promise<void>;
  onGenerateJE: (recordId: string) => Promise<number>;
  onGenerateJEAIOnly: (recordId: string) => Promise<number>;
  onGenerateJEForFile: (fileId: string) => Promise<number>;
  onGenerateJEForFilters: (filters: SearchFilters, aiOnly: boolean) => Promise<number>;
  getVaultRoot: () => string | null;
}

const OVERLAY_WIDTH = 860;
const OVERLAY_MAX_HEIGHT = 560;

export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private vaultPath: string | null = null;
  private callbacks: OverlayCallbacks | null = null;
  private isHiding = false;
  private pathCache: VaultPathCache | null = null;
  private spawnedWindows: Set<BrowserWindow> = new Set();
  private initialStateMap: Map<number, string> = new Map();
  private blurTimeout: ReturnType<typeof setTimeout> | null = null;
  private suppressBlur = false;
  private pendingDbError: string | null = null;

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

  notifyDbError(error: string): void {
    this.pendingDbError = error;
    this.broadcastToAll('db-error', error);
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

  closeAllSpawnedWindows(): void {
    for (const win of this.spawnedWindows) {
      if (!win.isDestroyed()) win.close();
    }
    this.spawnedWindows.clear();
    this.initialStateMap.clear();
  }

  destroy(): void {
    this.unregisterShortcut();
    for (const win of this.spawnedWindows) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.spawnedWindows.clear();
    this.initialStateMap.clear();
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
      if (!this.isHiding && !this.suppressBlur) {
        // Debounce blur to avoid hiding during internal click sequences
        // (e.g. Alt+click on macOS can cause momentary focus loss)
        if (this.blurTimeout) clearTimeout(this.blurTimeout);
        this.blurTimeout = setTimeout(() => {
          if (this.window && !this.window.isFocused()) {
            this.hide();
          }
        }, 150);
      }
    });

    this.window.on('focus', () => {
      // Cancel pending blur-hide if focus returns quickly
      if (this.blurTimeout) {
        clearTimeout(this.blurTimeout);
        this.blurTimeout = null;
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

  private broadcastToAll(channel: string, ...args: unknown[]): void {
    this.window?.webContents.send(channel, ...args);
    for (const win of this.spawnedWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    }
  }

  private getAppIcon(): Electron.NativeImage | undefined {
    const resourceDir = app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(app.getAppPath(), 'resources');
    // Use platform-appropriate icon format
    const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon-1024.png';
    const iconPath = path.join(resourceDir, iconFile);
    const img = nativeImage.createFromPath(iconPath);
    return img.isEmpty() ? undefined : img;
  }

  private spawnWindowlized(serializedState?: string): void {
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 500,
      minHeight: 400,
      frame: false,
      transparent: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: true,
      show: false,
      backgroundColor: '#1c1c1e',
      icon: this.getAppIcon(),
      webPreferences: {
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const url = MAIN_WINDOW_WEBPACK_ENTRY + '?windowlized=true';
    win.loadURL(url);

    if (serializedState) {
      this.initialStateMap.set(win.webContents.id, serializedState);
    }

    const wcId = win.webContents.id;
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      this.spawnedWindows.delete(win);
      this.initialStateMap.delete(wcId);
    });

    this.spawnedWindows.add(win);
  }

  subscribeToStatusEvents(): void {
    const send = (status: StatusIndicator) => {
      this.broadcastToAll('overlay-status-update', status);
    };
    const sendFileStatus = (fileIds: string[], status: FileStatus) => {
      this.broadcastToAll('file-status-changed', { fileIds, status });
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
    eventBus.on('je:status-changed', (data) => {
      this.broadcastToAll('je-status-changed', data);
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

    ipcMain.handle('locate-file', async (_event, relativePath: string) => {
      if (!this.vaultPath || !relativePath) return;
      const fullPath = path.join(this.vaultPath, relativePath);
      shell.showItemInFolder(fullPath);
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
        const row = db.prepare(`SELECT * FROM ${input.tableName} WHERE record_id = ?`).get(input.recordId) as Record<string, unknown> | undefined;
        const currentAiValue = row ? String(row[input.fieldName] ?? '') : '';

        // Update the field value in the extension table
        db.prepare(`UPDATE ${input.tableName} SET ${input.fieldName} = ? WHERE record_id = ?`)
          .run(input.userValue, input.recordId);

        // Create/update the field override
        upsertFieldOverride(input.recordId, input.tableName, input.fieldName, input.userValue, currentAiValue);

        // Update FTS index if applicable
        const ftsFields = ['invoice_number', 'tax_id', 'counterparty_name', 'counterparty_address', 'description', 'bank_name', 'account_number'];
        if (ftsFields.includes(input.fieldName)) {
          const invoiceData = db.prepare('SELECT * FROM invoice_data WHERE record_id = ?').get(input.recordId) as InvoiceData | undefined;
          const bankData = db.prepare('SELECT * FROM bank_statement_data WHERE record_id = ?').get(input.recordId) as BankStatementData | undefined;
          updateFtsIndex(input.recordId, {
            invoice_number: invoiceData?.invoice_number ?? undefined,
            tax_id: invoiceData?.tax_id ?? undefined,
            counterparty_name: invoiceData?.counterparty_name ?? bankData?.counterparty_name ?? undefined,
            counterparty_address: invoiceData?.counterparty_address ?? undefined,
            description: bankData?.description ?? undefined,
            bank_name: bankData?.bank_name ?? undefined,
            account_number: bankData?.account_number ?? undefined,
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
        return overrides.map((o: FieldOverrideInfo) => ({
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
        const allowedFields = ['description', 'unit_price', 'quantity', 'tax_rate', 'subtotal', 'total_with_tax'];
        if (!allowedFields.includes(input.fieldName)) {
          throw new Error(`Invalid line item field: ${input.fieldName}`);
        }

        // Get current AI value
        const row = db.prepare('SELECT * FROM invoice_line_items WHERE id = ?').get(input.lineItemId) as InvoiceLineItem | undefined;
        if (!row) throw new Error(`Line item not found: ${input.lineItemId}`);
        const currentAiValue = String((row?.[input.fieldName as keyof InvoiceLineItem] ?? ''));

        // Update the field value
        const numericFields = ['unit_price', 'quantity', 'tax_rate', 'subtotal', 'total_with_tax'];
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
        const result: Record<string, FieldOverrideInfo[]> = {};
        for (const id of lineItemIds) {
          const overrides = getFieldOverridesByLineItemId(id);
          if (overrides.length > 0) {
            result[id] = overrides.map((o: FieldOverrideInfo) => ({
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
      return await loadAppConfig();
    });

    ipcMain.handle('get-locale', async () => {
      return (await loadAppConfig()).locale ?? 'en';
    });

    ipcMain.handle('set-locale', async (_event, locale: 'en' | 'vi') => {
      await saveAppConfig({ locale });
    });

    ipcMain.handle('pick-folder', async () => {
      const result = await dialog.showOpenDialog({
        title: t('select_folder', 'Select folder'),
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
        this.closeAllSpawnedWindows();
        await this.callbacks.onSwitchVault(vaultPath);
        return { success: true };
      } catch (err) {
        console.error('[Overlay] switch-vault failed:', err);
        return { success: false };
      }
    });

    ipcMain.handle('remove-vault', async (_event, vaultPath: string) => {
      const config = await loadAppConfig();
      const vaultPaths = (config.vaultPaths || []).filter(p => p !== vaultPath);
      const isActive = config.lastVaultPath === vaultPath;

      if (isActive) {
        this.closeAllSpawnedWindows();
        if (this.callbacks) await this.callbacks.onStopVault();
      }

      await saveAppConfig({
        vaultPaths,
        lastVaultPath: isActive ? (vaultPaths[0] || null) : config.lastVaultPath,
      });

      // If there's another vault, switch to it
      if (isActive && vaultPaths.length > 0 && this.callbacks) {
        await this.callbacks.onSwitchVault(vaultPaths[0]);
      }
    });

    ipcMain.handle('clear-vault-data', async (_event, vaultPath: string) => {
      const config = await loadAppConfig();
      const isActive = config.lastVaultPath === vaultPath;

      // Stop the vault if it's active
      if (isActive) {
        this.closeAllSpawnedWindows();
        if (this.callbacks) await this.callbacks.onStopVault();
      }

      // Delete the .invoicevault directory
      await clearVaultData(vaultPath);

      // Remove from config
      const vaultPaths = (config.vaultPaths || []).filter(p => p !== vaultPath);
      await saveAppConfig({
        vaultPaths,
        lastVaultPath: isActive ? (vaultPaths[0] || null) : config.lastVaultPath,
      });

      // Switch to next vault if available
      if (isActive && vaultPaths.length > 0 && this.callbacks) {
        await this.callbacks.onSwitchVault(vaultPaths[0]);
      }
    });

    ipcMain.handle('locate-folder', async (_event, relativePath: string) => {
      if (!this.vaultPath) return;
      const fullPath = path.join(this.vaultPath, relativePath);
      shell.showItemInFolder(fullPath);
    });

    ipcMain.handle('show-item-in-folder', async (_event, absolutePath: string) => {
      shell.showItemInFolder(absolutePath);
    });

    ipcMain.handle('check-claude-cli', async () => {
      try {
        const { stdout } = await execAsync('claude --version');
        return { available: true, version: stdout.trim() };
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
      const count = await this.callbacks.onReprocessFolder(folderPrefix);
      return { count };
    });

    ipcMain.handle('count-folder-files', async (_event, folderPrefix: string) => {
      if (!this.callbacks) return { count: 0 };
      const count = await this.callbacks.onCountFolderFiles(folderPrefix);
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

    ipcMain.handle('windowlize', async (_event, serializedState?: string) => {
      this.spawnWindowlized(serializedState);
      this.hide();
    });

    ipcMain.handle('get-initial-state', async (event) => {
      if (!event.sender) return null;
      const state = this.initialStateMap.get(event.sender.id);
      if (state) {
        this.initialStateMap.delete(event.sender.id);
      }
      return state ?? null;
    });

    ipcMain.handle('get-db-error', async () => {
      const error = this.pendingDbError;
      this.pendingDbError = null;
      return error;
    });

    ipcMain.handle('close-window', async (event) => {
      if (!event.sender) return;
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (senderWin && this.spawnedWindows.has(senderWin)) {
        senderWin.close();
      } else {
        this.hide();
      }
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

    ipcMain.handle('get-session-log-for-file', async (_event, fileId: string) => {
      try {
        return getSessionLogForFile(fileId);
      } catch (err) {
        console.error('[Overlay] get-session-log-for-file failed:', err);
        return null;
      }
    });

    ipcMain.handle('read-cli-session-log', async (_event, sessionLogPath: string) => {
      try {
        if (!sessionLogPath.includes('/.claude/projects/')) return null;
        return await fs.promises.readFile(sessionLogPath, 'utf-8').catch(() => null);
      } catch (err) {
        console.error('[Overlay] read-cli-session-log failed:', err);
        return null;
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

    ipcMain.handle('list-presets', async () => {
      try {
        const rows = listPresets();
        return rows.map(r => ({ id: r.id, name: r.name, filtersJson: r.filters_json, createdAt: r.created_at }));
      } catch (err) {
        console.error('[Overlay] list-presets failed:', err);
        return [];
      }
    });

    ipcMain.handle('save-preset', async (_event, name: string, filtersJson: string) => {
      try {
        const row = savePreset(name, filtersJson);
        return { id: row.id, name: row.name, filtersJson: row.filters_json, createdAt: row.created_at };
      } catch (err) {
        console.error('[Overlay] save-preset failed:', err);
        throw err;
      }
    });

    ipcMain.handle('delete-preset', async (_event, id: string) => {
      try {
        deletePreset(id);
      } catch (err) {
        console.error('[Overlay] delete-preset failed:', err);
        throw err;
      }
    });

    ipcMain.handle('export-filtered', async (_event, filters: SearchFilters) => {
      this.suppressBlur = true;
      try {
        const result = await dialog.showSaveDialog(this.window!, {
          title: t('export_to_xlsx', 'Export to XLSX'),
          defaultPath: 'je-export.xlsx',
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });
        if (result.canceled || !result.filePath) return { filePath: null };

        const { exportJEToXlsx } = await import('../core/export');
        const rows = gatherJEExportData(filters);
        const buffer = exportJEToXlsx(rows);
        await fs.promises.writeFile(result.filePath, buffer);
        return { filePath: result.filePath };
      } catch (err) {
        console.error('[Overlay] export-filtered failed:', err);
        return { filePath: null };
      } finally {
        this.suppressBlur = false;
      }
    });

    // === Journal Entries ===

    ipcMain.handle('get-journal-entries', async (_event, recordId: string) => {
      try {
        return getJournalEntriesByRecord(recordId);
      } catch (err) {
        console.error('[JournalEntry] Get entries failed:', err);
        return [];
      }
    });

    ipcMain.handle('save-journal-entry', async (_event, input: JournalEntryInput) => {
      try {
        const existing = findExistingEntry(input.recordId, input.lineItemId ?? null, input.entryType);
        if (existing) {
          updateJournalEntry(existing.id, input.account, input.cashFlow ?? null, input.contraAccount ?? null);
          const db = getDatabase();
          const updated = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(existing.id);
          eventBus.emit('je:updated', { recordId: input.recordId });
          return updated;
        }
        const entry = insertJournalEntry(
          input.recordId, input.lineItemId ?? null, input.entryType,
          input.account, input.cashFlow ?? null,
          'user', null, null,
          input.contraAccount ?? null,
        );
        eventBus.emit('je:updated', { recordId: input.recordId });
        return entry;
      } catch (err) {
        console.error('[JournalEntry] Save entry failed:', err);
        throw err;
      }
    });

    ipcMain.handle('delete-journal-entry', async (_event, id: string) => {
      try {
        dbDeleteJE(id);
      } catch (err) {
        console.error('[JournalEntry] Delete entry failed:', err);
        throw err;
      }
    });

    ipcMain.handle('reclassify-record', async (_event, recordId: string) => {
      try {
        if (!this.callbacks) return;
        updateJeStatus([recordId], 'pending');
        eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'pending' });
        // Fire and forget — status updates come via events
        this.callbacks.onGenerateJE(recordId).catch((err: Error) => {
          console.error('[JournalEntry] Reclassify failed:', err);
        });
      } catch (err) {
        console.error('[JournalEntry] Reclassify record failed:', err);
      }
    });

    ipcMain.handle('reclassify-record-ai-only', async (_event, recordId: string) => {
      try {
        if (!this.callbacks) return;
        updateJeStatus([recordId], 'pending');
        eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'pending' });
        // Fire and forget — status updates come via events
        this.callbacks.onGenerateJEAIOnly(recordId).catch((err: Error) => {
          console.error('[JournalEntry] Reclassify AI-only failed:', err);
        });
      } catch (err) {
        console.error('[JournalEntry] Reclassify AI-only record failed:', err);
      }
    });

    ipcMain.handle('reclassify-filtered', async (_event, filters: SearchFilters, aiOnly: boolean) => {
      try {
        if (!this.callbacks) return { count: 0 };
        const recordIds = getRecordIdsByFilters(filters);
        if (recordIds.length === 0) return { count: 0 };
        updateJeStatus(recordIds, 'pending');
        eventBus.emit('je:status-changed', { recordIds, status: 'pending' });
        this.callbacks.onGenerateJEForFilters(filters, aiOnly).catch((err: Error) => {
          console.error('[JournalEntry] Reclassify filtered failed:', err);
        });
        return { count: recordIds.length };
      } catch (err) {
        console.error('[JournalEntry] Reclassify filtered handler failed:', err);
        return { count: 0 };
      }
    });

    ipcMain.handle('get-je-queue-items', async () => {
      try {
        return getJeQueueItems();
      } catch (err) {
        console.error('[JournalEntry] Get JE queue items failed:', err);
        return [];
      }
    });

    ipcMain.handle('get-je-error-items', async () => {
      try {
        return getJeErrorItems();
      } catch (err) {
        console.error('[JournalEntry] Get JE error items failed:', err);
        return [];
      }
    });

    ipcMain.handle('get-je-instructions', async () => {
      try {
        const root = this.callbacks?.getVaultRoot();
        if (!root) return '';
        return await readInstructions(root);
      } catch (err) {
        console.error('[JournalEntry] Get instructions failed:', err);
        return '';
      }
    });

    ipcMain.handle('save-je-instructions', async (_event, content: string) => {
      try {
        const root = this.callbacks?.getVaultRoot();
        if (!root) return;
        await writeInstructions(root, content);
        eventBus.emit('je:instructions-changed', {} as never);
      } catch (err) {
        console.error('[JournalEntry] Save instructions failed:', err);
        throw err;
      }
    });
  }
}
