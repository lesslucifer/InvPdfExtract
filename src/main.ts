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
import { checkAIProviderAvailable } from './core/ai-runner';
import { VaultPathCache } from './core/vault-path-cache';
import { eventBus } from './core/event-bus';
import { VaultFile, VaultHandle, FileStatus, SearchFilters } from './shared/types';
import { startIpcBridge, stopIpcBridge } from './main/ipc-bridge';
import { JESimilarityEngine } from './core/je-similarity';
import { JEGenerator } from './core/je-generator';
import { writeDefaultInstructions } from './core/je-instructions';
import { TrayManager } from './main/tray-manager';
import { RelevanceFilter } from './core/filters/relevance-filter';
import { cleanupUnusedScripts } from './core/script-cleanup';
import { initLogger, shutdownLogger, log, LogModule } from './core/logger';
import {
  getFilesByStatus, getFilesByStatuses, updateFileStatus, getFileByPath, getFilesByFolder,
  cancelQueueItem, clearPendingQueue, resetStaleProcessingFiles,
} from './core/db/files';
import { getRecordsByFileId, updateJeStatus, getRecordIdsByFilters, resetStaleJeProcessing, getPendingJeRecordIds } from './core/db/records';
import { WATCHED_EXTENSIONS } from './shared/constants';
import { setUserDataPath } from './core/vault-paths';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Enforce single instance — quit if another instance is already running
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
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
  log.info(LogModule.Main, 'Received SIGTERM');
  handleQuit();
});
process.on('SIGINT', () => {
  log.info(LogModule.Main, 'Received SIGINT');
  handleQuit();
});

// When a second instance is launched, show the existing overlay instead
app.on('second-instance', () => {
  if (overlayWindow) {
    overlayWindow.show();
  }
});

// Prevent default window creation — overlay-only app
app.on('window-all-closed', () => {
  // Don't quit when all windows close — activated by hotkey
});

// Show overlay when clicking dock icon (macOS) or taskbar icon (Windows)
// If spawned windows exist, focus the most recent one instead
app.on('activate', () => {
  if (overlayWindow?.hasSpawnedWindows()) {
    overlayWindow.focusLastSpawnedWindow();
  } else {
    overlayWindow?.showOverlay();
  }
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
  setUserDataPath(app.getPath('userData'));

  await initLogger(path.join(app.getPath('userData'), 'logs'), {
    console: !app.isPackaged,
  });
  log.info(LogModule.Main, 'App ready');

  // Set app icon on macOS — keep dock visible so clicking it shows the overlay
  if (process.platform === 'darwin' && app.dock) {
    const resourceDir = path.join(app.getAppPath(), 'resources');
    const dockIcon = nativeImage.createFromPath(path.join(resourceDir, 'icon-1024.png'));
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  // Check AI provider availability
  {
    const initialConfig = await loadAppConfig();
    const status = await checkAIProviderAvailable(initialConfig);
    if (!status.ok) {
      log.warn(LogModule.Main, `AI provider (${status.provider}) not available: ${status.error ?? 'unknown'}. Extraction will fail until configured.`);
    }
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
      const allFiles = [...doneFiles, ...errorFiles, ...reviewFiles, ...skippedFiles];
      for (const file of allFiles) {
        updateFileStatus(file.id, FileStatus.Pending);
      }
      if (allFiles.length > 0) {
        overlayWindow?.notifyFileStatusChanged(allFiles.map(f => f.id), FileStatus.Pending);
      }
      extractionQueue?.trigger();
      return allFiles.length;
    },
    onReprocessFile: (relativePath: string) => {
      if (!currentVault) return 0;
      const file = getFileByPath(relativePath);
      if (file) {
        updateFileStatus(file.id, FileStatus.Pending);
        overlayWindow?.notifyFileStatusChanged([file.id], FileStatus.Pending);
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
    onReanalyzeFile: async (relativePath: string, hint: string) => {
      if (!currentVault || !extractionQueue) return 0;
      const file = getFileByPath(relativePath);
      if (!file) return 0;
      overlayWindow?.notifyFileStatusChanged([file.id], FileStatus.Processing);
      await extractionQueue.reanalyzeFile(file, hint);
      return 1;
    },
    onCheckFileHasResults: (relativePath: string) => {
      const file = getFileByPath(relativePath);
      if (!file) return false;
      return getRecordsByFileId(file.id).length > 0;
    },
    onReprocessFolder: async (folderPrefix: string) => {
      if (!currentVault) return 0;
      const files = getFilesByFolder(folderPrefix);
      for (const file of files) {
        updateFileStatus(file.id, FileStatus.Pending);
      }
      if (files.length > 0) {
        overlayWindow?.notifyFileStatusChanged(files.map(f => f.id), FileStatus.Pending);
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
    onGenerateJEAIOnly: async (recordId: string) => {
      if (!jeGenerator) return 0;
      return jeGenerator.generateForRecordAIOnly(recordId);
    },
    onGenerateJEForFile: async (fileId: string) => {
      if (!jeGenerator) return 0;
      return jeGenerator.generateForFile(fileId);
    },
    onGenerateJEForFilters: async (filters: SearchFilters, aiOnly: boolean) => {
      if (!jeGenerator) return 0;
      const recordIds = getRecordIdsByFilters(filters);
      if (aiOnly) return jeGenerator.generateBatchAIOnly(recordIds);
      return jeGenerator.generateBatch(recordIds);
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
      log.error(LogModule.Main, 'Failed to open last vault', err);
      overlayWindow.showOverlay();
      overlayWindow.notifyDbError((err as Error).message);
    }
  } else if (appConfig.lastVaultPath) {
    // Vault was configured but data folder is missing or corrupted
    log.error(LogModule.Main, 'Vault data missing for: ' + appConfig.lastVaultPath);
    overlayWindow.showOverlay();
    overlayWindow.notifyDbError('Vault data folder is missing or corrupted. You can reinitialize to start fresh.');
  } else {
    // No vault configured — show overlay immediately so user can set one up
    log.info(LogModule.Main, 'No vault configured, showing overlay for first-time setup');
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
  await initLogger(path.join(currentVault.dotPath, 'logs'), { console: !app.isPackaged });

  // Start sync engine
  syncEngine = new SyncEngine(currentVault.rootPath);

  // Start file watcher
  fileWatcher = new FileWatcher(currentVault.rootPath, currentVault.dotPath, (event, relativePath, fullPath) => {
    syncEngine!.handleEvent(event, relativePath, fullPath);
    // Keep path cache in sync
    if (event === 'file:added') vaultPathCache?.onFileAdded(relativePath);
    else if (event === 'file:deleted') vaultPathCache?.onFileDeleted(relativePath);
  });
  await fileWatcher.start();

  // Reconcile DB against disk — soft-delete any tracked files that no longer exist
  syncEngine.reconcileMissingFiles().catch(err => log.error(LogModule.SyncEngine, 'Reconcile failed', err));

  // Build path cache in background — non-blocking
  vaultPathCache = new VaultPathCache(currentVault.rootPath);
  vaultPathCache.build().catch(err => log.error(LogModule.Main, 'VaultPathCache build failed', err));
  overlayWindow?.setPathCache(vaultPathCache);

  // Start relevance filter and extraction queue
  const appConfig = await loadAppConfig();
  const relevanceFilter = await RelevanceFilter.create(currentVault, appConfig);
  extractionQueue = new ExtractionQueue(currentVault, relevanceFilter, appConfig);

  // Initialize JE similarity engine & generator
  await writeDefaultInstructions(currentVault.dotPath);
  similarityEngine = new JESimilarityEngine();
  similarityEngine.initialize();
  jeGenerator = new JEGenerator(currentVault.dotPath, similarityEngine, appConfig);

  // Auto-generate JEs after extraction completes
  eventBus.on('extraction:completed', async (data) => {
    if (!jeGenerator) return;
    try {
      // Mark records as pending for JE generation
      const records = getRecordsByFileId(data.fileId);
      if (records.length > 0) {
        const ids = records.map(r => r.id);
        updateJeStatus(ids, 'pending');
        eventBus.emit('je:status-changed', { recordIds: ids, status: 'pending' });
      }
      await jeGenerator.generateForFile(data.fileId);
    } catch (err) {
      log.error(LogModule.JEGenerator, 'Auto-generation failed', err);
    }
  });

  // Background cleanup of unused extraction scripts
  try {
    cleanupUnusedScripts(currentVault.dotPath);
  } catch (err) {
    log.error(LogModule.Main, 'Script cleanup failed', err);
  }

  // Startup recovery: reset stale processing files and trigger queue
  {
    const recoveredCount = resetStaleProcessingFiles();
    if (recoveredCount > 0) {
      log.info(LogModule.Main, `Recovered ${recoveredCount} stale processing file(s) → pending`);
    }
    const recoveredJeCount = resetStaleJeProcessing();
    if (recoveredJeCount > 0) {
      log.info(LogModule.Main, `Recovered ${recoveredJeCount} stale JE processing record(s) → pending`);
      eventBus.emit('je:status-changed', { recordIds: [], status: 'pending' });
    }
    if (jeGenerator) {
      const pendingJeIds = getPendingJeRecordIds();
      if (pendingJeIds.length > 0) {
        log.info(LogModule.Main, `${pendingJeIds.length} pending JE record(s) found on startup, triggering generation`);
        jeGenerator.generateBatch(pendingJeIds).catch((err: Error) => {
          log.error(LogModule.Main, 'Startup JE generation failed', err);
        });
      }
    }
    const queuedCount = getFilesByStatuses([FileStatus.Unfiltered, FileStatus.Pending]).length;
    if (queuedCount > 0) {
      log.info(LogModule.Main, `${queuedCount} queued file(s) found on startup, scheduling extraction`);
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
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            await scan(rel);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (WATCHED_EXTENSIONS.has(ext)) {
              const fullPath = path.join(vaultPath, rel);
              syncEngine?.handleEvent(getFileByPath(rel) ? 'file:changed' : 'file:added', rel, fullPath);
              scanned++;
            }
          }
        }
      } catch { /* skip unreadable dirs */ }
    };
    await scan('');
    if (scanned > 0) {
      log.info(LogModule.Main, `Initial scan processed ${scanned} file(s), scheduling extraction`);
      scheduleExtraction();
    }
  }

  overlayWindow?.setVaultPath(vaultPath, currentVault.dotPath);

  // Load persisted window state for this vault and restore its spawned windows
  if (overlayWindow) {
    await overlayWindow.loadPersistedState(currentVault.dotPath);
    await overlayWindow.restoreSpawnedWindows();
  }

  eventBus.emit('vault:opened', { path: vaultPath });
  log.info(LogModule.Main, `Vault started: ${vaultPath}`);
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
  log.info(LogModule.Main, 'Shutting down...');

  const forceQuit = setTimeout(() => {
    log.error(LogModule.Main, 'Shutdown timed out, forcing quit');
    process.exit(1);
  }, 5000);

  try {
    // Flush window state first — must happen before stopIpcBridge so the renderer's
    // beforeunload sync IPC can still be handled when spawned windows are closed.
    await overlayWindow?.flushStateBeforeQuit();
    stopIpcBridge();
    await stopVault();
    eventBus.removeAllListeners();
    trayManager?.destroy();
    overlayWindow?.destroy();
  } catch (err) {
    log.error(LogModule.Main, 'Error during shutdown', err);
  } finally {
    await shutdownLogger();
    clearTimeout(forceQuit);
    app.quit();
  }
}
