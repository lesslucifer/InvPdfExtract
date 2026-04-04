import { app } from 'electron';
import { NotificationManager } from './main/notifications';
import { OverlayWindow } from './main/overlay-window';
import { initVault, openVault, closeVault, isVault } from './core/vault';
import { loadAppConfig, saveAppConfig } from './core/app-config';
import { FileWatcher } from './core/watcher';
import { SyncEngine } from './core/sync-engine';
import { ExtractionQueue } from './core/extraction-queue';
import { ClaudeCodeRunner } from './core/claude-cli';
import { VaultPathCache } from './core/vault-path-cache';
import { eventBus } from './core/event-bus';
import { VaultHandle } from './shared/types';
import { startIpcBridge, stopIpcBridge } from './main/ipc-bridge';

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
let vaultPathCache: VaultPathCache | null = null;

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
    onReprocessFile: (relativePath: string) => {
      if (!currentVault) return 0;
      const { getFileByPath, updateFileStatus } = require('./core/db/files');
      const file = getFileByPath(relativePath);
      if (file) {
        updateFileStatus(file.id, 'pending');
        extractionQueue?.trigger();
        return 1;
      }
      // File not in DB — run through sync engine to insert + process
      if (syncEngine) {
        const fullPath = require('path').join(currentVault.rootPath, relativePath);
        syncEngine.handleEvent('file:added', relativePath, fullPath);
        scheduleExtraction();
        return 1;
      }
      return 0;
    },
    onReprocessFolder: (folderPrefix: string) => {
      if (!currentVault) return 0;
      const { getFilesByFolder, updateFileStatus } = require('./core/db/files');
      const files = getFilesByFolder(folderPrefix);
      for (const file of files) {
        updateFileStatus(file.id, 'pending');
      }
      // Also scan filesystem for untracked files in this folder
      const fs = require('fs');
      const pathMod = require('path');
      const { WATCHED_EXTENSIONS } = require('./shared/constants');
      const trackedPaths = new Set(files.map((f: any) => f.relative_path));
      let newCount = 0;
      const scanDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(pathMod.join(currentVault!.rootPath, dir), { withFileTypes: true });
          for (const entry of entries) {
            const rel = dir ? `${dir}/${entry.name}` : entry.name;
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              scanDir(rel);
            } else if (entry.isFile()) {
              const ext = pathMod.extname(entry.name).toLowerCase();
              if (WATCHED_EXTENSIONS.has(ext) && !trackedPaths.has(rel)) {
                const fullPath = pathMod.join(currentVault!.rootPath, rel);
                syncEngine?.handleEvent('file:added', rel, fullPath);
                newCount++;
              }
            }
          }
        } catch { /* skip unreadable dirs */ }
      };
      scanDir(folderPrefix);
      if (files.length > 0 || newCount > 0) {
        scheduleExtraction();
      }
      return files.length + newCount;
    },
    onCountFolderFiles: (folderPrefix: string) => {
      if (!currentVault) return 0;
      // Count both tracked DB files and untracked filesystem files
      const { getFilesByFolder } = require('./core/db/files');
      const fs = require('fs');
      const pathMod = require('path');
      const { WATCHED_EXTENSIONS } = require('./shared/constants');
      const dbFiles = getFilesByFolder(folderPrefix);
      const trackedPaths = new Set(dbFiles.map((f: any) => f.relative_path));
      let total = dbFiles.length;
      const scanDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(pathMod.join(currentVault!.rootPath, dir), { withFileTypes: true });
          for (const entry of entries) {
            const rel = dir ? `${dir}/${entry.name}` : entry.name;
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              scanDir(rel);
            } else if (entry.isFile()) {
              const ext = pathMod.extname(entry.name).toLowerCase();
              if (WATCHED_EXTENSIONS.has(ext) && !trackedPaths.has(rel)) {
                total++;
              }
            }
          }
        } catch { /* skip unreadable dirs */ }
      };
      scanDir(folderPrefix);
      return total;
    },
    onCancelQueueItem: (fileId: string) => {
      const { cancelQueueItem } = require('./core/db/files');
      return cancelQueueItem(fileId);
    },
    onClearPendingQueue: () => {
      const { clearPendingQueue } = require('./core/db/files');
      return clearPendingQueue();
    },
    onQuit: handleQuit,
  });
  overlayWindow.registerIpcHandlers();
  overlayWindow.subscribeToStatusEvents();
  overlayWindow.registerShortcut();
  startIpcBridge();

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
    // Keep path cache in sync
    if (event === 'file:added') vaultPathCache?.onFileAdded(relativePath);
    else if (event === 'file:deleted') vaultPathCache?.onFileDeleted(relativePath);
  });
  fileWatcher.start();

  // Build path cache in background — non-blocking
  vaultPathCache = new VaultPathCache(currentVault.rootPath);
  vaultPathCache.build().catch(err => console.error('[VaultPathCache] Build failed:', err));
  overlayWindow?.setPathCache(vaultPathCache);

  // Start extraction queue
  const appConfig = loadAppConfig();
  extractionQueue = new ExtractionQueue(currentVault, appConfig.claudeCliPath || undefined, undefined, appConfig.claudeModels);

  // Startup recovery: reset stale processing files and trigger queue
  {
    const { resetStaleProcessingFiles, getFilesByStatus: getByStatus } = require('./core/db/files');
    const recoveredCount = resetStaleProcessingFiles();
    if (recoveredCount > 0) {
      console.log(`[InvoiceVault] Recovered ${recoveredCount} stale processing file(s) → pending`);
    }
    const pendingCount = getByStatus('pending').length;
    if (pendingCount > 0) {
      console.log(`[InvoiceVault] ${pendingCount} pending file(s) found on startup, scheduling extraction`);
      scheduleExtraction();
    }
  }

  // Initial scan: pick up existing files not yet tracked in the DB
  {
    const fs = require('fs');
    const pathMod = require('path');
    const { WATCHED_EXTENSIONS: exts, INVOICEVAULT_DIR: ivDir } = require('./shared/constants');
    const { getFileByPath } = require('./core/db/files');
    let scanned = 0;
    const scan = (dir: string) => {
      try {
        const entries = fs.readdirSync(pathMod.join(vaultPath, dir), { withFileTypes: true });
        for (const entry of entries) {
          const rel = dir ? `${dir}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === ivDir) continue;
            scan(rel);
          } else if (entry.isFile()) {
            const ext = pathMod.extname(entry.name).toLowerCase();
            if (exts.has(ext) && !getFileByPath(rel)) {
              const fullPath = pathMod.join(vaultPath, rel);
              syncEngine?.handleEvent('file:added', rel, fullPath);
              scanned++;
            }
          }
        }
      } catch { /* skip unreadable dirs */ }
    };
    scan('');
    if (scanned > 0) {
      console.log(`[InvoiceVault] Initial scan found ${scanned} untracked file(s), scheduling extraction`);
      scheduleExtraction();
    }
  }

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
  vaultPathCache = null;

  if (currentVault) {
    closeVault();
    currentVault = null;
  }

  overlayWindow?.setVaultPath(null);
}

async function handleQuit(): Promise<void> {
  console.log('[InvoiceVault] Shutting down...');
  stopIpcBridge();
  await stopVault();
  eventBus.removeAllListeners();
  overlayWindow?.destroy();
  app.quit();
}
