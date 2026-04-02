import { contextBridge, ipcRenderer } from 'electron';
import { InvoiceVaultAPI } from './shared/types';

const api: InvoiceVaultAPI = {
  search: (query: string) => ipcRenderer.invoke('search', query),
  openFile: (relativePath: string) => ipcRenderer.invoke('open-file', relativePath),
  getLineItems: (recordId: string) => ipcRenderer.invoke('get-line-items', recordId),
};

contextBridge.exposeInMainWorld('api', api);
