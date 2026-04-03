import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SearchResult, OverlayState, AggregateStats, SearchFilters } from '../shared/types';
import { parseSearchQuery, buildQueryString, ParsedQuery } from '../shared/parse-query';
import { SearchInput } from './SearchInput';
import { FilterPills } from './FilterPills';
import { BreadcrumbBar } from './BreadcrumbBar';
import { ResultList } from './ResultList';
import { NoVaultScreen } from './NoVaultScreen';
import { SettingsPanel } from './SettingsPanel';
import { HomeScreen } from './HomeScreen';
import { StickyFooter } from './StickyFooter';

const DEBOUNCE_MS = 200;

export const SearchOverlay: React.FC = () => {
  const [overlayState, setOverlayState] = useState<OverlayState>(OverlayState.Home);
  const [previousState, setPreviousState] = useState<OverlayState>(OverlayState.Home);

  // Search state — query is the free text only (filters are separate)
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ParsedQuery>({ text: '' });
  const [folderScope, setFolderScope] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [aggregates, setAggregates] = useState<AggregateStats>({ totalRecords: 0, totalAmount: 0 });
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

  // Build the full query string from free text + structured filters + folder scope
  const buildFullQuery = useCallback((text: string, currentFilters: ParsedQuery, folder: string | null): string => {
    const merged: ParsedQuery = {
      ...currentFilters,
      text: text.trim(),
      folder: folder || undefined,
    };
    return buildQueryString(merged);
  }, []);

  // Build SearchFilters object for IPC calls (aggregates, export)
  const buildSearchFilters = useCallback((text: string, currentFilters: ParsedQuery, folder: string | null): SearchFilters => ({
    text: text.trim() || undefined,
    folder: folder || undefined,
    docType: currentFilters.docType,
    status: currentFilters.status,
    amountMin: currentFilters.amountMin,
    amountMax: currentFilters.amountMax,
    dateFilter: currentFilters.dateFilter,
  }), []);

  const doSearch = useCallback(async (text: string, currentFilters: ParsedQuery, folder: string | null) => {
    const searchQuery = buildFullQuery(text, currentFilters, folder);
    if (!searchQuery) {
      setResults([]);
      setHasSearched(false);
      setAggregates({ totalRecords: 0, totalAmount: 0 });
      return;
    }
    const sf = buildSearchFilters(text, currentFilters, folder);
    const [res, agg] = await Promise.all([
      window.api.search(searchQuery),
      window.api.getAggregates(sf),
    ]);
    setResults(res);
    setSelectedIndex(0);
    setExpandedId(null);
    setHasSearched(true);
    setAggregates(agg);
  }, [buildFullQuery, buildSearchFilters]);

  // Extract filters only from completed tokens (followed by a space).
  // The last token — the one the user is still typing — stays as raw text.
  const extractCompletedFilters = useCallback((value: string): { extracted: ParsedQuery; remaining: string } | null => {
    // Only attempt extraction if there's a trailing space (user finished a token)
    if (!value.endsWith(' ')) return null;

    const parsed = parseSearchQuery(value);
    const hasInlineFilters = parsed.docType || parsed.status ||
      parsed.amountMin != null || parsed.amountMax != null || parsed.dateFilter;

    if (!hasInlineFilters) return null;
    return { extracted: parsed, remaining: parsed.text };
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Try to extract completed filter tokens (only when user presses space after a token)
    const extraction = extractCompletedFilters(value);
    if (extraction) {
      const newFilters: ParsedQuery = { ...filters, text: '' };
      const { extracted } = extraction;
      if (extracted.docType) newFilters.docType = extracted.docType;
      if (extracted.status) newFilters.status = extracted.status;
      if (extracted.amountMin != null) newFilters.amountMin = extracted.amountMin;
      if (extracted.amountMax != null) newFilters.amountMax = extracted.amountMax;
      if (extracted.dateFilter) newFilters.dateFilter = extracted.dateFilter;
      setFilters(newFilters);
      setQuery(extraction.remaining);

      if (overlayState === OverlayState.Home) setOverlayState(OverlayState.Search);
      debounceRef.current = setTimeout(() => doSearch(extraction.remaining, newFilters, folderScope), DEBOUNCE_MS);
      return;
    }

    // No filter extraction — normal text handling
    if (value.trim() && overlayState === OverlayState.Home) {
      setOverlayState(OverlayState.Search);
    }
    const hasActiveFilters = filters.docType || filters.status ||
      filters.amountMin != null || filters.amountMax != null || filters.dateFilter;
    if (!value.trim() && overlayState === OverlayState.Search && !folderScope && !hasActiveFilters) {
      setOverlayState(OverlayState.Home);
      setResults([]);
      setHasSearched(false);
      return;
    }

    // For search, merge the raw text with existing filter pills
    debounceRef.current = setTimeout(() => doSearch(value, filters, folderScope), DEBOUNCE_MS);
  }, [doSearch, overlayState, folderScope, filters, extractCompletedFilters]);

  const handleRemoveFilter = useCallback((key: keyof ParsedQuery) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    // Amount min/max are always paired — clear both together
    if (key === 'amountMin' || key === 'amountMax') {
      delete newFilters.amountMin;
      delete newFilters.amountMax;
    }
    newFilters.text = '';
    setFilters(newFilters);

    // Check if anything is left to search
    const hasRemaining = query.trim() || folderScope || newFilters.docType ||
      newFilters.status || newFilters.amountMin != null || newFilters.amountMax != null ||
      newFilters.dateFilter;

    if (!hasRemaining) {
      setOverlayState(OverlayState.Home);
      setResults([]);
      setHasSearched(false);
    } else {
      doSearch(query, newFilters, folderScope);
    }
  }, [filters, query, folderScope, doSearch]);

  const handleFolderBrowse = useCallback((folder: string) => {
    setFolderScope(folder);
    setQuery('');
    goTo(OverlayState.Search);
    doSearch('', filters, folder);
  }, [goTo, doSearch, filters]);

  const handleFolderNavigate = useCallback((folder: string) => {
    setFolderScope(folder);
    doSearch(query, filters, folder);
  }, [query, filters, doSearch]);

  const handleClearFolderScope = useCallback(() => {
    setFolderScope(null);
    const hasActiveFilters = filters.docType || filters.status ||
      filters.amountMin != null || filters.amountMax != null || filters.dateFilter;
    if (!query.trim() && !hasActiveFilters) {
      setOverlayState(OverlayState.Home);
      setResults([]);
      setHasSearched(false);
    } else {
      doSearch(query, filters, null);
    }
  }, [query, filters, doSearch]);

  const handleOpenFolder = useCallback((relativePath: string) => {
    window.api.openFolder(relativePath);
  }, []);

  const handleDocTypeClick = useCallback((docType: string) => {
    // Toggle: if same type, remove it; otherwise set it
    const newFilters = { ...filters, text: '' };
    if (filters.docType === docType) {
      delete newFilters.docType;
    } else {
      newFilters.docType = docType;
    }
    setFilters(newFilters);

    if (overlayState === OverlayState.Home) {
      setOverlayState(OverlayState.Search);
    }
    doSearch(query, newFilters, folderScope);
  }, [filters, query, folderScope, overlayState, doSearch]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleOpenFile = useCallback((relativePath: string) => {
    window.api.openFile(relativePath);
  }, []);

  const handleFieldUpdated = useCallback(() => {
    if (query.trim() || folderScope || filters.docType || filters.status ||
        filters.amountMin != null || filters.amountMax != null || filters.dateFilter) {
      doSearch(query, filters, folderScope);
    }
  }, [query, folderScope, filters, doSearch]);

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
          } else if (filters.docType || filters.status || filters.amountMin != null ||
                     filters.amountMax != null || filters.dateFilter) {
            // Clear all filter pills
            setFilters({ text: '' });
            if (!folderScope) {
              setOverlayState(OverlayState.Home);
              setResults([]);
              setHasSearched(false);
            } else {
              doSearch('', { text: '' }, folderScope);
            }
          } else if (folderScope) {
            handleClearFolderScope();
          } else {
            window.api.hideOverlay();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [results, selectedIndex, handleToggleExpand, overlayState, expandedId, query, folderScope,
      filters, handleQueryChange, handleSettingsBack, handleClearFolderScope, doSearch]);

  // Check if there are active filter pills
  const hasFilterPills = filters.docType || filters.status ||
    filters.amountMin != null || filters.amountMax != null || filters.dateFilter;

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
      {hasFilterPills && (
        <FilterPills filters={filters} onRemoveFilter={handleRemoveFilter} />
      )}
      {folderScope && (
        <BreadcrumbBar
          folder={folderScope}
          onNavigate={handleFolderNavigate}
          onOpenFolder={() => handleOpenFolder(folderScope)}
          onClear={handleClearFolderScope}
        />
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
          onFolderClick={handleFolderBrowse}
          onDocTypeClick={handleDocTypeClick}
        />
      )}
      {hasSearched && aggregates.totalRecords > 0 && (
        <StickyFooter
          stats={aggregates}
          filters={buildSearchFilters(query, filters, folderScope)}
        />
      )}
    </div>
  );
};
