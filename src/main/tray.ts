import { Tray, Menu, nativeImage, shell, app } from 'electron';
import * as path from 'path';
import { TrayState } from '../shared/types';
import { eventBus } from '../core/event-bus';

export class TrayManager {
  private tray: Tray | null = null;
  private state: TrayState = TrayState.Idle;
  private vaultPath: string | null = null;
  private icons: Map<TrayState, Electron.NativeImage> = new Map();
  private onInitVault: (() => void) | null = null;
  private onProcessNow: (() => void) | null = null;
  private onQuit: (() => void) | null = null;

  constructor(opts: {
    onInitVault: () => void;
    onProcessNow: () => void;
    onQuit: () => void;
  }) {
    this.onInitVault = opts.onInitVault;
    this.onProcessNow = opts.onProcessNow;
    this.onQuit = opts.onQuit;
  }

  init(): void {
    this.loadIcons();

    const icon = this.icons.get(TrayState.Idle)!;
    this.tray = new Tray(icon);
    this.tray.setToolTip('InvoiceVault');
    this.updateMenu();

    this.subscribeToEvents();
  }

  setVaultPath(vaultPath: string | null): void {
    this.vaultPath = vaultPath;
    this.updateMenu();
  }

  setState(state: TrayState): void {
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
    const iconDir = app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(__dirname, '..', '..', 'resources');
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
        // Resize for macOS tray (16x16 is standard)
        const resized = img.resize({ width: 16, height: 16 });
        this.icons.set(state, resized);
      } catch (err) {
        console.warn(`[Tray] Failed to load icon: ${imgPath}`, err);
        // Create a fallback empty icon
        this.icons.set(state, nativeImage.createEmpty());
      }
    }
  }

  private updateMenu(): void {
    if (!this.tray) return;

    const hasVault = !!this.vaultPath;

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Initialize New Vault...',
        click: () => this.onInitVault?.(),
      },
      { type: 'separator' },
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
      { type: 'separator' },
      {
        label: `Vault: ${this.vaultPath ? path.basename(this.vaultPath) : 'None'}`,
        enabled: false,
      },
      {
        label: `Status: ${this.state}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Quit InvoiceVault',
        click: () => this.onQuit?.(),
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(menu);
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
