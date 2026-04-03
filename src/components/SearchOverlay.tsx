import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SearchResult, OverlayState } from '../shared/types';
import { SearchInput } from './SearchInput';
import { ResultList } from './ResultList';
import { NoVaultScreen } from './NoVaultScreen';
import { SettingsPanel } from './SettingsPanel';
import { HomeScreen } from './HomeScreen';

const DEBOUNCE_MS = 200;

export const SearchOverlay: React.FC = () => {
  const [overlayState, setOverlayState] = useState<OverlayState>(OverlayState.Home);
  const [previousState, setPreviousState] = useState<OverlayState>(OverlayState.Home);

  // Search state
  const [query, setQuery] = useState('');
  const [folderScope, setFolderScope] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: check if vault exists
  useEffect(() => {
    window.api.getAppConfig().then(config => {
      if (!config.lastVaultPath || !config.vaultPaths || config.vaultPaths.length === 0) {
        setOverlayState(OverlayState.NoVault);
      }
    });
  }, []);

  const goTo = useCallback((state: OverlayState) => {
    setPreviousState(overlayState);
    setOverlayState(state);
  }, [overlayState]);

  const buildSearchQuery = useCallback((text: string, folder: string | null): string => {
    const parts: string[] = [];
    if (folder) parts.push(`in:${folder}`);
    if (text.trim()) parts.push(text.trim());
    return parts.join(' ');
  }, []);

  const doSearch = useCallback(async (text: string, folder: string | null) => {
    const searchQuery = buildSearchQuery(text, folder);
    if (!searchQuery) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    const res = await window.api.search(searchQuery);
    setResults(res);
    setSelectedIndex(0);
    setExpandedId(null);
    setHasSearched(true);
  }, [buildSearchQuery]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Transition to search state when typing
    if (value.trim() && overlayState === OverlayState.Home) {
      setOverlayState(OverlayState.Search);
    }
    // Return to home when clearing (only if no folder scope)
    if (!value.trim() && overlayState === OverlayState.Search && !folderScope) {
      setOverlayState(OverlayState.Home);
      setResults([]);
      setHasSearched(false);
      return;
    }

    debounceRef.current = setTimeout(() => doSearch(value, folderScope), DEBOUNCE_MS);
  }, [doSearch, overlayState, folderScope]);

  const handleFolderBrowse = useCallback((folder: string) => {
    setFolderScope(folder);
    setQuery('');
    goTo(OverlayState.Search);
    // Immediately search for all records in this folder
    doSearch('', folder);
  }, [goTo, doSearch]);

  const handleClearFolderScope = useCallback(() => {
    setFolderScope(null);
    setQuery('');
    setResults([]);
    setHasSearched(false);
    setOverlayState(OverlayState.Home);
  }, []);

  const handleOpenFolder = useCallback((relativePath: string) => {
    window.api.openFolder(relativePath);
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleOpenFile = useCallback((relativePath: string) => {
    window.api.openFile(relativePath);
  }, []);

  const handleFieldUpdated = useCallback(() => {
    if (query.trim() || folderScope) {
      doSearch(query, folderScope);
    }
  }, [query, folderScope, doSearch]);

  const handleVaultCreated = useCallback(() => {
    goTo(OverlayState.Home);
  }, [goTo]);

  const handleSettingsBack = useCallback(() => {
    goTo(previousState === OverlayState.Settings ? OverlayState.Home : previousState);
  }, [goTo, previousState]);

  const handleGearClick = useCallback(() => {
    goTo(OverlayState.Settings);
  }, [goTo]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          if (overlayState === OverlayState.Search || overlayState === OverlayState.Home) {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          }
          break;
        case 'ArrowUp':
          if (overlayState === OverlayState.Search || overlayState === OverlayState.Home) {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case 'Enter':
          if ((overlayState === OverlayState.Search || overlayState === OverlayState.Home) && results[selectedIndex]) {
            e.preventDefault();
            handleToggleExpand(results[selectedIndex].id);
          }
          break;
        case 'Escape':
          e.preventDefault();
          // Escape cascade
          if (overlayState === OverlayState.Settings) {
            handleSettingsBack();
          } else if (expandedId) {
            setExpandedId(null);
          } else if (query) {
            handleQueryChange('');
          } else if (folderScope) {
            handleClearFolderScope();
          } else {
            // Nothing left to undo — close the overlay
            window.api.hideOverlay();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [results, selectedIndex, handleToggleExpand, overlayState, expandedId, query, folderScope, handleQueryChange, handleSettingsBack, handleClearFolderScope]);

  // Render based on state
  if (overlayState === OverlayState.NoVault) {
    return (
      <div className="search-overlay">
        <NoVaultScreen onVaultCreated={handleVaultCreated} />
      </div>
    );
  }

  if (overlayState === OverlayState.Settings) {
    return (
      <div className="search-overlay">
        <SettingsPanel onBack={handleSettingsBack} />
      </div>
    );
  }

  // Home and Search states share the same layout
  return (
    <div className="search-overlay">
      <SearchInput value={query} onChange={handleQueryChange} onGearClick={handleGearClick} />
      {folderScope && (
        <div className="folder-scope-bar">
          <span className="folder-scope-label" onClick={() => handleOpenFolder(folderScope)} role="button" title="Open in Finder">&#x1F4C1; {folderScope}/</span>
          <button className="folder-scope-clear" onClick={handleClearFolderScope} aria-label="Clear folder scope">
            &times;
          </button>
        </div>
      )}
      {overlayState === OverlayState.Home && !hasSearched && (
        <HomeScreen
          onFolderBrowse={handleFolderBrowse}
          onOpenFolder={handleOpenFolder}
          onSettingsClick={handleGearClick}
        />
      )}
      {hasSearched && (
        <ResultList
          results={results}
          selectedIndex={selectedIndex}
          expandedId={expandedId}
          onSelect={setSelectedIndex}
          onToggleExpand={handleToggleExpand}
          onOpenFile={handleOpenFile}
          onFieldUpdated={handleFieldUpdated}
        />
      )}
    </div>
  );
};
