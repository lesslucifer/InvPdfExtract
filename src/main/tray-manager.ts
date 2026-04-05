import { Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';
import { eventBus } from '../core/event-bus';

interface TrayManagerOptions {
  onQuit: () => void;
}

export class TrayManager {
  private tray: Tray | null = null;
  private icon: Electron.NativeImage = null as any;
  private showOverlayFn: (() => void) | null = null;
  private onQuit: () => void;

  constructor(opts: TrayManagerOptions) {
    this.onQuit = opts.onQuit;
  }

  init(): void {
    this.loadIcon();
    this.tray = new Tray(this.icon);
    this.tray.setToolTip('InvoiceVault');
    this.buildMenu();
    this.subscribeToEvents();
  }

  setShowOverlayCallback(fn: () => void): void {
    this.showOverlayFn = fn;
    this.buildMenu();
  }

  destroy(): void {
    eventBus.off('extraction:started', this.onExtractionStarted);
    eventBus.off('extraction:completed', this.onExtractionCompleted);
    eventBus.off('extraction:error', this.onExtractionError);
    eventBus.off('review:needed', this.onReviewNeeded);
    this.tray?.destroy();
    this.tray = null;
  }

  private loadIcon(): void {
    const resourceDir = app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(app.getAppPath(), 'resources');

    // Use PNG for tray — Electron doesn't support SVG in nativeImage.
    // On macOS, setTemplateImage makes the white icon adapt to light/dark menu bar.
    const iconPath = path.join(resourceDir, 'tray-icon.png');
    const img = nativeImage.createFromPath(iconPath);
    this.icon = img.resize({ width: 16, height: 16 });
    if (process.platform === 'darwin') {
      this.icon.setTemplateImage(true);
    }
  }

  private buildMenu(): void {
    if (!this.tray) return;
    const menu = Menu.buildFromTemplate([
      {
        label: 'Show Overlay',
        click: () => this.showOverlayFn?.(),
      },
      { type: 'separator' },
      {
        label: 'Quit InvoiceVault',
        click: () => this.onQuit(),
      },
    ]);
    this.tray.setContextMenu(menu);
  }

  // Bound event handlers for clean removal (kept for future per-state icon support)
  private onExtractionStarted = (_data: { fileIds: string[] }) => {};
  private onExtractionCompleted = (_data: { batchId: string; fileId: string; recordCount: number; confidence: number }) => {};
  private onExtractionError = (_data: { fileId: string; error: string }) => {};
  private onReviewNeeded = (_data: { fileId: string; recordCount: number }) => {};

  private subscribeToEvents(): void {
    eventBus.on('extraction:started', this.onExtractionStarted);
    eventBus.on('extraction:completed', this.onExtractionCompleted);
    eventBus.on('extraction:error', this.onExtractionError);
    eventBus.on('review:needed', this.onReviewNeeded);
  }
}
