import { app } from 'electron';
import { NotificationManager } from './main/notifications';
import { OverlayWindow } from './main/overlay-window';
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

let notificationManager: NotificationManager | null = null;
let overlayWindow: OverlayWindow | null = null;
let fileWatcher: FileWatcher | null = null;
let syncEngine: SyncEngine | null = null;
let extractionQueue: ExtractionQueue | null = null;
let currentVault: VaultHandle | null = null;

// Prevent default window creation — overlay-only app
app.on('window-all-closed', () => {
  // Don't quit when all windows close — activated by hotkey
});

app.on('ready', async () => {
  console.log('[InvoiceVault] App ready');

  // Hide dock icon on macOS — overlay-only app
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // Check Claude CLI availability
  if (!ClaudeCodeRunner.isAvailable()) {
    console.warn('[InvoiceVault] Claude CLI not found. Extraction will fail until installed.');
  }

  // Initialize notifications
  notificationManager = new NotificationManager();
  notificationManager.init();

  // Initialize search overlay
  overlayWindow = new OverlayWindow();
  overlayWindow.setCallbacks({
    onInitVault: async (folderPath: string) => {
      if (isVault(folderPath)) {
        await startVault(folderPath);
      } else {
        initVault(folderPath);
        await startVault(folderPath);
      }
      const config = loadAppConfig();
      const vaultPaths = config.vaultPaths || [];
      if (!vaultPaths.includes(folderPath)) {
        vaultPaths.push(folderPath);
      }
      saveAppConfig({ lastVaultPath: folderPath, vaultPaths });
    },
    onSwitchVault: async (vaultPath: string) => {
      await startVault(vaultPath);
      saveAppConfig({ lastVaultPath: vaultPath });
    },
    onStopVault: async () => {
      await stopVault();
    },
    onReprocessAll: () => {
      if (!currentVault) return 0;
      const { getFilesByStatus, updateFileStatus } = require('./core/db/files');
      const doneFiles = getFilesByStatus('done');
      const errorFiles = getFilesByStatus('error');
      const reviewFiles = getFilesByStatus('review');
      for (const file of [...doneFiles, ...errorFiles, ...reviewFiles]) {
        updateFileStatus(file.id, 'pending');
      }
      const count = doneFiles.length + errorFiles.length + reviewFiles.length;
      extractionQueue?.trigger();
      return count;
    },
    onQuit: handleQuit,
  });
  overlayWindow.registerIpcHandlers();
  overlayWindow.subscribeToStatusEvents();
  overlayWindow.registerShortcut();

  // Wire extraction queue trigger on file events
  eventBus.on('file:added', () => {
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
    // No vault configured — show overlay immediately so user can set one up
    console.log('[InvoiceVault] No vault configured. Showing overlay for first-time setup.');
    overlayWindow.showOverlay();
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

  overlayWindow?.setVaultPath(vaultPath);

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

  overlayWindow?.setVaultPath(null);
}

async function handleQuit(): Promise<void> {
  console.log('[InvoiceVault] Shutting down...');
  await stopVault();
  eventBus.removeAllListeners();
  overlayWindow?.destroy();
  app.quit();
}
