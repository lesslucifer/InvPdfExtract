import { contextBridge, ipcRenderer } from 'electron';
import { InvoiceVaultAPI, FieldOverrideInput } from './shared/types';

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
};

contextBridge.exposeInMainWorld('api', api);
