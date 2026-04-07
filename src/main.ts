import { app, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
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
import { VaultFile, VaultHandle, FileStatus } from './shared/types';
import { startIpcBridge, stopIpcBridge } from './main/ipc-bridge';
import { JESimilarityEngine } from './core/je-similarity';
import { JEGenerator } from './core/je-generator';
import { writeDefaultInstructions } from './core/je-instructions';
import { TrayManager } from './main/tray-manager';
import { RelevanceFilter } from './core/filters/relevance-filter';
import {
  getFilesByStatus, getFilesByStatuses, updateFileStatus, getFileByPath, getFilesByFolder,
  cancelQueueItem, clearPendingQueue, resetStaleProcessingFiles,
} from './core/db/files';
import { getRecordsByFileId, updateJeStatus } from './core/db/records';
import { WATCHED_EXTENSIONS, INVOICEVAULT_DIR } from './shared/constants';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let isQuitting = false;
let notificationManager: NotificationManager | null = null;
let overlayWindow: OverlayWindow | null = null;
let trayManager: TrayManager | null = null;
let fileWatcher: FileWatcher | null = null;
let syncEngine: SyncEngine | null = null;
let extractionQueue: ExtractionQueue | null = null;
let currentVault: VaultHandle | null = null;
let vaultPathCache: VaultPathCache | null = null;
let similarityEngine: JESimilarityEngine | null = null;
let jeGenerator: JEGenerator | null = null;

// Graceful shutdown on signals (terminal kill, Ctrl+C)
process.on('SIGTERM', () => {
  console.log('[InvoiceVault] Received SIGTERM');
  handleQuit();
});
process.on('SIGINT', () => {
  console.log('[InvoiceVault] Received SIGINT');
  handleQuit();
});

// Prevent default window creation — overlay-only app
app.on('window-all-closed', () => {
  // Don't quit when all windows close — activated by hotkey
});

// Show overlay when clicking dock icon (macOS) or taskbar icon (Windows)
app.on('activate', () => {
  overlayWindow?.showOverlay();
});

// Route all quit paths through handleQuit for graceful shutdown
app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    handleQuit();
    return;
  }
  overlayWindow?.closeAllSpawnedWindows();
});

app.on('ready', async () => {
  console.log('[InvoiceVault] App ready');

  // Set app icon on macOS — keep dock visible so clicking it shows the overlay
  if (process.platform === 'darwin' && app.dock) {
    const resourceDir = path.join(app.getAppPath(), 'resources');
    const dockIcon = nativeImage.createFromPath(path.join(resourceDir, 'icon-1024.png'));
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  // Check Claude CLI availability
  if (!await ClaudeCodeRunner.isAvailable()) {
    console.warn('[InvoiceVault] Claude CLI not found. Extraction will fail until installed.');
  }

  // Initialize notifications
  notificationManager = new NotificationManager();
  notificationManager.init();

  // Initialize search overlay
  overlayWindow = new OverlayWindow();
  overlayWindow.setCallbacks({
    onInitVault: async (folderPath: string) => {
      if (await isVault(folderPath)) {
        await startVault(folderPath);
      } else {
        await initVault(folderPath);
        await startVault(folderPath);
      }
      const config = await loadAppConfig();
      const vaultPaths = config.vaultPaths || [];
      if (!vaultPaths.includes(folderPath)) {
        vaultPaths.push(folderPath);
      }
      await saveAppConfig({ lastVaultPath: folderPath, vaultPaths });
    },
    onSwitchVault: async (vaultPath: string) => {
      await startVault(vaultPath);
      await saveAppConfig({ lastVaultPath: vaultPath });
    },
    onStopVault: async () => {
      await stopVault();
    },
    onReprocessAll: () => {
      if (!currentVault) return 0;
      const doneFiles = getFilesByStatus(FileStatus.Done);
      const errorFiles = getFilesByStatus(FileStatus.Error);
      const reviewFiles = getFilesByStatus(FileStatus.Review);
      const skippedFiles = getFilesByStatus(FileStatus.Skipped);
      for (const file of [...doneFiles, ...errorFiles, ...reviewFiles, ...skippedFiles]) {
        updateFileStatus(file.id, FileStatus.Pending);
      }
      const count = doneFiles.length + errorFiles.length + reviewFiles.length + skippedFiles.length;
      extractionQueue?.trigger();
      return count;
    },
    onReprocessFile: (relativePath: string) => {
      if (!currentVault) return 0;
      const file = getFileByPath(relativePath);
      if (file) {
        updateFileStatus(file.id, FileStatus.Pending);
        extractionQueue?.trigger();
        return 1;
      }
      // File not in DB — run through sync engine to insert + process
      if (syncEngine) {
        const fullPath = path.join(currentVault.rootPath, relativePath);
        syncEngine.handleEvent('file:added', relativePath, fullPath);
        scheduleExtraction();
        return 1;
      }
      return 0;
    },
    onReprocessFolder: async (folderPrefix: string) => {
      if (!currentVault) return 0;
      const files = getFilesByFolder(folderPrefix);
      for (const file of files) {
        updateFileStatus(file.id, FileStatus.Pending);
      }
      // Also scan filesystem for untracked files in this folder
      const trackedPaths = new Set(files.map((f: VaultFile) => f.relative_path));
      let newCount = 0;
      const scanDir = async (dir: string) => {
        try {
          const entries = await fs.promises.readdir(path.join(currentVault!.rootPath, dir), { withFileTypes: true });
          for (const entry of entries) {
            const rel = dir ? `${dir}/${entry.name}` : entry.name;
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              await scanDir(rel);
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              if (WATCHED_EXTENSIONS.has(ext) && !trackedPaths.has(rel)) {
                const fullPath = path.join(currentVault!.rootPath, rel);
                syncEngine?.handleEvent('file:added', rel, fullPath);
                newCount++;
              }
            }
          }
        } catch { /* skip unreadable dirs */ }
      };
      await scanDir(folderPrefix);
      if (files.length > 0 || newCount > 0) {
        scheduleExtraction();
      }
      return files.length + newCount;
    },
    onCountFolderFiles: async (folderPrefix: string) => {
      if (!currentVault) return 0;
      // Count both tracked DB files and untracked filesystem files
      const dbFiles = getFilesByFolder(folderPrefix);
      const trackedPaths = new Set(dbFiles.map((f: VaultFile) => f.relative_path));
      let total = dbFiles.length;
      const scanDir = async (dir: string) => {
        try {
          const entries = await fs.promises.readdir(path.join(currentVault!.rootPath, dir), { withFileTypes: true });
          for (const entry of entries) {
            const rel = dir ? `${dir}/${entry.name}` : entry.name;
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              await scanDir(rel);
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              if (WATCHED_EXTENSIONS.has(ext) && !trackedPaths.has(rel)) {
                total++;
              }
            }
          }
        } catch { /* skip unreadable dirs */ }
      };
      await scanDir(folderPrefix);
      return total;
    },
    onCancelQueueItem: (fileId: string) => {
      return cancelQueueItem(fileId);
    },
    onClearPendingQueue: () => {
      return clearPendingQueue();
    },
    onQuit: handleQuit,
    onGenerateJE: async (recordId: string) => {
      if (!jeGenerator) return 0;
      return jeGenerator.generateForRecord(recordId);
    },
    onGenerateJEForFile: async (fileId: string) => {
      if (!jeGenerator) return 0;
      return jeGenerator.generateForFile(fileId);
    },
    getVaultRoot: () => currentVault?.rootPath ?? null,
  });
  overlayWindow.registerIpcHandlers();
  overlayWindow.subscribeToStatusEvents();
  overlayWindow.registerShortcut();

  // System tray — provides Quit menu item on both macOS and Windows
  trayManager = new TrayManager({ onQuit: handleQuit });
  trayManager.init();
  trayManager.setShowOverlayCallback(() => overlayWindow?.showOverlay());

  startIpcBridge();

  // File events trigger extraction queue — filtering now happens inside the queue per batch
  eventBus.on('file:added', () => scheduleExtraction());
  eventBus.on('file:changed', () => scheduleExtraction());

  // Try to open last vault
  const appConfig = await loadAppConfig();
  if (appConfig.lastVaultPath && await isVault(appConfig.lastVaultPath)) {
    try {
      await startVault(appConfig.lastVaultPath);
    } catch (err) {
      console.error('[InvoiceVault] Failed to open last vault:', err);
      overlayWindow.showOverlay();
      overlayWindow.notifyDbError((err as Error).message);
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

  currentVault = await openVault(vaultPath);

  // Start sync engine
  syncEngine = new SyncEngine(currentVault.rootPath);

  // Start file watcher
  fileWatcher = new FileWatcher(currentVault.rootPath, (event, relativePath, fullPath) => {
    syncEngine!.handleEvent(event, relativePath, fullPath);
    // Keep path cache in sync
    if (event === 'file:added') vaultPathCache?.onFileAdded(relativePath);
    else if (event === 'file:deleted') vaultPathCache?.onFileDeleted(relativePath);
  });
  await fileWatcher.start();

  // Build path cache in background — non-blocking
  vaultPathCache = new VaultPathCache(currentVault.rootPath);
  vaultPathCache.build().catch(err => console.error('[VaultPathCache] Build failed:', err));
  overlayWindow?.setPathCache(vaultPathCache);

  // Start relevance filter and extraction queue
  const appConfig = await loadAppConfig();
  const relevanceFilter = await RelevanceFilter.create(currentVault, appConfig.claudeCliPath || undefined);
  extractionQueue = new ExtractionQueue(currentVault, relevanceFilter, appConfig.claudeCliPath || undefined, undefined, appConfig.claudeModels);

  // Initialize JE similarity engine & generator
  await writeDefaultInstructions(currentVault.rootPath);
  similarityEngine = new JESimilarityEngine();
  similarityEngine.initialize();
  jeGenerator = new JEGenerator(currentVault.rootPath, similarityEngine, appConfig.claudeCliPath || undefined);

  // Auto-generate JEs after extraction completes
  eventBus.on('extraction:completed', async (data) => {
    if (!jeGenerator) return;
    try {
      // Mark records as pending for JE classification
      const records = getRecordsByFileId(data.fileId);
      if (records.length > 0) {
        const ids = records.map(r => r.id);
        updateJeStatus(ids, 'pending');
        eventBus.emit('je:status-changed', { recordIds: ids, status: 'pending' });
      }
      await jeGenerator.generateForFile(data.fileId);
    } catch (err) {
      console.error('[JEGenerator] Auto-generation failed:', err);
    }
  });

  // Startup recovery: reset stale processing files and trigger queue
  {
    const recoveredCount = resetStaleProcessingFiles();
    if (recoveredCount > 0) {
      console.log(`[InvoiceVault] Recovered ${recoveredCount} stale processing file(s) → pending`);
    }
    const queuedCount = getFilesByStatuses([FileStatus.Unfiltered, FileStatus.Pending]).length;
    if (queuedCount > 0) {
      console.log(`[InvoiceVault] ${queuedCount} queued file(s) found on startup, scheduling extraction`);
      scheduleExtraction();
    }
  }

  // Initial scan: pick up existing files not yet tracked in the DB
  {
    let scanned = 0;
    const scan = async (dir: string) => {
      try {
        const entries = await fs.promises.readdir(path.join(vaultPath, dir), { withFileTypes: true });
        for (const entry of entries) {
          const rel = dir ? `${dir}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === INVOICEVAULT_DIR) continue;
            await scan(rel);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (WATCHED_EXTENSIONS.has(ext) && !getFileByPath(rel)) {
              const fullPath = path.join(vaultPath, rel);
              syncEngine?.handleEvent('file:added', rel, fullPath);
              scanned++;
            }
          }
        }
      } catch { /* skip unreadable dirs */ }
    };
    await scan('');
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
  similarityEngine?.destroy();
  similarityEngine = null;
  jeGenerator = null;

  if (currentVault) {
    closeVault(currentVault);
    currentVault = null;
  }

  overlayWindow?.setVaultPath(null);
}

async function handleQuit(): Promise<void> {
  if (isQuitting) return;
  isQuitting = true;
  console.log('[InvoiceVault] Shutting down...');

  const forceQuit = setTimeout(() => {
    console.error('[InvoiceVault] Shutdown timed out, forcing quit');
    process.exit(1);
  }, 5000);

  try {
    stopIpcBridge();
    await stopVault();
    eventBus.removeAllListeners();
    trayManager?.destroy();
    overlayWindow?.destroy();
  } catch (err) {
    console.error('[InvoiceVault] Error during shutdown:', err);
  } finally {
    clearTimeout(forceQuit);
    app.quit();
  }
}
