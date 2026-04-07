import * as fs from 'fs';
import * as path from 'path';
import { IGNORED_DIRS } from '../shared/constants';
import { normalizeQuery } from '../shared/normalize-query';

const MAX_DEPTH = 10;
const MAX_RESULTS = 20;

export interface PathEntry {
  relativePath: string;
  lowerPath: string;
  name: string;
  lowerName: string;
  isDir: boolean;
}

interface ScoredEntry {
  entry: PathEntry;
  score: number;
}

function scoreEntry(entry: PathEntry, q: string): number {
  if (!q) return 1; // bare '/' — include everything

  // Tier 1: prefix match on path or name
  if (entry.lowerPath.startsWith(q) || entry.lowerName.startsWith(q)) {
    return 1000 + (1000 - Math.min(entry.lowerPath.length, 999));
  }

  // Tier 2: fuzzy subsequence — score = sum of contiguous run lengths
  let score = 0;
  let qi = 0;
  let run = 0;

  for (let i = 0; i < entry.lowerPath.length && qi < q.length; i++) {
    if (entry.lowerPath[i] === q[qi]) {
      qi++;
      run++;
      score += run; // longer runs worth more
    } else {
      run = 0;
    }
  }

  if (qi < q.length) return 0; // not all chars matched — exclude

  return score;
}

export class VaultPathCache {
  private vaultRoot: string;
  private dirs: PathEntry[] = [];
  private files: PathEntry[] = [];
  private built = false;

  constructor(vaultRoot: string) {
    this.vaultRoot = vaultRoot;
  }

  /** Build the cache asynchronously in the background. Never throws — logs errors. */
  async build(): Promise<void> {
    const newDirs: PathEntry[] = [];
    const newFiles: PathEntry[] = [];

    try {
      await this.walkDir(this.vaultRoot, '', 0, newDirs, newFiles);
    } catch (err) {
      console.error('[VaultPathCache] Build error:', err);
    }

    newDirs.sort((a, b) => a.lowerPath.localeCompare(b.lowerPath));
    newFiles.sort((a, b) => a.lowerPath.localeCompare(b.lowerPath));

    this.dirs = newDirs;
    this.files = newFiles;
    this.built = true;

    console.log(`[VaultPathCache] Built: ${this.dirs.length} dirs, ${this.files.length} files`);
  }

  private async walkDir(
    absDir: string,
    relDir: string,
    depth: number,
    dirs: PathEntry[],
    files: PathEntry[],
  ): Promise<void> {
    if (depth > MAX_DEPTH) return;

    let handle: fs.Dir;
    try {
      handle = await fs.promises.opendir(absDir);
    } catch {
      return;
    }

    try {
      for await (const entry of handle) {
        if (entry.name.startsWith('.')) continue;
        if (IGNORED_DIRS.includes(entry.name)) continue;

        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        const absPath = path.join(absDir, entry.name);

        if (entry.isDirectory()) {
          const pEntry: PathEntry = {
            relativePath: relPath,
            lowerPath: normalizeQuery(relPath),
            name: entry.name,
            lowerName: normalizeQuery(entry.name),
            isDir: true,
          };
          dirs.push(pEntry);
          await this.walkDir(absPath, relPath, depth + 1, dirs, files);
        } else if (entry.isFile()) {
          const pEntry: PathEntry = {
            relativePath: relPath,
            lowerPath: normalizeQuery(relPath),
            name: entry.name,
            lowerName: normalizeQuery(entry.name),
            isDir: false,
          };
          files.push(pEntry);
        }
      }
    } finally {
      try { await handle.close(); } catch { /* ignore */ }
    }
  }

  /**
   * Query the cache.
   * @param rawQuery — text after the leading `/`
   * @param scope — optional folder scope; when set, only entries under this prefix are returned
   */
  query(rawQuery: string, scope?: string): Array<{ name: string; relativePath: string; isDir: boolean }> {
    if (!this.built) return [];

    // Guard against path traversal
    if (rawQuery.includes('..')) return [];

    const q = normalizeQuery(rawQuery);
    const scopePrefix = scope ? normalizeQuery(scope).replace(/\/$/, '') + '/' : null;

    const inScope = (entry: PathEntry): boolean => {
      if (!scopePrefix) return true;
      return entry.lowerPath.startsWith(scopePrefix);
    };

    if (!q) {
      // Bare '/' — return immediate children of scope (or top-level dirs if no scope)
      const targetDepth = scopePrefix ? scopePrefix.split('/').length : 1;
      return this.dirs
        .filter(e => inScope(e) && e.relativePath.split('/').length === targetDepth)
        .slice(0, MAX_RESULTS)
        .map(e => ({ name: e.name, relativePath: e.relativePath, isDir: true }));
    }

    const scored: ScoredEntry[] = [];

    for (const entry of this.dirs) {
      if (!inScope(entry)) continue;
      const score = scoreEntry(entry, q);
      if (score > 0) scored.push({ entry, score });
    }

    // Track how many dirs we have — dirs come first
    const dirCount = scored.length;

    for (const entry of this.files) {
      if (!inScope(entry)) continue;
      const score = scoreEntry(entry, q);
      if (score > 0) scored.push({ entry, score });
    }

    // Sort dirs section and files section independently by score desc then alpha
    const dirResults = scored.slice(0, dirCount).sort((a, b) =>
      b.score - a.score || a.entry.lowerPath.localeCompare(b.entry.lowerPath)
    );
    const fileResults = scored.slice(dirCount).sort((a, b) =>
      b.score - a.score || a.entry.lowerPath.localeCompare(b.entry.lowerPath)
    );

    return [...dirResults, ...fileResults]
      .slice(0, MAX_RESULTS)
      .map(({ entry }) => ({ name: entry.name, relativePath: entry.relativePath, isDir: entry.isDir }));
  }

  /** Surgical insert on file:added or dir creation. */
  add(relativePath: string, isDir: boolean): void {
    const name = path.basename(relativePath);
    const lowerPath = normalizeQuery(relativePath);
    const lowerName = normalizeQuery(name);
    const entry: PathEntry = { relativePath, lowerPath, name, lowerName, isDir };

    const arr = isDir ? this.dirs : this.files;
    // Binary insert to keep sorted
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].lowerPath < lowerPath) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, entry);
  }

  /** Surgical remove on file:deleted. */
  remove(relativePath: string, isDir: boolean): void {
    const arr = isDir ? this.dirs : this.files;
    const lowerPath = normalizeQuery(relativePath);
    const idx = arr.findIndex(e => e.lowerPath === lowerPath);
    if (idx !== -1) arr.splice(idx, 1);
  }

  /** Called on file:added watcher event (files only). */
  onFileAdded(relativePath: string): void {
    this.add(relativePath, false);
  }

  /** Called on file:deleted watcher event (files only). */
  onFileDeleted(relativePath: string): void {
    this.remove(relativePath, false);
  }

  get isReady(): boolean {
    return this.built;
  }
}
