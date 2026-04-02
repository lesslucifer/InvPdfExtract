import { watch, FSWatcher } from 'chokidar';
import * as path from 'path';
import { WATCHED_EXTENSIONS, INVOICEVAULT_DIR, WATCHER_DEBOUNCE_MS } from '../shared/constants';

export type WatcherEvent = 'file:added' | 'file:changed' | 'file:deleted';
export type WatcherCallback = (event: WatcherEvent, relativePath: string, fullPath: string) => void;

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private vaultRoot: string;
  private callback: WatcherCallback;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(vaultRoot: string, callback: WatcherCallback) {
    this.vaultRoot = vaultRoot;
    this.callback = callback;
  }

  start(): void {
    if (this.watcher) return;

    console.log(`[Watcher] Starting watch on ${this.vaultRoot}`);

    this.watcher = watch(this.vaultRoot, {
      ignored: [
        (filePath: string) => {
          const rel = path.relative(this.vaultRoot, filePath);
          // Always allow root
          if (rel === '' || rel === '.') return false;
          // Ignore hidden dirs and files, node_modules, .git, .invoicevault
          const parts = rel.split(path.sep);
          return parts.some(p =>
            p === INVOICEVAULT_DIR || p === 'node_modules' || p === '.git' || p.startsWith('.')
          );
        },
      ],
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: WATCHER_DEBOUNCE_MS,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (fullPath) => this.handleEvent('file:added', fullPath));
    this.watcher.on('change', (fullPath) => this.handleEvent('file:changed', fullPath));
    this.watcher.on('unlink', (fullPath) => this.handleEvent('file:deleted', fullPath));
    this.watcher.on('error', (err) => console.error('[Watcher] Error:', err));
  }

  private handleEvent(event: WatcherEvent, fullPath: string): void {
    const ext = path.extname(fullPath).toLowerCase();
    if (!WATCHED_EXTENSIONS.has(ext)) return;

    const relativePath = path.relative(this.vaultRoot, fullPath);

    // Debounce per file
    const key = `${event}:${relativePath}`;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      console.log(`[Watcher] ${event}: ${relativePath}`);
      this.callback(event, relativePath, fullPath);
    }, WATCHER_DEBOUNCE_MS));
  }

  async stop(): Promise<void> {
    if (!this.watcher) return;

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    await this.watcher.close();
    this.watcher = null;
    console.log('[Watcher] Stopped');
  }
}
