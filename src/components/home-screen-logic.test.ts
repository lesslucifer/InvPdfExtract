import { describe, it, expect } from 'vitest';
import { FolderInfo } from '../shared/types';

/**
 * Tests for HomeScreen display logic.
 *
 * Since the React component can't be rendered in a node environment,
 * we extract and test the display/selection logic as pure functions.
 */

// === Extracted display logic (mirrors HomeScreen.tsx) ===

interface HomeScreenDisplay {
  recentFolders: FolderInfo[];
  supplementFolders: FolderInfo[];
  topFolders: FolderInfo[];
  showEmptyState: boolean;
}

function computeHomeDisplay(
  recentFolders: FolderInfo[],
  topFolders: FolderInfo[],
): HomeScreenDisplay {
  const hasRecent = recentFolders.length > 0;
  const hasTop = topFolders.length > 0;

  const recentPaths = new Set(recentFolders.map(f => f.path));
  const supplementFolders = recentFolders.length < 3
    ? topFolders.filter(f => !recentPaths.has(f.path))
    : [];

  return {
    recentFolders,
    supplementFolders,
    topFolders,
    showEmptyState: !hasRecent && !hasTop,
  };
}

// === Tests ===

function makeFolder(path: string, recordCount: number, lastActive: string = '2024-01-01'): FolderInfo {
  return { path, recordCount, lastActive };
}

describe('HomeScreen display logic', () => {
  describe('computeHomeDisplay', () => {
    it('shows empty state when no folders at all', () => {
      const result = computeHomeDisplay([], []);
      expect(result.showEmptyState).toBe(true);
      expect(result.recentFolders).toHaveLength(0);
      expect(result.supplementFolders).toHaveLength(0);
    });

    it('shows recent folders when available', () => {
      const recent = [
        makeFolder('2024/Q1', 38),
        makeFolder('2024/Q2', 12),
        makeFolder('2024/Q3', 5),
      ];
      const top = [makeFolder('2024', 55)];
      const result = computeHomeDisplay(recent, top);

      expect(result.showEmptyState).toBe(false);
      expect(result.recentFolders).toHaveLength(3);
      expect(result.supplementFolders).toHaveLength(0); // >= 3 recent, no supplement
    });

    it('supplements with top folders when fewer than 3 recent', () => {
      const recent = [makeFolder('2024/Q1', 38)];
      const top = [
        makeFolder('2024', 55),
        makeFolder('2023', 20),
      ];
      const result = computeHomeDisplay(recent, top);

      expect(result.showEmptyState).toBe(false);
      expect(result.recentFolders).toHaveLength(1);
      expect(result.supplementFolders).toHaveLength(2); // both top folders supplement
    });

    it('does not duplicate folders in supplement', () => {
      const recent = [makeFolder('2024', 38)];
      const top = [
        makeFolder('2024', 38),  // same as recent
        makeFolder('2023', 20),
      ];
      const result = computeHomeDisplay(recent, top);

      expect(result.supplementFolders).toHaveLength(1);
      expect(result.supplementFolders[0].path).toBe('2023');
    });

    it('shows only top folders when no recent', () => {
      const top = [makeFolder('2024', 55), makeFolder('2023', 20)];
      const result = computeHomeDisplay([], top);

      expect(result.showEmptyState).toBe(false);
      expect(result.recentFolders).toHaveLength(0);
      expect(result.supplementFolders).toHaveLength(2);
      expect(result.topFolders).toHaveLength(2);
    });

    it('shows exactly 3 recent with no supplement', () => {
      const recent = [
        makeFolder('2024/Q1', 38),
        makeFolder('2024/Q2', 12),
        makeFolder('2024/Q3', 5),
      ];
      const top = [makeFolder('2024', 55), makeFolder('2023', 20)];
      const result = computeHomeDisplay(recent, top);

      expect(result.supplementFolders).toHaveLength(0);
    });

    it('supplements when exactly 2 recent', () => {
      const recent = [
        makeFolder('2024/Q1', 38),
        makeFolder('2024/Q2', 12),
      ];
      const top = [makeFolder('2024', 55)];
      const result = computeHomeDisplay(recent, top);

      expect(result.supplementFolders).toHaveLength(1);
      expect(result.supplementFolders[0].path).toBe('2024');
    });
  });
});
