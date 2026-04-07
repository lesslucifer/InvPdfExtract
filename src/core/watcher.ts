import * as fs from 'fs';
import { watch, FSWatcher } from 'chokidar';
import * as path from 'path';
import {
  WATCHED_EXTENSIONS, INVOICEVAULT_DIR, WATCHER_DEBOUNCE_MS,
  INSTRUCTIONS_SUBDIR, EXTRACTION_PROMPT_FILE, JE_INSTRUCTIONS_FILE,
  INSTRUCTIONS_WATCHER_DEBOUNCE_MS,
} from '../shared/constants';
import { eventBus } from './event-bus';

export type WatcherEvent = 'file:added' | 'file:changed' | 'file:deleted';
export type WatcherCallback = (event: WatcherEvent, relativePath: string, fullPath: string) => void;

async function loadIgnorePatterns(vaultRoot: string): Promise<string[]> {
  const ignoreFile = path.join(vaultRoot, '.invoicevaultignore');
  const defaults = ['node_modules', '.git', '.DS_Store', 'Thumbs.db'];

  try {
    const content = await fs.promises.readFile(ignoreFile, 'utf-8');
    const patterns = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    return [...defaults, ...patterns];
  } catch { /* ignore file doesn't exist or can't be read */ }

  return defaults;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private instructionsWatcher: FSWatcher | null = null;
  private vaultRoot: string;
  private callback: WatcherCallback;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(vaultRoot: string, callback: WatcherCallback) {
    this.vaultRoot = vaultRoot;
    this.callback = callback;
  }

  async start(): Promise<void> {
    if (this.watcher) return;

    console.log(`[Watcher] Starting watch on ${this.vaultRoot}`);

    const ignorePatterns = await loadIgnorePatterns(this.vaultRoot);

    this.watcher = watch(this.vaultRoot, {
      ignored: [
        (filePath: string, stats?: fs.Stats) => {
          // Pre-filter files by extension before allocating OS watch descriptors
          if (stats?.isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            if (!WATCHED_EXTENSIONS.has(ext)) return true;
          }
          const rel = path.relative(this.vaultRoot, filePath);
          // Always allow root
          if (rel === '' || rel === '.') return false;
          // Ignore .invoicevault dir
          const parts = rel.split(path.sep);
          if (parts.some(p => p === INVOICEVAULT_DIR)) return true;
          // Check against ignore patterns
          const basename = path.basename(filePath);
          return ignorePatterns.some(pattern => {
            if (pattern.includes('/') || pattern.includes('*')) {
              // Glob-like: simple prefix/suffix match
              return parts.some(p => p === pattern) || rel.startsWith(pattern);
            }
            return parts.some(p => p === pattern) || basename === pattern;
          });
        },
      ],
      ignoreInitial: true,
      depth: 10,
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

    this.startInstructionsWatcher();
  }

  private startInstructionsWatcher(): void {
    const instructionsDir = path.join(this.vaultRoot, INVOICEVAULT_DIR, INSTRUCTIONS_SUBDIR);
    const watchedFiles = new Set([EXTRACTION_PROMPT_FILE, JE_INSTRUCTIONS_FILE]);

    this.instructionsWatcher = watch(instructionsDir, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: INSTRUCTIONS_WATCHER_DEBOUNCE_MS,
        pollInterval: 500,
      },
    });

    this.instructionsWatcher.on('change', (fullPath) => {
      const filename = path.basename(fullPath);
      if (!watchedFiles.has(filename)) return;
      console.log(`[Watcher] Instruction file changed: ${filename}`);
      eventBus.emit('instructions:changed', { file: filename });
    });

    this.instructionsWatcher.on('error', (err) => console.error('[Watcher] Instructions error:', err));
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

    if (this.instructionsWatcher) {
      await this.instructionsWatcher.close();
      this.instructionsWatcher = null;
    }

    console.log('[Watcher] Stopped');
  }
}
