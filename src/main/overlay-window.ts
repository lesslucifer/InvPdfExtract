import { BrowserWindow, globalShortcut, screen, ipcMain, shell } from 'electron';
import * as path from 'path';
import {
  searchRecords, getLineItemsByRecord, getFieldOverrides,
  upsertFieldOverride, resolveConflictKeep, resolveConflictAccept,
  resolveAllConflictsForRecord, updateFtsIndex,
} from '../core/db/records';
import { getDatabase } from '../core/db/database';
import { FieldOverrideInput } from '../shared/types';

const OVERLAY_WIDTH = 700;
const OVERLAY_MAX_HEIGHT = 500;

export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private vaultPath: string | null = null;

  registerShortcut(): void {
    const accelerator = process.platform === 'darwin' ? 'Cmd+Shift+I' : 'Ctrl+Shift+I';
    globalShortcut.register(accelerator, () => {
      this.toggle();
    });
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
    this.window!.show();
    this.window!.focus();
  }

  hide(): void {
    if (this.window) {
      this.window.hide();
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
      webPreferences: {
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    this.window.on('blur', () => {
      this.hide();
    });
  }

  private positionWindow(): void {
    if (!this.window) return;
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.round((width - OVERLAY_WIDTH) / 2);
    const y = Math.round(height * 0.2); // 20% from top
    this.window.setPosition(x, y);
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
  }
}
