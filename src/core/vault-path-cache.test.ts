import { describe, it, expect, beforeEach } from 'vitest';
import { VaultPathCache } from './vault-path-cache';

/**
 * Unit tests for VaultPathCache.
 * We test the query/scoring/sorting logic directly using the add() method
 * to seed the cache without touching the filesystem.
 */

function makeCache(...entries: Array<{ path: string; isDir: boolean }>): VaultPathCache {
  const cache = new VaultPathCache('/fake/root');
  // Mark as built by adding entries
  for (const e of entries) {
    cache.add(e.path, e.isDir);
  }
  // Manually mark as built (since we skip build())
  (cache as any).built = true;
  return cache;
}

describe('VaultPathCache.query', () => {
  describe('bare / (empty query)', () => {
    it('returns top-level dirs and files, dirs first', () => {
      const cache = makeCache(
        { path: 'zebra', isDir: true },
        { path: 'alpha', isDir: true },
        { path: 'alpha/sub', isDir: true },  // nested — should be excluded
        { path: 'readme.txt', isDir: false },
      );
      const results = cache.query('');
      expect(results.map(r => r.relativePath)).toEqual(['alpha', 'zebra', 'readme.txt']);
    });
  });

  describe('prefix match beats fuzzy', () => {
    it('prefix-matched entry scores higher than fuzzy match', () => {
      const cache = makeCache(
        { path: 'invoices', isDir: true },      // prefix match on 'inv'
        { path: 'archive/inventory', isDir: true }, // fuzzy: i-n-v spread
      );
      const results = cache.query('inv');
      // 'invoices' should appear first (prefix match → score ≥ 1000)
      expect(results[0].relativePath).toBe('invoices');
    });
  });

  describe('shorter prefix path scores higher', () => {
    it('top-level folder beats deeply nested folder with same prefix', () => {
      const cache = makeCache(
        { path: 'a/b/c/invoices', isDir: true },
        { path: 'invoices', isDir: true },
      );
      const results = cache.query('inv');
      expect(results[0].relativePath).toBe('invoices');
    });
  });

  describe('dirs before files', () => {
    it('directories appear before files at equal score', () => {
      const cache = makeCache(
        { path: 'report.pdf', isDir: false },
        { path: 'reports', isDir: true },
      );
      const results = cache.query('report');
      expect(results[0].isDir).toBe(true);
      expect(results[1].isDir).toBe(false);
    });
  });

  describe('fuzzy subsequence match', () => {
    it('matches non-contiguous characters in order', () => {
      const cache = makeCache(
        { path: 'q1-invoices', isDir: true },
      );
      const results = cache.query('inv');
      expect(results).toHaveLength(1);
      expect(results[0].relativePath).toBe('q1-invoices');
    });

    it('excludes entries that do not match all query chars', () => {
      const cache = makeCache(
        { path: 'contracts', isDir: true },
      );
      const results = cache.query('inv');
      expect(results).toHaveLength(0);
    });
  });

  describe('path traversal rejection', () => {
    it('returns empty array for queries containing ..', () => {
      const cache = makeCache({ path: 'invoices', isDir: true });
      expect(cache.query('../etc')).toEqual([]);
      expect(cache.query('..')).toEqual([]);
    });
  });

  describe('top-20 cap', () => {
    it('returns at most 20 results', () => {
      const entries = Array.from({ length: 30 }, (_, i) => ({
        path: `folder${String(i).padStart(2, '0')}`,
        isDir: true,
      }));
      const cache = makeCache(...entries);
      const results = cache.query('folder');
      expect(results).toHaveLength(20);
    });
  });

  describe('not-built cache', () => {
    it('returns empty when cache has not been built', () => {
      const cache = new VaultPathCache('/fake/root');
      expect(cache.query('inv')).toEqual([]);
    });
  });
});

describe('VaultPathCache surgical updates', () => {
  let cache: VaultPathCache;

  beforeEach(() => {
    cache = makeCache(
      { path: 'invoices', isDir: true },
      { path: 'invoices/inv001.pdf', isDir: false },
    );
  });

  describe('onFileAdded', () => {
    it('inserts new file so it appears in query results', () => {
      cache.onFileAdded('invoices/inv002.pdf');
      const results = cache.query('inv002');
      expect(results).toHaveLength(1);
      expect(results[0].relativePath).toBe('invoices/inv002.pdf');
    });

    it('maintains sorted order after insert', () => {
      cache.onFileAdded('aaa.pdf');
      cache.onFileAdded('zzz.pdf');
      const all = cache.query('pdf');
      const paths = all.map(r => r.relativePath);
      // Dirs first, then files sorted
      const fileOnly = paths.filter(p => !cache['dirs'].find((d: any) => d.relativePath === p));
      expect(fileOnly).toEqual([...fileOnly].sort());
    });
  });

  describe('onFileDeleted', () => {
    it('removes the file from results', () => {
      cache.onFileDeleted('invoices/inv001.pdf');
      const results = cache.query('inv001');
      expect(results).toHaveLength(0);
    });

    it('is a no-op for non-existent path', () => {
      expect(() => cache.onFileDeleted('does/not/exist.pdf')).not.toThrow();
    });
  });

  describe('add (directory)', () => {
    it('adds a directory and it appears in results', () => {
      cache.add('archive', true);
      const results = cache.query('arch');
      expect(results.some(r => r.relativePath === 'archive' && r.isDir)).toBe(true);
    });
  });

  describe('remove (directory)', () => {
    it('removes a directory', () => {
      cache.remove('invoices', true);
      const results = cache.query('invoices');
      expect(results.every(r => r.relativePath !== 'invoices')).toBe(true);
    });
  });
});

describe('VaultPathCache.query with scope', () => {
  function scopedCache(): VaultPathCache {
    return makeCache(
      { path: '2024', isDir: true },
      { path: '2024/Q1', isDir: true },
      { path: '2024/Q2', isDir: true },
      { path: '2024/Q1/inv001.pdf', isDir: false },
      { path: '2024/Q2/inv002.pdf', isDir: false },
      { path: '2025', isDir: true },
      { path: '2025/Q1', isDir: true },
      { path: '2025/Q1/inv003.pdf', isDir: false },
    );
  }

  it('bare query with scope returns immediate children (dirs and files) of the scope', () => {
    const cache = scopedCache();
    const results = cache.query('', '2024/Q1');
    const paths = results.map(r => r.relativePath);
    expect(paths).toContain('2024/Q1/inv001.pdf');
    expect(paths).not.toContain('2024/Q2/inv002.pdf');
    expect(paths).not.toContain('2025/Q1');
  });

  it('text query with scope only returns entries under scope', () => {
    const cache = scopedCache();
    const results = cache.query('inv', '2024/Q1');
    const paths = results.map(r => r.relativePath);
    expect(paths).toContain('2024/Q1/inv001.pdf');
    expect(paths).not.toContain('2024/Q2/inv002.pdf');
    expect(paths).not.toContain('2025/Q1/inv003.pdf');
  });

  it('scope with trailing slash is handled correctly', () => {
    const cache = scopedCache();
    const results = cache.query('inv', '2024/Q1/');
    const paths = results.map(r => r.relativePath);
    expect(paths).toContain('2024/Q1/inv001.pdf');
    expect(paths).not.toContain('2024/Q2/inv002.pdf');
  });

  it('no scope returns all matching entries', () => {
    const cache = scopedCache();
    const results = cache.query('inv');
    const paths = results.map(r => r.relativePath);
    expect(paths).toContain('2024/Q1/inv001.pdf');
    expect(paths).toContain('2024/Q2/inv002.pdf');
    expect(paths).toContain('2025/Q1/inv003.pdf');
  });
});
