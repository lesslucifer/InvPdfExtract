import { contextBridge, ipcRenderer } from 'electron';
import { InvoiceVaultAPI, FieldOverrideInput, LineItemFieldInput, JournalEntryInput, SearchFilters, FileStatus } from './shared/types';

const api: InvoiceVaultAPI = {
  search: (query: string, offset?: number, folder?: string | null, filePath?: string | null) => ipcRenderer.invoke('search', query, offset ?? 0, folder ?? null, filePath ?? null),
  openFile: (relativePath: string) => ipcRenderer.invoke('open-file', relativePath),
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
  initVault: (folderPath: string) => ipcRenderer.invoke('init-vault', folderPath),
  switchVault: (vaultPath: string) => ipcRenderer.invoke('switch-vault', vaultPath),
  removeVault: (vaultPath: string) => ipcRenderer.invoke('remove-vault', vaultPath),
  clearVaultData: (vaultPath: string) => ipcRenderer.invoke('clear-vault-data', vaultPath),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openFolder: (relativePath: string) => ipcRenderer.invoke('open-folder', relativePath),
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
  // Journal entries
  getJournalEntries: (recordId: string) => ipcRenderer.invoke('get-journal-entries', recordId),
  saveJournalEntry: (input: JournalEntryInput) => ipcRenderer.invoke('save-journal-entry', input),
  deleteJournalEntry: (id: string) => ipcRenderer.invoke('delete-journal-entry', id),
  generateJournalEntries: (recordId: string) => ipcRenderer.invoke('generate-journal-entries', recordId),
  getJEInstructions: () => ipcRenderer.invoke('get-je-instructions'),
  saveJEInstructions: (content: string) => ipcRenderer.invoke('save-je-instructions', content),
};

contextBridge.exposeInMainWorld('api', api);
