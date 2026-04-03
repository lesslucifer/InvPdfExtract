import { contextBridge, ipcRenderer } from 'electron';
import { InvoiceVaultAPI, FieldOverrideInput, SearchFilters } from './shared/types';

const api: InvoiceVaultAPI = {
  search: (query: string) => ipcRenderer.invoke('search', query),
  openFile: (relativePath: string) => ipcRenderer.invoke('open-file', relativePath),
  getLineItems: (recordId: string) => ipcRenderer.invoke('get-line-items', recordId),
  saveFieldOverride: (input: FieldOverrideInput) => ipcRenderer.invoke('save-field-override', input),
  getFieldOverrides: (recordId: string) => ipcRenderer.invoke('get-field-overrides', recordId),
  resolveConflict: (recordId: string, fieldName: string, action: 'keep' | 'accept') =>
    ipcRenderer.invoke('resolve-conflict', recordId, fieldName, action),
  resolveAllConflicts: (recordId: string, action: 'keep' | 'accept') =>
    ipcRenderer.invoke('resolve-all-conflicts', recordId, action),
  // Spotlight UX additions
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  initVault: (folderPath: string) => ipcRenderer.invoke('init-vault', folderPath),
  switchVault: (vaultPath: string) => ipcRenderer.invoke('switch-vault', vaultPath),
  removeVault: (vaultPath: string) => ipcRenderer.invoke('remove-vault', vaultPath),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openFolder: (relativePath: string) => ipcRenderer.invoke('open-folder', relativePath),
  listRecentFolders: (limit?: number) => ipcRenderer.invoke('list-recent-folders', limit),
  listTopFolders: () => ipcRenderer.invoke('list-top-folders'),
  getAggregates: (filters: SearchFilters) => ipcRenderer.invoke('get-aggregates', filters),
  exportFiltered: (filters: SearchFilters) => ipcRenderer.invoke('export-filtered', filters),
  showItemInFolder: (absolutePath: string) => ipcRenderer.invoke('show-item-in-folder', absolutePath),
  checkClaudeCli: () => ipcRenderer.invoke('check-claude-cli'),
  reprocessAll: () => ipcRenderer.invoke('reprocess-all'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  listVaultPaths: (query: string, scope?: string) => ipcRenderer.invoke('list-vault-paths', query, scope),
  onStatusUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: 'idle' | 'processing' | 'review' | 'error') => callback(status);
    ipcRenderer.on('overlay-status-update', listener);
    // Return an unsubscribe function
    return () => ipcRenderer.removeListener('overlay-status-update', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
