import { BrowserWindow, globalShortcut, screen, ipcMain, shell, dialog, app, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import {
  searchRecords, getSearchResultById, getLineItemsByRecord, getFieldOverrides, getFieldOverridesByLineItemId,
  upsertFieldOverride, resolveConflictKeep, resolveConflictAccept,
  resolveAllConflictsForRecord, updateFtsIndex, getFtsIndexData,
  listRecentFolders, listTopFolders,
  getAggregates, gatherJEExportData,
  getErrorLogsWithPath, getProcessedFilesWithStats,
  updateJeStatus, getJeQueueItems, getJeErrorItems,
  getSessionLogForFile, getRecordIdsByFilters,
} from '../core/db/records';
import { getDatabase } from '../core/db/database';
import { getFilesByStatuses, getFileStatusesByPaths, getFolderStatuses, getFileByPath } from '../core/db/files';
import { getDuplicateSourcesForRecord } from '../core/db/dedup';
import { listPresets, savePreset, deletePreset } from '../core/db/presets';
import {
  getJournalEntriesByRecord, insertJournalEntry, updateJournalEntry,
  deleteJournalEntry as dbDeleteJE, findExistingEntry,
} from '../core/db/journal-entries';
import { readInstructions, writeInstructions, getInstructionsPath } from '../core/je-instructions';
import { readInstruction } from '../core/instruction-manager';
import { INVOICEVAULT_DIR, INSTRUCTIONS_SUBDIR, EXTRACTION_PROMPT_FILE, CONFIG_FILE, DEFAULT_AMOUNT_TOLERANCE } from '../shared/constants';
import { BankStatementData, FieldOverrideInfo, FieldOverrideInput, InvoiceData, InvoiceLineItem, JournalEntryInput, LineItemFieldInput, SearchFilters, FileStatus } from '../shared/types';
import { loadAppConfig, saveAppConfig } from '../core/app-config';
import { clearVaultData, backupVault, getVaultConfig, updateVaultConfig } from '../core/vault';
import {
  loadWindowState, saveWindowState, saveWindowStateSync, sanitizeUIState,
  getVaultStatePath,
  WindowState, PersistedWindowGeometry, PersistedSpawnedWindow,
} from '../core/window-state';
import { eventBus } from '../core/event-bus';
import { VaultPathCache } from '../core/vault-path-cache';
import { t } from '../lib/i18n';
import { exportJEToXlsx } from '../core/export';
import { log, LogModule } from '../core/logger';

export interface OverlayCallbacks {
  onInitVault: (folderPath: string) => Promise<void>;
  onSwitchVault: (vaultPath: string) => Promise<void>;
  onStopVault: () => Promise<void>;
  onReprocessAll: () => number;
  onReprocessFile: (relativePath: string) => number;
  onReanalyzeFile: (relativePath: string, hint: string) => Promise<number>;
  onCheckFileHasResults: (relativePath: string) => boolean;
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
  private persistedState: WindowState | null = null;
  private overlayGeometry: PersistedWindowGeometry | null = null;
  private overlayGeometryDebounce: ReturnType<typeof setTimeout> | null = null;
  private spawnedWindowStates: Map<number, PersistedSpawnedWindow> = new Map();
  private spawnedGeometryDebounces: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private isQuitting = false;
  private isClosingAllWindows = false;
  private lastShortcutFocusTime = 0;

  setCallbacks(callbacks: OverlayCallbacks): void {
    this.callbacks = callbacks;
  }

  setPathCache(cache: VaultPathCache): void {
    this.pathCache = cache;
  }

  notifyFileStatusChanged(fileIds: string[], status: FileStatus): void {
    this.broadcastToAll('file-status-changed', { fileIds, status });
  }

  private get currentStatePath(): string | null {
    return this.vaultPath ? getVaultStatePath(this.vaultPath) : null;
  }

  private async getAmountTolerance(): Promise<number> {
    if (!this.vaultPath) return DEFAULT_AMOUNT_TOLERANCE;
    try {
      const config = await getVaultConfig(path.join(this.vaultPath, INVOICEVAULT_DIR));
      return config.amountTolerance ?? DEFAULT_AMOUNT_TOLERANCE;
    } catch {
      return DEFAULT_AMOUNT_TOLERANCE;
    }
  }

  async loadPersistedState(vaultRoot: string): Promise<void> {
    const statePath = getVaultStatePath(vaultRoot);
    this.persistedState = await loadWindowState(statePath);
    this.overlayGeometry = this.persistedState.overlayGeometry;
  }

  registerShortcut(): void {
    const accelerator = process.platform === 'darwin' ? 'Cmd+Shift+I' : 'Ctrl+Shift+I';
    const registered = globalShortcut.register(accelerator, () => {
      this.toggle();
    });
    if (!registered) {
      log.warn(LogModule.Overlay, 'Failed to register shortcut — it may be in use by another app');
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
    } else if (this.hasSpawnedWindows() && Date.now() - this.lastShortcutFocusTime > 10_000) {
      this.focusLastSpawnedWindow();
      this.lastShortcutFocusTime = Date.now();
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

  hasSpawnedWindows(): boolean {
    return this.spawnedWindows.size > 0;
  }

  focusLastSpawnedWindow(): void {
    const win = [...this.spawnedWindows].at(-1);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  }

  async closeAllSpawnedWindows(): Promise<void> {
    const openWins = Array.from(this.spawnedWindows).filter(win => !win.isDestroyed());
    // Set flag so the closed event handler doesn't overwrite the state that
    // beforeunload sync IPC is about to write.
    this.isClosingAllWindows = true;
    // Await each window's closed event so beforeunload (and the sync IPC) fires first.
    // Do NOT clear spawnedWindows before this — the isKnown check in the sync IPC handler
    // depends on windows still being in the set when beforeunload fires.
    const closePromises = openWins.map(win => new Promise<void>(resolve => {
      win.once('closed', () => resolve());
      win.close();
    }));
    await Promise.all(closePromises);
    this.isClosingAllWindows = false;
    // In-memory cleanup only — beforeunload sync IPC already wrote correct state to disk
    this.spawnedWindows.clear();
    this.initialStateMap.clear();
    this.spawnedWindowStates.clear();
  }

  async restoreSpawnedWindows(): Promise<void> {
    if (!this.persistedState || this.persistedState.spawnedWindows.length === 0) return;
    for (const persisted of this.persistedState.spawnedWindows) {
      const { geometry, uiState } = persisted;
      this.spawnWindowlized(JSON.stringify(uiState), geometry, true);
    }
  }

  async flushStateBeforeQuit(): Promise<void> {
    this.isQuitting = true;
    // Cancel pending geometry debounces and capture final geometry synchronously
    if (this.overlayGeometryDebounce) {
      clearTimeout(this.overlayGeometryDebounce);
      this.overlayGeometryDebounce = null;
    }
    for (const [id, debounce] of this.spawnedGeometryDebounces) {
      clearTimeout(debounce);
      this.spawnedGeometryDebounces.delete(id);
    }

    // Capture overlay geometry
    if (this.window && !this.window.isDestroyed()) {
      const [x, y] = this.window.getPosition();
      const [width, height] = this.window.getSize();
      this.overlayGeometry = { x, y, width, height };
    }

    // Close spawned windows gracefully so beforeunload fires in the renderer,
    // which triggers save-spawned-window-ui-state-sync and populates spawnedWindowStates.
    // We must call this BEFORE stopIpcBridge so the sync IPC can still be handled.
    const openWins = Array.from(this.spawnedWindows).filter(win => !win.isDestroyed());
    const closePromises = openWins.map(win => new Promise<void>(resolve => {
      win.once('closed', () => resolve());
      win.close();
    }));
    await Promise.all(closePromises);

    if (this.currentStatePath) {
      saveWindowStateSync(this.currentStatePath, {
        overlayGeometry: this.overlayGeometry,
        spawnedWindows: Array.from(this.spawnedWindowStates.values()),
      });
    }
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
    const geo = this.overlayGeometry;
    this.window = new BrowserWindow({
      width: geo?.width ?? OVERLAY_WIDTH,
      height: geo?.height ?? OVERLAY_MAX_HEIGHT,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      minWidth: 600,
      minHeight: 400,
      show: false,
      hasShadow: false,
      webPreferences: {
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    const flushOverlayGeo = () => {
      if (this.overlayGeometryDebounce) clearTimeout(this.overlayGeometryDebounce);
      this.overlayGeometryDebounce = setTimeout(() => {
        if (!this.window || this.window.isDestroyed()) return;
        const [x, y] = this.window.getPosition();
        const [width, height] = this.window.getSize();
        this.overlayGeometry = { x, y, width, height };
        if (this.currentStatePath) saveWindowState(this.currentStatePath, { overlayGeometry: this.overlayGeometry }).catch(err => log.error(LogModule.Overlay, 'Failed to save overlay geometry', err));
      }, 500);
    };
    this.window.on('move', flushOverlayGeo);
    this.window.on('resize', flushOverlayGeo);

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
    if (this.overlayGeometry && this.isPositionOnScreen(this.overlayGeometry.x, this.overlayGeometry.y)) {
      const { x, y, width, height } = this.overlayGeometry;
      this.window.setBounds({ x, y, width, height });
      return;
    }
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.round((width - OVERLAY_WIDTH) / 2);
    const y = Math.round(height * 0.2); // 20% from top
    this.window.setPosition(x, y);
  }

  private isPositionOnScreen(x: number, y: number): boolean {
    return screen.getAllDisplays().some(d =>
      x >= d.bounds.x && y >= d.bounds.y &&
      x < d.bounds.x + d.bounds.width && y < d.bounds.y + d.bounds.height
    );
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

  private spawnWindowlized(serializedState?: string, sourceBounds?: Electron.Rectangle, useExactBounds?: boolean): void {
    const width = sourceBounds?.width ?? 800;
    const height = sourceBounds?.height ?? 600;
    const x = sourceBounds ? (useExactBounds ? sourceBounds.x : sourceBounds.x + 20) : undefined;
    const y = sourceBounds ? (useExactBounds ? sourceBounds.y : sourceBounds.y + 20) : undefined;
    const win = new BrowserWindow({
      width,
      height,
      x,
      y,
      minWidth: 500,
      minHeight: 400,
      frame: true,
      titleBarStyle: 'default',
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

    const url = MAIN_WINDOW_WEBPACK_ENTRY + '?windowlized=true&nativeFrame=true';
    win.loadURL(url);

    if (serializedState) {
      this.initialStateMap.set(win.webContents.id, serializedState);
      // Seed spawnedWindowStates immediately so the entry exists even before the
      // renderer's debounced save fires. Uses the same state the renderer will restore.
      try {
        const uiState = sanitizeUIState(JSON.parse(serializedState));
        const gx = x ?? Math.round(win.getPosition()[0]);
        const gy = y ?? Math.round(win.getPosition()[1]);
        this.spawnedWindowStates.set(win.id, {
          geometry: { x: gx, y: gy, width, height },
          uiState,
        });
        this.flushAllSpawnedWindowStates().catch(err => log.error(LogModule.Overlay, 'Failed to flush spawned window states', err));
      } catch (err) {
        log.error(LogModule.Overlay, 'spawnWindowlized: failed to seed state', err);
      }
    }

    const flushSpawnedGeo = () => {
      const debounce = this.spawnedGeometryDebounces.get(win.id);
      if (debounce) clearTimeout(debounce);
      this.spawnedGeometryDebounces.set(win.id, setTimeout(() => {
        if (win.isDestroyed()) return;
        const [wx, wy] = win.getPosition();
        const [ww, wh] = win.getSize();
        const existing = this.spawnedWindowStates.get(win.id);
        const uiState = existing?.uiState ?? sanitizeUIState({});
        this.spawnedWindowStates.set(win.id, { geometry: { x: wx, y: wy, width: ww, height: wh }, uiState });
        this.flushAllSpawnedWindowStates().catch(err => log.error(LogModule.Overlay, 'Failed to flush spawned window states', err));
      }, 500));
    };
    win.on('move', flushSpawnedGeo);
    win.on('resize', flushSpawnedGeo);

    const wcId = win.webContents.id;
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      this.spawnedWindows.delete(win);
      this.initialStateMap.delete(wcId);
      const debounce = this.spawnedGeometryDebounces.get(win.id);
      if (debounce) clearTimeout(debounce);
      this.spawnedGeometryDebounces.delete(win.id);
      // During quit or bulk-close, beforeunload sync IPC has already written correct state —
      // don't overwrite it by flushing a partially-closed window list.
      if (!this.isQuitting && !this.isClosingAllWindows) {
        this.spawnedWindowStates.delete(win.id);
        this.flushAllSpawnedWindowStates().catch(err => log.error(LogModule.Overlay, 'Failed to flush spawned window states', err));
      }
    });

    this.spawnedWindows.add(win);
  }

  private async flushAllSpawnedWindowStates(): Promise<void> {
    if (!this.currentStatePath) return;
    await saveWindowState(this.currentStatePath, { spawnedWindows: Array.from(this.spawnedWindowStates.values()) });
  }

  subscribeToStatusEvents(): void {
    const sendFileStatus = (fileIds: string[], status: FileStatus) => {
      this.broadcastToAll('file-status-changed', { fileIds, status });
    };
    eventBus.on('extraction:started', (data) => {
      sendFileStatus(data.fileIds, FileStatus.Processing);
    });
    eventBus.on('extraction:completed', (data) => {
      sendFileStatus([data.fileId], FileStatus.Done);
    });
    eventBus.on('extraction:error', (data) => {
      sendFileStatus([data.fileId], FileStatus.Error);
    });
    eventBus.on('review:needed', (data) => {
      sendFileStatus([data.fileId], FileStatus.Review);
    });
    eventBus.on('file:added', (data) => {
      const file = getFileByPath(data.relativePath);
      if (file) sendFileStatus([file.id], file.status);
    });
    eventBus.on('file:changed', (data) => {
      const file = getFileByPath(data.relativePath);
      if (file) sendFileStatus([file.id], file.status);
    });
    eventBus.on('je:status-changed', (data) => {
      this.broadcastToAll('je-status-changed', data);
    });
    eventBus.on('file:deleted', (data) => {
      this.broadcastToAll('file-deleted', data);
    });
  }

  registerIpcHandlers(): void {
    ipcMain.handle('search', async (_event, query: string, offset: number = 0, folder: string | null = null, filePath: string | null = null) => {
      try {
        const tolerance = await this.getAmountTolerance();
        return searchRecords((query || '').trim(), 50, offset, folder, filePath, tolerance);
      } catch (err) {
        log.error(LogModule.Overlay, 'Query failed', err);
        return [];
      }
    });

    ipcMain.handle('get-search-result', async (_event, recordId: string) => {
      try {
        return getSearchResultById(recordId);
      } catch (err) {
        log.error(LogModule.Overlay, 'Get search result failed', err);
        return null;
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
        log.error(LogModule.Overlay, 'Get line items failed', err);
        return [];
      }
    });

    ipcMain.handle('save-field-override', async (_event, input: FieldOverrideInput) => {
      try {
        const db = getDatabase();
        const previousFtsData = getFtsIndexData(input.recordId);
        // Get the current AI value for this field
        const row = db.prepare(`SELECT * FROM ${input.tableName} WHERE record_id = ?`).get(input.recordId) as Record<string, unknown> | undefined;
        const currentAiValue = row ? String(row[input.fieldName] ?? '') : '';

        // Update the field value in the extension table
        db.prepare(`UPDATE ${input.tableName} SET ${input.fieldName} = ? WHERE record_id = ?`)
          .run(input.userValue, input.recordId);

        // Create/update the field override
        upsertFieldOverride(input.recordId, input.tableName, input.fieldName, input.userValue, currentAiValue);

        // Update FTS index if applicable
        const ftsFields = ['invoice_code', 'invoice_number', 'tax_id', 'counterparty_name', 'counterparty_address', 'description', 'bank_name', 'account_number'];
        if (ftsFields.includes(input.fieldName)) {
          const invoiceData = db.prepare('SELECT * FROM invoice_data WHERE record_id = ?').get(input.recordId) as InvoiceData | undefined;
          const bankData = db.prepare('SELECT * FROM bank_statement_data WHERE record_id = ?').get(input.recordId) as BankStatementData | undefined;
          updateFtsIndex(input.recordId, {
            invoice_code: invoiceData?.invoice_code ?? bankData?.invoice_code ?? undefined,
            invoice_number: invoiceData?.invoice_number ?? bankData?.invoice_number ?? undefined,
            tax_id: invoiceData?.tax_id ?? undefined,
            counterparty_name: invoiceData?.counterparty_name ?? bankData?.counterparty_name ?? undefined,
            counterparty_address: invoiceData?.counterparty_address ?? undefined,
            description: bankData?.description ?? undefined,
            bank_name: bankData?.bank_name ?? undefined,
            account_number: bankData?.account_number ?? undefined,
          }, previousFtsData);
        }
      } catch (err) {
        log.error(LogModule.Overlay, 'Save field override failed', err);
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
        log.error(LogModule.Overlay, 'Get field overrides failed', err);
        return [];
      }
    });

    ipcMain.handle('get-duplicate-sources', async (_event, recordId: string) => {
      try {
        return getDuplicateSourcesForRecord(recordId);
      } catch (err) {
        log.error(LogModule.Overlay, 'Get duplicate sources failed', err);
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
        log.error(LogModule.Overlay, 'Resolve conflict failed', err);
        throw err;
      }
    });

    ipcMain.handle('resolve-all-conflicts', async (_event, recordId: string, action: string) => {
      try {
        resolveAllConflictsForRecord(recordId, action as 'keep' | 'accept');
      } catch (err) {
        log.error(LogModule.Overlay, 'Resolve all conflicts failed', err);
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
        const numericFields = ['unit_price', 'quantity', 'subtotal', 'total_with_tax'];
        let value: string | number | null;
        if (input.fieldName === 'tax_rate') {
          if (input.userValue === '') { value = null; }
          else { const n = parseFloat(input.userValue); value = isNaN(n) ? input.userValue : n; }
        } else if (numericFields.includes(input.fieldName)) {
          value = input.userValue === '' ? null : parseFloat(input.userValue);
        } else {
          value = input.userValue;
        }
        db.prepare(`UPDATE invoice_line_items SET ${input.fieldName} = ? WHERE id = ?`)
          .run(value, input.lineItemId);

        // Create/update the field override (use the line item's record_id for FK, and lineItemId to identify which line item)
        upsertFieldOverride(row.record_id, 'invoice_line_items', input.fieldName, input.userValue, currentAiValue, input.lineItemId);
      } catch (err) {
        log.error(LogModule.Overlay, 'Save line item field failed', err);
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
        log.error(LogModule.Overlay, 'Get line item overrides failed', err);
        return {};
      }
    });

    // === Spotlight UX IPC Handlers ===

    ipcMain.handle('get-app-config', async () => {
      return await loadAppConfig();
    });

    ipcMain.handle('get-vault-config', async () => {
      if (!this.vaultPath) return null;
      return await getVaultConfig(path.join(this.vaultPath, INVOICEVAULT_DIR));
    });

    ipcMain.handle('update-vault-config', async (_event, updates: Record<string, unknown>) => {
      if (!this.vaultPath) return;
      await updateVaultConfig(path.join(this.vaultPath, INVOICEVAULT_DIR), updates);
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
        log.error(LogModule.Overlay, 'init-vault failed', err);
        return { success: false, error: (err as Error).message };
      }
    });

    ipcMain.handle('switch-vault', async (_event, vaultPath: string) => {
      try {
        if (!this.callbacks) throw new Error('Overlay callbacks not set');
        await this.closeAllSpawnedWindows();
        await this.callbacks.onSwitchVault(vaultPath);
        return { success: true };
      } catch (err) {
        log.error(LogModule.Overlay, 'switch-vault failed', err);
        return { success: false };
      }
    });

    ipcMain.handle('remove-vault', async (_event, vaultPath: string) => {
      const config = await loadAppConfig();
      const vaultPaths = (config.vaultPaths || []).filter(p => p !== vaultPath);
      const isActive = config.lastVaultPath === vaultPath;

      if (isActive) {
        await this.closeAllSpawnedWindows();
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

    ipcMain.handle('backup-vault', async (_event, vaultPath: string) => {
      this.suppressBlur = true;
      try {
        const { canceled, filePath: destPath } = await dialog.showSaveDialog(this.window!, {
          title: t('backup_vault', 'Backup Vault'),
          defaultPath: 'invoicevault.backup.zip',
          filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        });
        if (canceled || !destPath) return { success: false, canceled: true };
        await backupVault(vaultPath, destPath);
        return { success: true, filePath: destPath };
      } catch (err) {
        log.error(LogModule.Overlay, 'backup-vault failed', err);
        return { success: false, error: (err as Error).message };
      } finally {
        this.suppressBlur = false;
      }
    });

    ipcMain.handle('clear-vault-data', async (_event, vaultPath: string) => {
      log.info(LogModule.Overlay, 'clear-vault-data IPC received for: ' + vaultPath);
      const config = await loadAppConfig();
      const isActive = config.lastVaultPath === vaultPath;
      log.info(LogModule.Overlay, `isActive: ${isActive} | lastVaultPath: ${config.lastVaultPath}`);

      // Stop the vault if it's active
      if (isActive) {
        await this.closeAllSpawnedWindows();
        if (this.callbacks) await this.callbacks.onStopVault();
      }

      // Auto-backup before clearing
      try {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const stamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
        const backupPath = path.join(vaultPath, `invoicevault.backup.${stamp}.zip`);
        log.info(LogModule.Overlay, 'Starting auto-backup to: ' + backupPath);
        await backupVault(vaultPath, backupPath);
        log.info(LogModule.Overlay, 'Auto-backup saved to ' + backupPath);
      } catch (err) {
        log.error(LogModule.Overlay, 'Auto-backup before clear failed', err);
      }

      // Delete the .invoicevault directory
      log.info(LogModule.Overlay, 'Deleting .invoicevault at: ' + vaultPath);
      await clearVaultData(vaultPath);
      log.info(LogModule.Overlay, '.invoicevault deleted');

      // Remove from config
      const vaultPaths = (config.vaultPaths || []).filter(p => p !== vaultPath);
      await saveAppConfig({
        vaultPaths,
        lastVaultPath: isActive ? (vaultPaths[0] || null) : config.lastVaultPath,
      });
      log.info(LogModule.Overlay, 'Config updated, remaining vaults:', vaultPaths);

      // Switch to next vault if available
      if (isActive && vaultPaths.length > 0 && this.callbacks) {
        log.info(LogModule.Overlay, 'Switching to next vault: ' + vaultPaths[0]);
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

    ipcMain.handle('get-app-version', () => {
      return app.getVersion();
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

    ipcMain.handle('reanalyze-file', async (_event, relativePath: string, hint: string) => {
      if (!this.callbacks) return { count: 0 };
      const count = await this.callbacks.onReanalyzeFile(relativePath, hint);
      return { count };
    });

    ipcMain.handle('check-file-has-results', async (_event, relativePath: string) => {
      if (!this.callbacks) return false;
      return this.callbacks.onCheckFileHasResults(relativePath);
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
        log.error(LogModule.Overlay, 'list-recent-folders failed', err);
        return [];
      }
    });

    ipcMain.handle('list-top-folders', async () => {
      try {
        return listTopFolders();
      } catch (err) {
        log.error(LogModule.Overlay, 'list-top-folders failed', err);
        return [];
      }
    });

    ipcMain.handle('hide-overlay', async () => {
      this.hide();
    });

    ipcMain.handle('windowlize', async (event, serializedState?: string) => {
      const sourceWin = BrowserWindow.fromWebContents(event.sender);
      const bounds = sourceWin?.getBounds();
      this.spawnWindowlized(serializedState, bounds);
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
        log.error(LogModule.Overlay, 'get-aggregates failed', err);
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
        log.error(LogModule.Overlay, 'get-files-by-statuses failed', err);
        return [];
      }
    });

    ipcMain.handle('get-error-logs-with-path', async () => {
      try {
        return getErrorLogsWithPath();
      } catch (err) {
        log.error(LogModule.Overlay, 'get-error-logs-with-path failed', err);
        return [];
      }
    });

    ipcMain.handle('get-session-log-for-file', async (_event, fileId: string) => {
      try {
        return getSessionLogForFile(fileId);
      } catch (err) {
        log.error(LogModule.Overlay, 'get-session-log-for-file failed', err);
        return null;
      }
    });

    ipcMain.handle('read-cli-session-log', async (_event, sessionLogPath: string) => {
      try {
        if (!sessionLogPath.includes('/.claude/projects/')) return null;
        return await fs.promises.readFile(sessionLogPath, 'utf-8').catch(() => null);
      } catch (err) {
        log.error(LogModule.Overlay, 'read-cli-session-log failed', err);
        return null;
      }
    });

    ipcMain.handle('get-processed-files-with-stats', async () => {
      try {
        return getProcessedFilesWithStats();
      } catch (err) {
        log.error(LogModule.Overlay, 'get-processed-files-with-stats failed', err);
        return [];
      }
    });

    ipcMain.handle('get-file-statuses-by-paths', async (_event, paths: string[]) => {
      try {
        return getFileStatusesByPaths(paths);
      } catch (err) {
        log.error(LogModule.Overlay, 'get-file-statuses-by-paths failed', err);
        return {};
      }
    });

    ipcMain.handle('get-folder-statuses', async () => {
      try {
        return getFolderStatuses();
      } catch (err) {
        log.error(LogModule.Overlay, 'get-folder-statuses failed', err);
        return {};
      }
    });

    ipcMain.handle('list-presets', async () => {
      try {
        const rows = listPresets();
        return rows.map(r => ({ id: r.id, name: r.name, filtersJson: r.filters_json, createdAt: r.created_at }));
      } catch (err) {
        log.error(LogModule.Overlay, 'list-presets failed', err);
        return [];
      }
    });

    ipcMain.handle('save-preset', async (_event, name: string, filtersJson: string) => {
      try {
        const row = savePreset(name, filtersJson);
        return { id: row.id, name: row.name, filtersJson: row.filters_json, createdAt: row.created_at };
      } catch (err) {
        log.error(LogModule.Overlay, 'save-preset failed', err);
        throw err;
      }
    });

    ipcMain.handle('delete-preset', async (_event, id: string) => {
      try {
        deletePreset(id);
      } catch (err) {
        log.error(LogModule.Overlay, 'delete-preset failed', err);
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

        const rows = gatherJEExportData(filters);
        const buffer = exportJEToXlsx(rows);
        await fs.promises.writeFile(result.filePath, buffer);
        return { filePath: result.filePath };
      } catch (err) {
        log.error(LogModule.Overlay, 'export-filtered failed', err);
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
        log.error(LogModule.Overlay, 'Get journal entries failed', err);
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
        log.error(LogModule.Overlay, 'Save journal entry failed', err);
        throw err;
      }
    });

    ipcMain.handle('delete-journal-entry', async (_event, id: string) => {
      try {
        dbDeleteJE(id);
      } catch (err) {
        log.error(LogModule.Overlay, 'Delete journal entry failed', err);
        throw err;
      }
    });

    ipcMain.handle('regenerate-je-record', async (_event, recordId: string) => {
      try {
        if (!this.callbacks) return;
        updateJeStatus([recordId], 'pending');
        eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'pending' });
        // Fire and forget — status updates come via events
        this.callbacks.onGenerateJE(recordId).catch((err: Error) => {
          log.error(LogModule.Overlay, 'Regenerate JE failed', err);
        });
      } catch (err) {
        log.error(LogModule.Overlay, 'Regenerate JE record failed', err);
      }
    });

    ipcMain.handle('regenerate-je-record-ai-only', async (_event, recordId: string) => {
      try {
        if (!this.callbacks) return;
        updateJeStatus([recordId], 'pending');
        eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'pending' });
        // Fire and forget — status updates come via events
        this.callbacks.onGenerateJEAIOnly(recordId).catch((err: Error) => {
          log.error(LogModule.Overlay, 'Regenerate JE AI-only failed', err);
        });
      } catch (err) {
        log.error(LogModule.Overlay, 'Regenerate JE AI-only record failed', err);
      }
    });

    ipcMain.handle('regenerate-je-filtered', async (_event, filters: SearchFilters, aiOnly: boolean) => {
      try {
        if (!this.callbacks) return { count: 0 };
        const recordIds = getRecordIdsByFilters(filters);
        if (recordIds.length === 0) return { count: 0 };
        updateJeStatus(recordIds, 'pending');
        eventBus.emit('je:status-changed', { recordIds, status: 'pending' });
        this.callbacks.onGenerateJEForFilters(filters, aiOnly).catch((err: Error) => {
          log.error(LogModule.Overlay, 'Regenerate JE filtered failed', err);
        });
        return { count: recordIds.length };
      } catch (err) {
        log.error(LogModule.Overlay, 'Regenerate JE filtered handler failed', err);
        return { count: 0 };
      }
    });

    ipcMain.handle('get-je-queue-items', async () => {
      try {
        return getJeQueueItems();
      } catch (err) {
        log.error(LogModule.Overlay, 'Get JE queue items failed', err);
        return [];
      }
    });

    ipcMain.handle('get-je-error-items', async () => {
      try {
        return getJeErrorItems();
      } catch (err) {
        log.error(LogModule.Overlay, 'Get JE error items failed', err);
        return [];
      }
    });

    ipcMain.handle('get-je-instructions', async () => {
      try {
        const root = this.callbacks?.getVaultRoot();
        if (!root) return '';
        return await readInstructions(root);
      } catch (err) {
        log.error(LogModule.Overlay, 'Get instructions failed', err);
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
        log.error(LogModule.Overlay, 'Save instructions failed', err);
        throw err;
      }
    });

    ipcMain.handle('get-extraction-prompt', async () => {
      try {
        const root = this.callbacks?.getVaultRoot();
        if (!root) return '';
        const p = path.join(root, INVOICEVAULT_DIR, INSTRUCTIONS_SUBDIR, EXTRACTION_PROMPT_FILE);
        return await readInstruction(p);
      } catch (err) {
        log.error(LogModule.Overlay, 'Get extraction prompt failed', err);
        return '';
      }
    });

    ipcMain.handle('export-instructions', async () => {
      try {
        const root = this.callbacks?.getVaultRoot();
        if (!root) return { success: false };

        const { canceled, filePath: destPath } = await dialog.showSaveDialog({
          title: 'Export Instructions',
          defaultPath: 'instructions.zip',
          filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        });
        if (canceled || !destPath) return { success: false, canceled: true };

        const instructionsDir = path.join(root, INVOICEVAULT_DIR, INSTRUCTIONS_SUBDIR);

        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(destPath);
          const archive = archiver('zip', { zlib: { level: 9 } });
          output.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(output);
          archive.file(path.join(instructionsDir, EXTRACTION_PROMPT_FILE), { name: EXTRACTION_PROMPT_FILE });
          archive.file(getInstructionsPath(root), { name: 'je-instructions.md' });
          archive.finalize();
        });

        return { success: true };
      } catch (err) {
        log.error(LogModule.Overlay, 'Export instructions failed', err);
        return { success: false, error: (err as Error).message };
      }
    });

    ipcMain.handle('open-instruction-file', async (_event, file: 'extraction-prompt' | 'je-instructions' | 'config') => {
      try {
        const root = this.callbacks?.getVaultRoot();
        if (!root) return;
        let filePath: string;
        if (file === 'extraction-prompt') {
          filePath = path.join(root, INVOICEVAULT_DIR, INSTRUCTIONS_SUBDIR, EXTRACTION_PROMPT_FILE);
        } else if (file === 'config') {
          filePath = path.join(root, INVOICEVAULT_DIR, CONFIG_FILE);
        } else {
          filePath = getInstructionsPath(root);
        }
        await shell.openPath(filePath);
      } catch (err) {
        log.error(LogModule.Overlay, 'Open instruction file failed', err);
      }
    });

    // === Window State Persistence ===

    ipcMain.handle('get-overlay-ui-state', () => {
      return this.persistedState?.overlayUIState ?? null;
    });

    ipcMain.handle('save-overlay-ui-state', async (_event, raw: unknown) => {
      const uiState = sanitizeUIState(raw as Parameters<typeof sanitizeUIState>[0]);
      if (this.currentStatePath) await saveWindowState(this.currentStatePath, { overlayUIState: uiState });
      if (this.persistedState) this.persistedState.overlayUIState = uiState;
    });

    ipcMain.handle('save-spawned-window-ui-state', async (event, raw: unknown) => {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (!senderWin || !this.spawnedWindows.has(senderWin)) return;
      const uiState = sanitizeUIState(raw as Parameters<typeof sanitizeUIState>[0]);
      const [x, y] = senderWin.getPosition();
      const [width, height] = senderWin.getSize();
      this.spawnedWindowStates.set(senderWin.id, { geometry: { x, y, width, height }, uiState });
      await this.flushAllSpawnedWindowStates();
    });

    ipcMain.on('save-spawned-window-ui-state-sync', (event, raw: unknown) => {
      event.returnValue = null;
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (!senderWin || !this.spawnedWindows.has(senderWin)) return;
      const uiState = sanitizeUIState(raw as Parameters<typeof sanitizeUIState>[0]);
      const [x, y] = senderWin.getPosition();
      const [width, height] = senderWin.getSize();
      this.spawnedWindowStates.set(senderWin.id, { geometry: { x, y, width, height }, uiState });
      if (this.currentStatePath) saveWindowStateSync(this.currentStatePath, { spawnedWindows: Array.from(this.spawnedWindowStates.values()) });
    });
  }
}
