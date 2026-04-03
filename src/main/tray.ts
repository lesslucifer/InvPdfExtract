import { Tray, Menu, nativeImage, shell, app, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { TrayState } from '../shared/types';
import { eventBus } from '../core/event-bus';
import { gatherExportData, exportToCsv } from '../core/export';
import { loadAppConfig, saveAppConfig } from '../core/app-config';

export class TrayManager {
  private tray: Tray | null = null;
  private state: TrayState = TrayState.Idle;
  private vaultPath: string | null = null;
  private icons: Map<TrayState, Electron.NativeImage> = new Map();
  private onInitVault: (() => void) | null = null;
  private onProcessNow: (() => void) | null = null;
  private onReprocessAll: (() => void) | null = null;
  private onSwitchVault: ((vaultPath: string) => void) | null = null;
  private onSearchOverlay: (() => void) | null = null;
  private onQuit: (() => void) | null = null;
  private activityWindow: BrowserWindow | null = null;

  constructor(opts: {
    onInitVault: () => void;
    onProcessNow: () => void;
    onReprocessAll?: () => void;
    onSwitchVault?: (vaultPath: string) => void;
    onSearchOverlay?: () => void;
    onQuit: () => void;
  }) {
    this.onInitVault = opts.onInitVault;
    this.onProcessNow = opts.onProcessNow;
    this.onReprocessAll = opts.onReprocessAll ?? null;
    this.onSwitchVault = opts.onSwitchVault ?? null;
    this.onSearchOverlay = opts.onSearchOverlay ?? null;
    this.onQuit = opts.onQuit;
  }

  init(): void {
    this.loadIcons();

    const icon = this.icons.get(TrayState.Idle)!;
    this.tray = new Tray(icon);
    this.tray.setToolTip('InvoiceVault');
    // Set a title as fallback — visible on macOS even if the icon has issues
    this.tray.setTitle('IV');
    this.updateMenu();

    // On macOS, also respond to click (left-click) to show the context menu
    this.tray.on('click', () => {
      this.tray?.popUpContextMenu();
    });

    this.subscribeToEvents();
  }

  setVaultPath(vaultPath: string | null): void {
    this.vaultPath = vaultPath;
    this.updateMenu();
  }

  setState(state: TrayState): void {
    console.log("SET_STATE_TRAY", state)
    this.state = state;
    const icon = this.icons.get(state);
    if (icon && this.tray) {
      this.tray.setImage(icon);
    }

    const tooltips: Record<TrayState, string> = {
      [TrayState.Idle]: 'InvoiceVault — Idle',
      [TrayState.Processing]: 'InvoiceVault — Processing...',
      [TrayState.Review]: 'InvoiceVault — Items need review',
      [TrayState.Error]: 'InvoiceVault — Error',
    };
    this.tray?.setToolTip(tooltips[state]);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private loadIcons(): void {
    // In dev: resources/ is at project root; in packaged: extraResource copies to Resources/
    // Note: webpack mocks __dirname to '/' so we use app.getAppPath() instead
    const iconDir = app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(app.getAppPath(), 'resources');
    const states: [TrayState, string][] = [
      [TrayState.Idle, 'tray-idle.png'],
      [TrayState.Processing, 'tray-processing.png'],
      [TrayState.Review, 'tray-review.png'],
      [TrayState.Error, 'tray-error.png'],
    ];

    for (const [state, filename] of states) {
      const imgPath = path.join(iconDir, filename);
      try {
        const img = nativeImage.createFromPath(imgPath);
        if (img.isEmpty()) {
          console.warn(`[Tray] Icon loaded but empty: ${imgPath}`);
          this.icons.set(state, nativeImage.createEmpty());
          continue;
        }
        // macOS menu bar icons should be 18x18 or 22x22
        const resized = img.resize({ width: 18, height: 18 });
        this.icons.set(state, resized);
      } catch (err) {
        console.warn(`[Tray] Failed to load icon: ${imgPath}`, err);
        this.icons.set(state, nativeImage.createEmpty());
      }
    }
  }

  private updateMenu(): void {
    if (!this.tray) return;

    const hasVault = !!this.vaultPath;
    const config = loadAppConfig();

    // Build vault switch submenu
    const vaultSubmenu: Electron.MenuItemConstructorOptions[] = config.vaultPaths.map(vp => ({
      label: path.basename(vp),
      type: 'radio' as const,
      checked: vp === this.vaultPath,
      click: () => this.onSwitchVault?.(vp),
    }));

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Search...',
        accelerator: process.platform === 'darwin' ? 'Cmd+Shift+I' : 'Ctrl+Shift+I',
        click: () => this.onSearchOverlay?.(),
      },
      { type: 'separator' as const },
      {
        label: 'Initialize New Vault...',
        click: () => this.onInitVault?.(),
      },
      ...(vaultSubmenu.length > 1 ? [{
        label: 'Switch Vault',
        submenu: vaultSubmenu,
      }] : []),
      { type: 'separator' as const },
      {
        label: 'Open Vault Folder',
        enabled: hasVault,
        click: () => {
          if (this.vaultPath) shell.openPath(this.vaultPath);
        },
      },
      {
        label: 'Process Now',
        enabled: hasVault,
        click: () => this.onProcessNow?.(),
      },
      {
        label: 'Reprocess All Files',
        enabled: hasVault,
        click: () => this.onReprocessAll?.(),
      },
      { type: 'separator' as const },
      {
        label: 'Export to CSV...',
        enabled: hasVault,
        click: () => this.handleExportCsv(),
      },
      {
        label: 'View Recent Activity',
        enabled: hasVault,
        click: () => this.showActivityLog(),
      },
      { type: 'separator' as const },
      // {
      //   label: 'Auto-start on Login',
      //   type: 'checkbox' as const,
      //   checked: config.autoStart,
      //   click: (menuItem) => {
      //     const autoStart = menuItem.checked;
      //     saveAppConfig({ autoStart });
      //     app.setLoginItemSettings({ openAtLogin: autoStart });
      //   },
      // },
      { type: 'separator' as const },
      {
        label: `Vault: ${this.vaultPath ? path.basename(this.vaultPath) : 'None'}`,
        enabled: false,
      },
      {
        label: `Status: ${this.state}`,
        enabled: false,
      },
      { type: 'separator' as const },
      {
        label: 'Quit InvoiceVault',
        click: () => this.onQuit?.(),
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(menu);
  }

  private async handleExportCsv(): Promise<void> {
    const result = await dialog.showOpenDialog({
      title: 'Select folder to save CSV export',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return;

    try {
      const data = gatherExportData();
      const csvFiles = exportToCsv(data);

      for (const [filename, content] of csvFiles) {
        const filePath = path.join(result.filePaths[0], filename);
        fs.writeFileSync(filePath, '\ufeff' + content, 'utf-8'); // BOM for Excel UTF-8
      }

      shell.openPath(result.filePaths[0]);
    } catch (err) {
      dialog.showErrorBox('Export Failed', (err as Error).message);
    }
  }

  private showActivityLog(): void {
    if (this.activityWindow && !this.activityWindow.isDestroyed()) {
      this.activityWindow.focus();
      return;
    }

    this.activityWindow = new BrowserWindow({
      width: 600,
      height: 400,
      title: 'InvoiceVault — Activity Log',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Load a simple HTML page with recent logs
    const { getRecentLogs } = require('../core/db/records');
    const logs = getRecentLogs(100) as any[];
    const html = this.buildActivityLogHtml(logs);

    this.activityWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    this.activityWindow.on('closed', () => { this.activityWindow = null; });
  }

  private buildActivityLogHtml(logs: any[]): string {
    const rows = logs.map(log => {
      const levelColor = log.level === 'error' ? '#ff3b30' : log.level === 'warn' ? '#ff9f0a' : '#8e8e93';
      return `<tr>
        <td style="color:${levelColor};font-weight:600;text-transform:uppercase">${log.level}</td>
        <td style="color:#8e8e93;white-space:nowrap">${log.timestamp}</td>
        <td>${log.message}</td>
      </tr>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, sans-serif; font-size: 13px; margin: 16px; background: #1c1c1e; color: #f5f5f7; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 4px 8px; border-bottom: 1px solid #3a3a3c; vertical-align: top; }
        h2 { font-size: 16px; margin-bottom: 12px; }
        .empty { color: #8e8e93; text-align: center; padding: 40px; }
      </style>
    </head><body>
      <h2>Recent Activity</h2>
      ${logs.length === 0 ? '<div class="empty">No activity yet</div>' : `<table>${rows}</table>`}
    </body></html>`;
  }

  private subscribeToEvents(): void {
    eventBus.on('extraction:started', () => {
      this.setState(TrayState.Processing);
      this.updateMenu();
    });

    eventBus.on('extraction:completed', () => {
      this.setState(TrayState.Idle);
      this.updateMenu();
    });

    eventBus.on('extraction:error', () => {
      this.setState(TrayState.Error);
      this.updateMenu();
    });

    eventBus.on('review:needed', () => {
      this.setState(TrayState.Review);
      this.updateMenu();
    });
  }
}
