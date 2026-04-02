import { app, dialog } from 'electron';
import * as path from 'path';
import { TrayManager } from './main/tray';
import { NotificationManager } from './main/notifications';
import { initVault, openVault, closeVault, isVault } from './core/vault';
import { loadAppConfig, saveAppConfig } from './core/app-config';
import { FileWatcher } from './core/watcher';
import { SyncEngine } from './core/sync-engine';
import { ExtractionQueue } from './core/extraction-queue';
import { ClaudeCodeRunner } from './core/claude-cli';
import { eventBus } from './core/event-bus';
import { VaultHandle } from './shared/types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let trayManager: TrayManager | null = null;
let notificationManager: NotificationManager | null = null;
let fileWatcher: FileWatcher | null = null;
let syncEngine: SyncEngine | null = null;
let extractionQueue: ExtractionQueue | null = null;
let currentVault: VaultHandle | null = null;

// Prevent default window creation — this is a tray-only app
app.on('window-all-closed', () => {
  // Don't quit on macOS when all windows close — we're a tray app
});

app.on('ready', async () => {
  console.log('[InvoiceVault] App ready');

  // Check Claude CLI availability
  if (!ClaudeCodeRunner.isAvailable()) {
    console.warn('[InvoiceVault] Claude CLI not found. Extraction will fail until installed.');
  }

  // Initialize tray
  trayManager = new TrayManager({
    onInitVault: handleInitVault,
    onProcessNow: handleProcessNow,
    onQuit: handleQuit,
  });
  trayManager.init();

  // Initialize notifications
  notificationManager = new NotificationManager();
  notificationManager.init();

  // Wire extraction queue trigger on file events
  eventBus.on('file:added', () => {
    // Debounce extraction trigger
    scheduleExtraction();
  });
  eventBus.on('file:changed', () => {
    scheduleExtraction();
  });

  // Try to open last vault
  const appConfig = loadAppConfig();
  if (appConfig.lastVaultPath && isVault(appConfig.lastVaultPath)) {
    try {
      await startVault(appConfig.lastVaultPath);
    } catch (err) {
      console.error('[InvoiceVault] Failed to open last vault:', err);
    }
  } else {
    console.log('[InvoiceVault] No vault configured. Use tray menu to initialize one.');
  }
});

let extractionTimer: NodeJS.Timeout | null = null;

function scheduleExtraction(): void {
  if (extractionTimer) clearTimeout(extractionTimer);
  extractionTimer = setTimeout(() => {
    extractionTimer = null;
    extractionQueue?.trigger();
  }, 2000); // Wait 2s after last file event before triggering extraction
}

async function startVault(vaultPath: string): Promise<void> {
  // Close existing vault if open
  await stopVault();

  currentVault = openVault(vaultPath);

  // Start sync engine
  syncEngine = new SyncEngine(currentVault.rootPath);

  // Start file watcher
  fileWatcher = new FileWatcher(currentVault.rootPath, (event, relativePath, fullPath) => {
    syncEngine!.handleEvent(event, relativePath, fullPath);
  });
  fileWatcher.start();

  // Start extraction queue
  const appConfig = loadAppConfig();
  extractionQueue = new ExtractionQueue(currentVault, appConfig.claudeCliPath || undefined);

  // Update tray
  trayManager?.setVaultPath(vaultPath);

  eventBus.emit('vault:opened', { path: vaultPath });
  console.log(`[InvoiceVault] Vault started: ${vaultPath}`);
}

async function stopVault(): Promise<void> {
  if (fileWatcher) {
    await fileWatcher.stop();
    fileWatcher = null;
  }
  syncEngine = null;
  extractionQueue = null;

  if (currentVault) {
    closeVault();
    currentVault = null;
  }

  trayManager?.setVaultPath(null);
}

async function handleInitVault(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: 'Select folder to initialize as InvoiceVault',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) return;

  const folderPath = result.filePaths[0];

  try {
    if (isVault(folderPath)) {
      // Already a vault — just open it
      await startVault(folderPath);
    } else {
      initVault(folderPath);
      await startVault(folderPath);
    }

    saveAppConfig({ lastVaultPath: folderPath });
    eventBus.emit('vault:initialized', { path: folderPath });
  } catch (err) {
    console.error('[InvoiceVault] Failed to initialize vault:', err);
    dialog.showErrorBox('Vault Initialization Failed', (err as Error).message);
  }
}

function handleProcessNow(): void {
  if (!extractionQueue) {
    console.log('[InvoiceVault] No vault open, cannot process');
    return;
  }
  extractionQueue.trigger();
}

async function handleQuit(): Promise<void> {
  console.log('[InvoiceVault] Shutting down...');
  await stopVault();
  eventBus.removeAllListeners();
  trayManager?.destroy();
  app.quit();
}
