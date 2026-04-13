import * as fs from 'fs';
import * as path from 'path';
import { OverlayState } from '../shared/types';
import type { ParsedQuery } from '../shared/parse-query';
import { log, LogModule } from './logger';

const STATE_FILENAME = 'window-state.json';

export interface PersistedUIState {
  overlayState: OverlayState;
  query: string;
  filters: ParsedQuery;
  folderScope: string | null;
  fileScope: string | null;
  expandedId: string | null;
}

export interface PersistedWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PersistedSpawnedWindow {
  geometry: PersistedWindowGeometry;
  uiState: PersistedUIState;
}

export interface WindowState {
  overlayGeometry: PersistedWindowGeometry | null;
  overlayUIState: PersistedUIState | null;
  spawnedWindows: PersistedSpawnedWindow[];
}

const DEFAULT_STATE: WindowState = {
  overlayGeometry: null,
  overlayUIState: null,
  spawnedWindows: [],
};

const TRANSIENT_STATES = new Set([
  OverlayState.NoVault,
  OverlayState.DbError,
  OverlayState.PathSearch,
  OverlayState.PresetSearch,
]);

export function getVaultStatePath(dotPath: string): string {
  return path.join(dotPath, STATE_FILENAME);
}

// Per-path write queue to prevent concurrent read-merge-write races
const writeQueues = new Map<string, Promise<void>>();

function enqueue(statePath: string, task: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(statePath) ?? Promise.resolve();
  const next = prev.then(task).catch(err => log.error(LogModule.Overlay, 'Window state write failed', err));
  writeQueues.set(statePath, next);
  next.then(() => { if (writeQueues.get(statePath) === next) writeQueues.delete(statePath); });
  return next;
}

export async function loadWindowState(statePath: string): Promise<WindowState> {
  try {
    const raw = await fs.promises.readFile(statePath, 'utf-8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveWindowState(statePath: string, patch: Partial<WindowState>): Promise<void> {
  return enqueue(statePath, async () => {
    const existing = await loadWindowState(statePath);
    const merged = { ...existing, ...patch };
    await fs.promises.writeFile(statePath, JSON.stringify(merged, null, 2));
  });
}

export function saveWindowStateSync(statePath: string, patch: Partial<WindowState>): void {
  try {
    let existing: WindowState = { ...DEFAULT_STATE };
    try {
      const raw = fs.readFileSync(statePath, 'utf-8');
      existing = { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch { /* use defaults */ }
    const merged = { ...existing, ...patch };
    fs.writeFileSync(statePath, JSON.stringify(merged, null, 2));
  } catch (err) {
    log.error(LogModule.Overlay, 'Sync window state save failed', err);
  }
}

export function sanitizeUIState(raw: Partial<PersistedUIState>): PersistedUIState {
  const overlayState = (raw.overlayState && !TRANSIENT_STATES.has(raw.overlayState))
    ? raw.overlayState
    : OverlayState.Home;
  return {
    overlayState,
    query: typeof raw.query === 'string' ? raw.query : '',
    filters: (raw.filters && typeof raw.filters === 'object') ? raw.filters : { text: '' },
    folderScope: raw.folderScope ?? null,
    fileScope: raw.fileScope ?? null,
    expandedId: raw.expandedId ?? null,
  };
}
