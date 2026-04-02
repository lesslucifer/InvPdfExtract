import { BrowserWindow, globalShortcut, screen, ipcMain, shell } from 'electron';
import * as path from 'path';
import { searchRecords, getLineItemsByRecord } from '../core/db/records';

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
  }
}
