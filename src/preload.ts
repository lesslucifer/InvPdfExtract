import { contextBridge, ipcRenderer } from 'electron';
import { InvoiceVaultAPI, FieldOverrideInput, LineItemFieldInput, JournalEntryInput, SearchFilters, FileStatus, JEGenerationStatus } from './shared/types';

const api: InvoiceVaultAPI = {
  search: (query: string, offset?: number, folder?: string | null, filePath?: string | null) => ipcRenderer.invoke('search', query, offset ?? 0, folder ?? null, filePath ?? null),
  locateFile: (relativePath: string) => ipcRenderer.invoke('locate-file', relativePath),
  getLineItems: (recordId: string) => ipcRenderer.invoke('get-line-items', recordId),
  saveFieldOverride: (input: FieldOverrideInput) => ipcRenderer.invoke('save-field-override', input),
  getFieldOverrides: (recordId: string) => ipcRenderer.invoke('get-field-overrides', recordId),
  resolveConflict: (recordId: string, fieldName: string, action: 'keep' | 'accept') =>
    ipcRenderer.invoke('resolve-conflict', recordId, fieldName, action),
  resolveAllConflicts: (recordId: string, action: 'keep' | 'accept') =>
    ipcRenderer.invoke('resolve-all-conflicts', recordId, action),
  saveLineItemField: (input: LineItemFieldInput) =>
    ipcRenderer.invoke('save-line-item-field', input),
  getLineItemOverrides: (lineItemIds: string[]) =>
    ipcRenderer.invoke('get-line-item-overrides', lineItemIds),
  // Spotlight UX additions
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  getLocale: () => ipcRenderer.invoke('get-locale'),
  setLocale: (locale: 'en' | 'vi') => ipcRenderer.invoke('set-locale', locale),
  initVault: (folderPath: string) => ipcRenderer.invoke('init-vault', folderPath),
  switchVault: (vaultPath: string) => ipcRenderer.invoke('switch-vault', vaultPath),
  removeVault: (vaultPath: string) => ipcRenderer.invoke('remove-vault', vaultPath),
  clearVaultData: (vaultPath: string) => ipcRenderer.invoke('clear-vault-data', vaultPath),
  backupVault: (vaultPath: string) => ipcRenderer.invoke('backup-vault', vaultPath),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  locateFolder: (relativePath: string) => ipcRenderer.invoke('locate-folder', relativePath),
  listRecentFolders: (limit?: number) => ipcRenderer.invoke('list-recent-folders', limit),
  listTopFolders: () => ipcRenderer.invoke('list-top-folders'),
  getAggregates: (filters: SearchFilters) => ipcRenderer.invoke('get-aggregates', filters),
  exportFiltered: (filters: SearchFilters) => ipcRenderer.invoke('export-filtered', filters),
  showItemInFolder: (absolutePath: string) => ipcRenderer.invoke('show-item-in-folder', absolutePath),
  checkClaudeCli: () => ipcRenderer.invoke('check-claude-cli'),
  reprocessAll: () => ipcRenderer.invoke('reprocess-all'),
  reprocessFile: (relativePath: string) => ipcRenderer.invoke('reprocess-file', relativePath),
  reprocessFolder: (folderPrefix: string) => ipcRenderer.invoke('reprocess-folder', folderPrefix),
  countFolderFiles: (folderPrefix: string) => ipcRenderer.invoke('count-folder-files', folderPrefix),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  windowlize: (serializedState?: string) => ipcRenderer.invoke('windowlize', serializedState),
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  listVaultPaths: (query: string, scope?: string) => ipcRenderer.invoke('list-vault-paths', query, scope),
  onStatusUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: 'idle' | 'processing' | 'review' | 'error') => callback(status);
    ipcRenderer.on('overlay-status-update', listener);
    // Return an unsubscribe function
    return () => ipcRenderer.removeListener('overlay-status-update', listener);
  },
  // Processing status
  getFilesByStatuses: (statuses: FileStatus[]) => ipcRenderer.invoke('get-files-by-statuses', statuses),
  getErrorLogsWithPath: () => ipcRenderer.invoke('get-error-logs-with-path'),
  getProcessedFilesWithStats: () => ipcRenderer.invoke('get-processed-files-with-stats'),
  getFileStatusesByPaths: (paths: string[]) => ipcRenderer.invoke('get-file-statuses-by-paths', paths),
  getFolderStatuses: () => ipcRenderer.invoke('get-folder-statuses'),
  cancelQueueItem: (fileId: string) => ipcRenderer.invoke('cancel-queue-item', fileId),
  clearPendingQueue: () => ipcRenderer.invoke('clear-pending-queue'),
  // Filter presets
  listPresets: () => ipcRenderer.invoke('list-presets'),
  savePreset: (name: string, filtersJson: string) => ipcRenderer.invoke('save-preset', name, filtersJson),
  deletePreset: (id: string) => ipcRenderer.invoke('delete-preset', id),
  onFileStatusChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { fileIds: string[]; status: FileStatus }) => callback(data);
    ipcRenderer.on('file-status-changed', listener);
    return () => ipcRenderer.removeListener('file-status-changed', listener);
  },
  // Debug / session logs
  getSessionLogForFile: (fileId: string) => ipcRenderer.invoke('get-session-log-for-file', fileId),
  readCliSessionLog: (sessionLogPath: string) => ipcRenderer.invoke('read-cli-session-log', sessionLogPath),
  // Journal entries
  getJournalEntries: (recordId: string) => ipcRenderer.invoke('get-journal-entries', recordId),
  saveJournalEntry: (input: JournalEntryInput) => ipcRenderer.invoke('save-journal-entry', input),
  deleteJournalEntry: (id: string) => ipcRenderer.invoke('delete-journal-entry', id),
  regenerateJE: (recordId: string) => ipcRenderer.invoke('regenerate-je-record', recordId),
  regenerateJEAIOnly: (recordId: string) => ipcRenderer.invoke('regenerate-je-record-ai-only', recordId),
  regenerateJEFiltered: (filters: SearchFilters, aiOnly: boolean) => ipcRenderer.invoke('regenerate-je-filtered', filters, aiOnly),
  getJEInstructions: () => ipcRenderer.invoke('get-je-instructions'),
  saveJEInstructions: (content: string) => ipcRenderer.invoke('save-je-instructions', content),
  getExtractionPrompt: () => ipcRenderer.invoke('get-extraction-prompt'),
  exportInstructions: () => ipcRenderer.invoke('export-instructions'),
  openInstructionFile: (file: 'extraction-prompt' | 'je-instructions') => ipcRenderer.invoke('open-instruction-file', file),
  // JE generation status
  getJeQueueItems: () => ipcRenderer.invoke('get-je-queue-items'),
  getJeErrorItems: () => ipcRenderer.invoke('get-je-error-items'),
  onJeStatusChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { recordIds: string[]; status: JEGenerationStatus }) => callback(data);
    ipcRenderer.on('je-status-changed', listener);
    return () => ipcRenderer.removeListener('je-status-changed', listener);
  },
  onDbError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('db-error', listener);
    return () => ipcRenderer.removeListener('db-error', listener);
  },
  getDbError: () => ipcRenderer.invoke('get-db-error'),
};

contextBridge.exposeInMainWorld('api', api);
