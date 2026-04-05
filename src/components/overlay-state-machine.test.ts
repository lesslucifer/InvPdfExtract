import { describe, it, expect } from 'vitest';
import { OverlayState, AppConfig } from '../shared/types';

// --- File scope logic ---

interface FileScopeTransition {
  overlayState: OverlayState;
  folderScope: string | null;
  fileScope: string | null;
  query: string;
}

function handleFileBrowse(relativePath: string): FileScopeTransition {
  const parts = relativePath.split('/');
  parts.pop();
  const parentFolder = parts.join('/');
  return {
    overlayState: OverlayState.Search,
    folderScope: parentFolder || null,
    fileScope: relativePath,
    query: '',
  };
}

function handleClearFileScope(folderScope: string | null): FileScopeTransition {
  return {
    overlayState: OverlayState.Search,
    folderScope,
    fileScope: null,
    query: '',
  };
}

function handlePathSearchFileSelect(relativePath: string): FileScopeTransition {
  const parts = relativePath.split('/');
  parts.pop();
  const parentFolder = parts.join('/');
  return {
    overlayState: OverlayState.Search,
    folderScope: parentFolder || null,
    fileScope: relativePath,
    query: '',
  };
}

function handleEscapeWithFileScope(
  expandedId: string | null,
  query: string,
  hasFilterPills: boolean,
  fileScope: string | null,
  folderScope: string | null,
): { clearExpanded?: boolean; clearQuery?: boolean; clearFilters?: boolean; clearFileScope?: boolean; clearFolderScope?: boolean; hideOverlay?: boolean } {
  if (expandedId) return { clearExpanded: true };
  if (query) return { clearQuery: true };
  if (hasFilterPills) return { clearFilters: true };
  if (fileScope) return { clearFileScope: true };
  if (folderScope) return { clearFolderScope: true };
  return { hideOverlay: true };
}

function handleQueryChangeWithFileScope(
  value: string,
  currentState: OverlayState,
  folderScope: string | null,
  fileScope: string | null,
): { newState: OverlayState; shouldClearResults: boolean } {
  if (value.trim() && currentState === OverlayState.Home) {
    return { newState: OverlayState.Search, shouldClearResults: false };
  }
  if (!value.trim() && currentState === OverlayState.Search && !folderScope && !fileScope) {
    return { newState: OverlayState.Home, shouldClearResults: true };
  }
  return { newState: currentState, shouldClearResults: false };
}

// PathSearch trigger: first char is '/'
function isPathSearchTrigger(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\');
}

// PathSearch mode query: text after the leading '/'
function getPathQuery(value: string): string {
  return value.slice(1);
}

// PathSearch escape: always goes to Home
function handlePathSearchEscape(): OverlayState {
  return OverlayState.Home;
}

// PathSearch backspace to empty: return to previous state
function handlePathSearchBackspace(previousState: OverlayState): OverlayState {
  return previousState === OverlayState.PathSearch ? OverlayState.Home : previousState;
}

// PathSearch folder select: goes to Search with folderScope set
function handlePathSearchFolderSelect(relativePath: string): { newState: OverlayState; folderScope: string } {
  return { newState: OverlayState.Search, folderScope: relativePath };
}

/**
 * Tests for the overlay state machine logic.
 *
 * Since the React component can't be rendered in a node environment,
 * we extract and test the state transition logic as pure functions.
 */

// === Extracted state logic (mirrors SearchOverlay.tsx) ===

// --- Folder scope logic (Phase 2) ---

function buildSearchQuery(text: string, folder: string | null): string {
  const parts: string[] = [];
  // folder scope is set separately — not embedded in the query string anymore
  if (folder) parts.push(folder);
  if (text.trim()) parts.push(text.trim());
  return parts.join(' ');
}

interface FolderScopeTransition {
  overlayState: OverlayState;
  folderScope: string | null;
  query: string;
  hasSearched: boolean;
}

function handleFolderBrowse(
  current: FolderScopeTransition,
  folder: string,
): FolderScopeTransition {
  return {
    overlayState: OverlayState.Search,
    folderScope: folder,
    query: '',
    hasSearched: true, // browse triggers immediate search
  };
}

function handleClearFolderScope(): FolderScopeTransition {
  return {
    overlayState: OverlayState.Home,
    folderScope: null,
    query: '',
    hasSearched: false,
  };
}

function handleQueryChangeWithFolder(
  value: string,
  currentState: OverlayState,
  folderScope: string | null,
): { newState: OverlayState; shouldClearResults: boolean } {
  if (value.trim() && currentState === OverlayState.Home) {
    return { newState: OverlayState.Search, shouldClearResults: false };
  }
  if (!value.trim() && currentState === OverlayState.Search && !folderScope) {
    return { newState: OverlayState.Home, shouldClearResults: true };
  }
  return { newState: currentState, shouldClearResults: false };
}

function handleEscapeWithFolder(
  overlayState: OverlayState,
  previousState: OverlayState,
  expandedId: string | null,
  query: string,
  folderScope: string | null,
  hasFilterPills: boolean = false,
): EscapeResult & { clearFolderScope?: boolean; clearFilters?: boolean; hideOverlay?: boolean } {
  if (overlayState === OverlayState.Settings) {
    const backTo = previousState === OverlayState.Settings ? OverlayState.Home : previousState;
    return { newState: backTo };
  }
  if (overlayState === OverlayState.Cheatsheet) {
    const backTo = previousState === OverlayState.Cheatsheet ? OverlayState.Home : previousState;
    return { newState: backTo };
  }
  if (expandedId) {
    return { clearExpanded: true };
  }
  if (query) {
    return { clearQuery: true };
  }
  if (hasFilterPills) {
    return { clearFilters: true };
  }
  if (folderScope) {
    return { clearFolderScope: true };
  }
  // Nothing left to undo — hide the overlay
  return { hideOverlay: true };
}

// --- Original logic ---

function determineInitialState(config: AppConfig): OverlayState {
  if (!config.lastVaultPath || !config.vaultPaths || config.vaultPaths.length === 0) {
    return OverlayState.NoVault;
  }
  return OverlayState.Home;
}

interface StateTransition {
  current: OverlayState;
  previous: OverlayState;
}

function goTo(transition: StateTransition, target: OverlayState): StateTransition {
  return {
    current: target,
    previous: transition.current,
  };
}

type EscapeResult = {
  newState?: OverlayState;
  clearExpanded?: boolean;
  clearQuery?: boolean;
};

function handleEscape(
  overlayState: OverlayState,
  previousState: OverlayState,
  expandedId: string | null,
  query: string,
): EscapeResult {
  if (overlayState === OverlayState.Settings) {
    const backTo = previousState === OverlayState.Settings ? OverlayState.Home : previousState;
    return { newState: backTo };
  }
  if (overlayState === OverlayState.Cheatsheet) {
    const backTo = previousState === OverlayState.Cheatsheet ? OverlayState.Home : previousState;
    return { newState: backTo };
  }
  if (expandedId) {
    return { clearExpanded: true };
  }
  if (query) {
    return { clearQuery: true };
  }
  // Nothing to undo — window blur will hide
  return {};
}

function handleQueryChange(
  value: string,
  currentState: OverlayState,
): OverlayState {
  if (value.trim() && currentState === OverlayState.Home) {
    return OverlayState.Search;
  }
  if (!value.trim() && currentState === OverlayState.Search) {
    return OverlayState.Home;
  }
  return currentState;
}

// === Tests ===

describe('Overlay State Machine', () => {
  describe('determineInitialState', () => {
    it('returns NoVault when lastVaultPath is null', () => {
      const config: AppConfig = {
        lastVaultPath: null,
        claudeCliPath: null,
        vaultPaths: [],
        autoStart: false,
        claudeModels: { pdfExtraction: 'medium', scriptGeneration: 'heavy' },
      };
      expect(determineInitialState(config)).toBe(OverlayState.NoVault);
    });

    it('returns NoVault when vaultPaths is empty', () => {
      const config: AppConfig = {
        lastVaultPath: '/some/path',
        claudeCliPath: null,
        vaultPaths: [],
        autoStart: false,
        claudeModels: { pdfExtraction: 'medium', scriptGeneration: 'heavy' },
      };
      expect(determineInitialState(config)).toBe(OverlayState.NoVault);
    });

    it('returns Home when a vault is configured', () => {
      const config: AppConfig = {
        lastVaultPath: '/Users/test/vault',
        claudeCliPath: null,
        vaultPaths: ['/Users/test/vault'],
        autoStart: false,
        claudeModels: { pdfExtraction: 'medium', scriptGeneration: 'heavy' },
      };
      expect(determineInitialState(config)).toBe(OverlayState.Home);
    });
  });

  describe('goTo (state transitions)', () => {
    it('transitions from Home to Settings, tracking previous', () => {
      const result = goTo(
        { current: OverlayState.Home, previous: OverlayState.Home },
        OverlayState.Settings,
      );
      expect(result.current).toBe(OverlayState.Settings);
      expect(result.previous).toBe(OverlayState.Home);
    });

    it('transitions from NoVault to Home after vault creation', () => {
      const result = goTo(
        { current: OverlayState.NoVault, previous: OverlayState.NoVault },
        OverlayState.Home,
      );
      expect(result.current).toBe(OverlayState.Home);
      expect(result.previous).toBe(OverlayState.NoVault);
    });

    it('transitions from Search to Settings', () => {
      const result = goTo(
        { current: OverlayState.Search, previous: OverlayState.Home },
        OverlayState.Settings,
      );
      expect(result.current).toBe(OverlayState.Settings);
      expect(result.previous).toBe(OverlayState.Search);
    });

    it('transitions from Search to Cheatsheet', () => {
      const result = goTo(
        { current: OverlayState.Search, previous: OverlayState.Home },
        OverlayState.Cheatsheet,
      );
      expect(result.current).toBe(OverlayState.Cheatsheet);
      expect(result.previous).toBe(OverlayState.Search);
    });
  });

  describe('handleEscape (escape cascade)', () => {
    it('returns to previous state when in Settings', () => {
      const result = handleEscape(OverlayState.Settings, OverlayState.Home, null, '');
      expect(result.newState).toBe(OverlayState.Home);
    });

    it('returns to Home when previous was also Settings (safety)', () => {
      const result = handleEscape(OverlayState.Settings, OverlayState.Settings, null, '');
      expect(result.newState).toBe(OverlayState.Home);
    });

    it('returns to Search when settings was opened from Search', () => {
      const result = handleEscape(OverlayState.Settings, OverlayState.Search, null, '');
      expect(result.newState).toBe(OverlayState.Search);
    });

    it('returns to previous state when in Cheatsheet', () => {
      const result = handleEscape(OverlayState.Cheatsheet, OverlayState.Home, null, '');
      expect(result.newState).toBe(OverlayState.Home);
    });

    it('returns to Home when previous was also Cheatsheet (safety)', () => {
      const result = handleEscape(OverlayState.Cheatsheet, OverlayState.Cheatsheet, null, '');
      expect(result.newState).toBe(OverlayState.Home);
    });

    it('returns to Search when cheatsheet was opened from Search', () => {
      const result = handleEscape(OverlayState.Cheatsheet, OverlayState.Search, null, '');
      expect(result.newState).toBe(OverlayState.Search);
    });

    it('collapses expanded detail before clearing query', () => {
      const result = handleEscape(OverlayState.Search, OverlayState.Home, 'record-123', 'test query');
      expect(result.clearExpanded).toBe(true);
      expect(result.clearQuery).toBeUndefined();
      expect(result.newState).toBeUndefined();
    });

    it('clears query when no detail is expanded', () => {
      const result = handleEscape(OverlayState.Search, OverlayState.Home, null, 'test query');
      expect(result.clearQuery).toBe(true);
      expect(result.clearExpanded).toBeUndefined();
    });

    it('returns empty when nothing to undo (Home, no query, no expanded)', () => {
      const result = handleEscape(OverlayState.Home, OverlayState.Home, null, '');
      expect(result.newState).toBeUndefined();
      expect(result.clearExpanded).toBeUndefined();
      expect(result.clearQuery).toBeUndefined();
    });
  });

  describe('handleQueryChange (auto state transitions)', () => {
    it('transitions Home -> Search when user types', () => {
      const newState = handleQueryChange('hello', OverlayState.Home);
      expect(newState).toBe(OverlayState.Search);
    });

    it('transitions Search -> Home when query is cleared', () => {
      const newState = handleQueryChange('', OverlayState.Search);
      expect(newState).toBe(OverlayState.Home);
    });

    it('stays in Search when query changes but stays non-empty', () => {
      const newState = handleQueryChange('new query', OverlayState.Search);
      expect(newState).toBe(OverlayState.Search);
    });

    it('stays in Home when query remains empty', () => {
      const newState = handleQueryChange('', OverlayState.Home);
      expect(newState).toBe(OverlayState.Home);
    });

    it('does not transition from Settings when typing', () => {
      const newState = handleQueryChange('hello', OverlayState.Settings);
      expect(newState).toBe(OverlayState.Settings);
    });

    it('does not transition from NoVault when typing', () => {
      const newState = handleQueryChange('hello', OverlayState.NoVault);
      expect(newState).toBe(OverlayState.NoVault);
    });

    it('treats whitespace-only as empty', () => {
      const newState = handleQueryChange('   ', OverlayState.Search);
      expect(newState).toBe(OverlayState.Home);
    });
  });

  // === Phase 2: Folder Scope Tests ===

  describe('buildSearchQuery', () => {
    it('returns folder path when no text', () => {
      expect(buildSearchQuery('', '2024/Q1')).toBe('2024/Q1');
    });

    it('returns text-only query when no folder', () => {
      expect(buildSearchQuery('invoice', null)).toBe('invoice');
    });

    it('combines folder and text', () => {
      expect(buildSearchQuery('invoice', '2024/Q1')).toBe('2024/Q1 invoice');
    });

    it('returns empty string when both are empty', () => {
      expect(buildSearchQuery('', null)).toBe('');
    });

    it('trims text whitespace', () => {
      expect(buildSearchQuery('  invoice  ', null)).toBe('invoice');
    });
  });

  describe('handleFolderBrowse', () => {
    it('sets folderScope and transitions to Search', () => {
      const result = handleFolderBrowse(
        { overlayState: OverlayState.Home, folderScope: null, query: '', hasSearched: false },
        '2024/Q1',
      );
      expect(result.overlayState).toBe(OverlayState.Search);
      expect(result.folderScope).toBe('2024/Q1');
      expect(result.query).toBe('');
      expect(result.hasSearched).toBe(true);
    });
  });

  describe('handleClearFolderScope', () => {
    it('returns to Home with cleared state', () => {
      const result = handleClearFolderScope();
      expect(result.overlayState).toBe(OverlayState.Home);
      expect(result.folderScope).toBeNull();
      expect(result.query).toBe('');
      expect(result.hasSearched).toBe(false);
    });
  });

  describe('handleQueryChangeWithFolder (folder-aware transitions)', () => {
    it('does not return to Home when clearing query with active folder scope', () => {
      const result = handleQueryChangeWithFolder('', OverlayState.Search, '2024/Q1');
      expect(result.newState).toBe(OverlayState.Search);
      expect(result.shouldClearResults).toBe(false);
    });

    it('returns to Home when clearing query without folder scope', () => {
      const result = handleQueryChangeWithFolder('', OverlayState.Search, null);
      expect(result.newState).toBe(OverlayState.Home);
      expect(result.shouldClearResults).toBe(true);
    });

    it('transitions Home -> Search when typing with folder scope', () => {
      const result = handleQueryChangeWithFolder('test', OverlayState.Home, '2024/Q1');
      expect(result.newState).toBe(OverlayState.Search);
    });
  });

  describe('handleEscapeWithFolder (extended escape cascade)', () => {
    it('clears folder scope after clearing query', () => {
      const result = handleEscapeWithFolder(
        OverlayState.Search, OverlayState.Home, null, '', '2024/Q1',
      );
      expect(result.clearFolderScope).toBe(true);
      expect(result.clearQuery).toBeUndefined();
    });

    it('clears query before clearing folder scope', () => {
      const result = handleEscapeWithFolder(
        OverlayState.Search, OverlayState.Home, null, 'test', '2024/Q1',
      );
      expect(result.clearQuery).toBe(true);
      expect(result.clearFolderScope).toBeUndefined();
    });

    it('collapses expanded before clearing query or folder', () => {
      const result = handleEscapeWithFolder(
        OverlayState.Search, OverlayState.Home, 'rec-1', 'test', '2024/Q1',
      );
      expect(result.clearExpanded).toBe(true);
      expect(result.clearQuery).toBeUndefined();
      expect(result.clearFolderScope).toBeUndefined();
    });

    it('hides overlay when nothing to undo', () => {
      const result = handleEscapeWithFolder(
        OverlayState.Home, OverlayState.Home, null, '', null,
      );
      expect(result.hideOverlay).toBe(true);
      expect(result.clearFolderScope).toBeUndefined();
      expect(result.clearQuery).toBeUndefined();
      expect(result.clearExpanded).toBeUndefined();
      expect(result.newState).toBeUndefined();
    });

    it('clears filter pills after clearing query but before clearing folder', () => {
      const result = handleEscapeWithFolder(
        OverlayState.Search, OverlayState.Home, null, '', '2024/Q1', true,
      );
      expect(result.clearFilters).toBe(true);
      expect(result.clearFolderScope).toBeUndefined();
      expect(result.clearQuery).toBeUndefined();
    });

    it('clears query before clearing filter pills', () => {
      const result = handleEscapeWithFolder(
        OverlayState.Search, OverlayState.Home, null, 'test', '2024/Q1', true,
      );
      expect(result.clearQuery).toBe(true);
      expect(result.clearFilters).toBeUndefined();
    });

    it('clears filter pills when no folder scope or query', () => {
      const result = handleEscapeWithFolder(
        OverlayState.Search, OverlayState.Home, null, '', null, true,
      );
      expect(result.clearFilters).toBe(true);
      expect(result.hideOverlay).toBeUndefined();
    });
  });

  // === Phase 6: PathSearch State Machine ===

  describe('isPathSearchTrigger', () => {
    it('triggers on leading /', () => {
      expect(isPathSearchTrigger('/')).toBe(true);
      expect(isPathSearchTrigger('/invoices')).toBe(true);
    });

    it('triggers on leading \\', () => {
      expect(isPathSearchTrigger('\\')).toBe(true);
      expect(isPathSearchTrigger('\\invoices')).toBe(true);
    });

    it('does not trigger on normal text', () => {
      expect(isPathSearchTrigger('invoices')).toBe(false);
      expect(isPathSearchTrigger('')).toBe(false);
      expect(isPathSearchTrigger('abc/def')).toBe(false);
    });
  });

  describe('getPathQuery', () => {
    it('strips leading slash', () => {
      expect(getPathQuery('/inv2024')).toBe('inv2024');
      expect(getPathQuery('/')).toBe('');
    });
  });

  describe('handlePathSearchEscape', () => {
    it('always returns Home', () => {
      expect(handlePathSearchEscape()).toBe(OverlayState.Home);
    });
  });

  describe('handlePathSearchBackspace', () => {
    it('returns to Home when previous was Home', () => {
      expect(handlePathSearchBackspace(OverlayState.Home)).toBe(OverlayState.Home);
    });

    it('returns to Search when previous was Search', () => {
      expect(handlePathSearchBackspace(OverlayState.Search)).toBe(OverlayState.Search);
    });

    it('returns Home when previous was PathSearch (safety)', () => {
      expect(handlePathSearchBackspace(OverlayState.PathSearch)).toBe(OverlayState.Home);
    });
  });

  describe('handlePathSearchFolderSelect', () => {
    it('transitions to Search and sets folderScope', () => {
      const result = handlePathSearchFolderSelect('2024/Q1');
      expect(result.newState).toBe(OverlayState.Search);
      expect(result.folderScope).toBe('2024/Q1');
    });
  });

  // === File Scope Tests ===

  describe('handleFileBrowse', () => {
    it('sets fileScope and derives parent folder', () => {
      const result = handleFileBrowse('2024/Q1/invoice.pdf');
      expect(result.overlayState).toBe(OverlayState.Search);
      expect(result.fileScope).toBe('2024/Q1/invoice.pdf');
      expect(result.folderScope).toBe('2024/Q1');
      expect(result.query).toBe('');
    });

    it('handles file in root (no parent folder)', () => {
      const result = handleFileBrowse('invoice.pdf');
      expect(result.fileScope).toBe('invoice.pdf');
      expect(result.folderScope).toBeNull();
    });

    it('handles deeply nested file', () => {
      const result = handleFileBrowse('a/b/c/d/file.xlsx');
      expect(result.fileScope).toBe('a/b/c/d/file.xlsx');
      expect(result.folderScope).toBe('a/b/c/d');
    });
  });

  describe('handleClearFileScope', () => {
    it('clears fileScope but keeps folderScope', () => {
      const result = handleClearFileScope('2024/Q1');
      expect(result.fileScope).toBeNull();
      expect(result.folderScope).toBe('2024/Q1');
      expect(result.overlayState).toBe(OverlayState.Search);
    });

    it('clears fileScope with null folderScope', () => {
      const result = handleClearFileScope(null);
      expect(result.fileScope).toBeNull();
      expect(result.folderScope).toBeNull();
    });
  });

  describe('handlePathSearchFileSelect', () => {
    it('sets fileScope and derives parent folder from path', () => {
      const result = handlePathSearchFileSelect('invoices/2024/receipt.pdf');
      expect(result.overlayState).toBe(OverlayState.Search);
      expect(result.fileScope).toBe('invoices/2024/receipt.pdf');
      expect(result.folderScope).toBe('invoices/2024');
      expect(result.query).toBe('');
    });
  });

  describe('handleEscapeWithFileScope', () => {
    it('clears fileScope before folderScope', () => {
      const result = handleEscapeWithFileScope(null, '', false, '2024/Q1/file.pdf', '2024/Q1');
      expect(result.clearFileScope).toBe(true);
      expect(result.clearFolderScope).toBeUndefined();
    });

    it('clears folderScope after fileScope is already null', () => {
      const result = handleEscapeWithFileScope(null, '', false, null, '2024/Q1');
      expect(result.clearFolderScope).toBe(true);
      expect(result.clearFileScope).toBeUndefined();
    });

    it('clears query before fileScope', () => {
      const result = handleEscapeWithFileScope(null, 'test', false, '2024/Q1/file.pdf', '2024/Q1');
      expect(result.clearQuery).toBe(true);
      expect(result.clearFileScope).toBeUndefined();
    });

    it('clears filter pills before fileScope', () => {
      const result = handleEscapeWithFileScope(null, '', true, '2024/Q1/file.pdf', '2024/Q1');
      expect(result.clearFilters).toBe(true);
      expect(result.clearFileScope).toBeUndefined();
    });

    it('hides overlay when nothing to undo', () => {
      const result = handleEscapeWithFileScope(null, '', false, null, null);
      expect(result.hideOverlay).toBe(true);
    });
  });

  describe('handleQueryChangeWithFileScope', () => {
    it('stays in Search when clearing query with active fileScope', () => {
      const result = handleQueryChangeWithFileScope('', OverlayState.Search, null, 'file.pdf');
      expect(result.newState).toBe(OverlayState.Search);
      expect(result.shouldClearResults).toBe(false);
    });

    it('stays in Search when clearing query with active folderScope', () => {
      const result = handleQueryChangeWithFileScope('', OverlayState.Search, '2024/Q1', null);
      expect(result.newState).toBe(OverlayState.Search);
      expect(result.shouldClearResults).toBe(false);
    });

    it('returns to Home when clearing query with no scope at all', () => {
      const result = handleQueryChangeWithFileScope('', OverlayState.Search, null, null);
      expect(result.newState).toBe(OverlayState.Home);
      expect(result.shouldClearResults).toBe(true);
    });
  });

  // === Modifier-Click Dispatch Logic ===

  describe('modifier-click dispatch', () => {
    type ClickAction = 'scope' | 'open' | 'reprocess';

    function resolveClickAction(metaOrCtrl: boolean, alt: boolean): ClickAction {
      if (metaOrCtrl) return 'open';
      if (alt) return 'reprocess';
      return 'scope';
    }

    it('normal click → scope (set active filter)', () => {
      expect(resolveClickAction(false, false)).toBe('scope');
    });

    it('Cmd/Ctrl+click → open in Finder', () => {
      expect(resolveClickAction(true, false)).toBe('open');
    });

    it('Alt/Option+click → reprocess', () => {
      expect(resolveClickAction(false, true)).toBe('reprocess');
    });

    it('Cmd+Alt+click → open takes priority', () => {
      expect(resolveClickAction(true, true)).toBe('open');
    });
  });

  describe('breadcrumb reload', () => {
    function breadcrumbReloadTarget(fileScope: string | null, folderScope: string | null): { type: 'file' | 'folder'; path: string } | null {
      if (fileScope) return { type: 'file', path: fileScope };
      if (folderScope) return { type: 'folder', path: folderScope };
      return null;
    }

    it('reloads file when fileScope is active', () => {
      const result = breadcrumbReloadTarget('2024/Q1/invoice.pdf', '2024/Q1');
      expect(result).toEqual({ type: 'file', path: '2024/Q1/invoice.pdf' });
    });

    it('reloads folder when only folderScope is active', () => {
      const result = breadcrumbReloadTarget(null, '2024/Q1');
      expect(result).toEqual({ type: 'folder', path: '2024/Q1' });
    });

    it('returns null when no scope is active', () => {
      const result = breadcrumbReloadTarget(null, null);
      expect(result).toBeNull();
    });

    it('prefers file over folder when both active', () => {
      const result = breadcrumbReloadTarget('2024/Q1/file.pdf', '2024/Q1');
      expect(result!.type).toBe('file');
    });
  });

  // === Reprocess Confirmation Logic ===

  describe('shouldConfirmReprocess', () => {
    function shouldConfirmReprocess(fileCount: number): boolean {
      return fileCount > 10;
    }

    it('returns false for 1 file', () => {
      expect(shouldConfirmReprocess(1)).toBe(false);
    });

    it('returns false for 10 files (boundary)', () => {
      expect(shouldConfirmReprocess(10)).toBe(false);
    });

    it('returns true for 11 files', () => {
      expect(shouldConfirmReprocess(11)).toBe(true);
    });

    it('returns true for 100 files', () => {
      expect(shouldConfirmReprocess(100)).toBe(true);
    });
  });
});
