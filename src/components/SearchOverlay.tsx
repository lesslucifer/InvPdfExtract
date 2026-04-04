import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SearchResult, OverlayState, AggregateStats, SearchFilters } from '../shared/types';
import { parseSearchQuery, buildQueryString, ParsedQuery } from '../shared/parse-query';
import { SearchInput } from './SearchInput';
import { FilterPills } from './FilterPills';
import { BreadcrumbBar } from './BreadcrumbBar';
import { ResultList } from './ResultList';
import { NoVaultScreen } from './NoVaultScreen';
import { SettingsPanel } from './SettingsPanel';
import { StickyFooter } from './StickyFooter';
import { PathResultsList } from './PathResultsList';
import { ProcessingStatusPanel } from './ProcessingStatusPanel';

const DEBOUNCE_MS = 200;
const PAGE_SIZE = 50;

type StatusIndicator = 'idle' | 'processing' | 'review' | 'error';

export const SearchOverlay: React.FC = () => {
  const [overlayState, setOverlayState] = useState<OverlayState>(OverlayState.Home);
  const [previousState, setPreviousState] = useState<OverlayState>(OverlayState.Home);
  const [status, setStatus] = useState<StatusIndicator>('idle');

  // Search state — query is the free text only (filters are separate)
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ParsedQuery>({ text: '' });
  const [folderScope, setFolderScope] = useState<string | null>(null);
  const [fileScope, setFileScope] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [aggregates, setAggregates] = useState<AggregateStats>({ totalRecords: 0, totalAmount: 0 });
  const [pageOffset, setPageOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // PathSearch state — the text after the leading '/'
  const [pathQuery, setPathQuery] = useState('');
  // Track the state before PathSearch was entered so Backspace-to-empty can restore it
  const prePathStateRef = useRef<OverlayState>(OverlayState.Home);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: check if vault exists
  useEffect(() => {
    window.api.getAppConfig().then(config => {
      if (!config.lastVaultPath || !config.vaultPaths || config.vaultPaths.length === 0) {
        setOverlayState(OverlayState.NoVault);
      }
    });
  }, []);

  // Subscribe to processing status updates from main process
  useEffect(() => {
    const unsubscribe = window.api.onStatusUpdate(setStatus);
    return unsubscribe;
  }, []);

  const goTo = useCallback((state: OverlayState) => {
    setPreviousState(overlayState);
    setOverlayState(state);
  }, [overlayState]);

  // Build the full query string from free text + structured filters
  const buildFullQuery = useCallback((text: string, currentFilters: ParsedQuery): string => {
    const merged: ParsedQuery = {
      ...currentFilters,
      text: text.trim(),
    };
    return buildQueryString(merged);
  }, []);

  // Build SearchFilters object for IPC calls (aggregates, export)
  const buildSearchFilters = useCallback((text: string, currentFilters: ParsedQuery, folder: string | null, file: string | null = null): SearchFilters => ({
    text: text.trim() || undefined,
    folder: folder || undefined,
    filePath: file || undefined,
    docType: currentFilters.docType,
    status: currentFilters.status,
    amountMin: currentFilters.amountMin,
    amountMax: currentFilters.amountMax,
    dateFilter: currentFilters.dateFilter,
  }), []);

  const doSearch = useCallback(async (text: string, currentFilters: ParsedQuery, folder: string | null, append = false, file: string | null = null) => {
    const searchQuery = buildFullQuery(text, currentFilters);
    const sf = buildSearchFilters(text, currentFilters, folder, file);
    const currentOffset = append ? pageOffset : 0;

    if (append) {
      if (isLoadingMore || !hasMore) return;
      setIsLoadingMore(true);
    }

    const [res, agg] = await Promise.all([
      window.api.search(searchQuery || '', currentOffset, file ? null : folder, file),
      append ? Promise.resolve(aggregates) : window.api.getAggregates(sf),
    ]);

    if (append) {
      setResults(prev => [...prev, ...res]);
      setIsLoadingMore(false);
    } else {
      setResults(res);
      setSelectedIndex(0);
      setExpandedId(null);
      setAggregates(agg);
    }

    setPageOffset(currentOffset + res.length);
    setHasMore(res.length === PAGE_SIZE);
    setHasSearched(true);
  }, [buildFullQuery, buildSearchFilters, pageOffset, hasMore, isLoadingMore, aggregates]);

  // Load all invoices on mount (replaces HomeScreen folder listing)
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current) return;
    if (overlayState === OverlayState.NoVault) return;
    initialLoadDone.current = true;
    doSearch('', filters, folderScope, false, fileScope);
  }, [overlayState]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    doSearch(query, filters, folderScope, true, fileScope);
  }, [doSearch, query, filters, folderScope, fileScope]);

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
    // PathSearch: first char is '/' or '\'
    if ((value.startsWith('/') || value.startsWith('\\')) &&
        overlayState !== OverlayState.PathSearch) {
      prePathStateRef.current = overlayState;
      setOverlayState(OverlayState.PathSearch);
      setPathQuery(value.slice(1));
      setQuery(value);
      return;
    }

    // Already in PathSearch mode — update pathQuery
    if (overlayState === OverlayState.PathSearch) {
      if (!value) {
        // Backspace to empty — return to previous state
        setOverlayState(prePathStateRef.current === OverlayState.PathSearch
          ? OverlayState.Home
          : prePathStateRef.current);
        setQuery('');
        setPathQuery('');
      } else if (!value.startsWith('/') && !value.startsWith('\\')) {
        // User deleted the leading slash — exit PathSearch to normal flow
        setOverlayState(OverlayState.Home);
        setQuery(value);
        setPathQuery('');
      } else {
        setPathQuery(value.slice(1));
        setQuery(value);
      }
      return;
    }

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
      debounceRef.current = setTimeout(() => doSearch(extraction.remaining, newFilters, folderScope, false, fileScope), DEBOUNCE_MS);
      return;
    }

    // No filter extraction — normal text handling
    if (value.trim() && overlayState === OverlayState.Home) {
      setOverlayState(OverlayState.Search);
    }
    const hasActiveFilters = filters.docType || filters.status ||
      filters.amountMin != null || filters.amountMax != null || filters.dateFilter;
    if (!value.trim() && overlayState === OverlayState.Search && !folderScope && !fileScope && !hasActiveFilters) {
      setOverlayState(OverlayState.Home);
      doSearch('', filters, null);
      return;
    }

    // For search, merge the raw text with existing filter pills
    debounceRef.current = setTimeout(() => doSearch(value, filters, folderScope, false, fileScope), DEBOUNCE_MS);
  }, [doSearch, overlayState, folderScope, fileScope, filters, extractCompletedFilters]);

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
    const hasRemaining = query.trim() || folderScope || fileScope || newFilters.docType ||
      newFilters.status || newFilters.amountMin != null || newFilters.amountMax != null ||
      newFilters.dateFilter;

    if (!hasRemaining) {
      setOverlayState(OverlayState.Home);
      doSearch('', { text: '' }, null);
    } else {
      doSearch(query, newFilters, folderScope, false, fileScope);
    }
  }, [filters, query, folderScope, fileScope, doSearch]);

  const handlePathSearchSelectFolder = useCallback((relativePath: string) => {
    setFolderScope(relativePath);
    setFileScope(null);
    setQuery('');
    setPathQuery('');
    setOverlayState(OverlayState.Search);
    doSearch('', filters, relativePath);
  }, [doSearch, filters]);

  const handlePathSearchSelectFile = useCallback((relativePath: string) => {
    // Set file scope — derive parent folder as the folder scope
    const parts = relativePath.split('/');
    parts.pop();
    const parentFolder = parts.join('/');
    setFileScope(relativePath);
    setFolderScope(parentFolder || null);
    setQuery('');
    setPathQuery('');
    setOverlayState(OverlayState.Search);
    doSearch('', filters, parentFolder || null, false, relativePath);
  }, [doSearch, filters]);

  const handleFolderBrowse = useCallback((folder: string) => {
    setFolderScope(folder);
    setFileScope(null);
    setQuery('');
    goTo(OverlayState.Search);
    doSearch('', filters, folder);
  }, [goTo, doSearch, filters]);

  const handleFolderNavigate = useCallback((folder: string) => {
    setFolderScope(folder);
    setFileScope(null);
    doSearch(query, filters, folder);
  }, [query, filters, doSearch]);

  const handleClearFolderScope = useCallback(() => {
    setFolderScope(null);
    setFileScope(null);
    const hasActiveFilters = filters.docType || filters.status ||
      filters.amountMin != null || filters.amountMax != null || filters.dateFilter;
    if (!query.trim() && !hasActiveFilters) {
      setOverlayState(OverlayState.Home);
      doSearch('', { text: '' }, null);
    } else {
      doSearch(query, filters, null);
    }
  }, [query, filters, doSearch]);

  const handleOpenFolder = useCallback((relativePath: string) => {
    window.api.openFolder(relativePath);
  }, []);

  const handleFileBrowse = useCallback((relativePath: string) => {
    const parts = relativePath.split('/');
    parts.pop();
    const parentFolder = parts.join('/');
    setFileScope(relativePath);
    setFolderScope(parentFolder || null);
    setQuery('');
    goTo(OverlayState.Search);
    doSearch('', filters, parentFolder || null, false, relativePath);
  }, [goTo, doSearch, filters]);

  const handleClearFileScope = useCallback(() => {
    setFileScope(null);
    // Keep folderScope — just widen from file to folder
    doSearch(query, filters, folderScope, false, null);
  }, [query, filters, folderScope, doSearch]);

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
    doSearch(query, newFilters, folderScope, false, fileScope);
  }, [filters, query, folderScope, fileScope, overlayState, doSearch]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleOpenFile = useCallback((relativePath: string) => {
    window.api.openFile(relativePath);
  }, []);

  const handleReprocessFile = useCallback(async (relativePath: string) => {
    await window.api.reprocessFile(relativePath);
  }, []);

  const handleReprocessFolder = useCallback(async (folderPrefix: string) => {
    await window.api.reprocessFolder(folderPrefix);
  }, []);

  const handleFieldUpdated = useCallback(() => {
    if (query.trim() || folderScope || fileScope || filters.docType || filters.status ||
        filters.amountMin != null || filters.amountMax != null || filters.dateFilter) {
      doSearch(query, filters, folderScope, false, fileScope);
    }
  }, [query, folderScope, fileScope, filters, doSearch]);

  const handleVaultCreated = useCallback(() => {
    goTo(OverlayState.Home);
  }, [goTo]);

  const handleSettingsBack = useCallback(() => {
    goTo(previousState === OverlayState.Settings ? OverlayState.Home : previousState);
  }, [goTo, previousState]);

  const handleGearClick = useCallback(() => {
    goTo(OverlayState.Settings);
  }, [goTo]);

  const handleStatusDotClick = useCallback(() => {
    goTo(OverlayState.ProcessingStatus);
  }, [goTo]);

  const handleProcessingStatusBack = useCallback(() => {
    goTo(previousState === OverlayState.ProcessingStatus ? OverlayState.Home : previousState);
  }, [goTo, previousState]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          // PathResultsList manages its own keyboard nav via its own event listener
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
          if (overlayState === OverlayState.PathSearch) {
            // PathSearch Esc → full reset to Home
            setOverlayState(OverlayState.Home);
            setQuery('');
            setPathQuery('');
            setFolderScope(null);
            setFileScope(null);
            setFilters({ text: '' });
          } else if (overlayState === OverlayState.Settings) {
            handleSettingsBack();
          } else if (overlayState === OverlayState.ProcessingStatus) {
            handleProcessingStatusBack();
          } else if (expandedId) {
            setExpandedId(null);
          } else if (query) {
            handleQueryChange('');
          } else if (filters.docType || filters.status || filters.amountMin != null ||
                     filters.amountMax != null || filters.dateFilter) {
            // Clear all filter pills
            setFilters({ text: '' });
            if (!folderScope && !fileScope) {
              setOverlayState(OverlayState.Home);
              doSearch('', { text: '' }, null);
            } else {
              doSearch('', { text: '' }, folderScope, false, fileScope);
            }
          } else if (fileScope) {
            handleClearFileScope();
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
  }, [results, selectedIndex, handleToggleExpand, overlayState, expandedId, query, pathQuery,
      folderScope, fileScope, filters, handleQueryChange, handleSettingsBack, handleProcessingStatusBack, handleClearFolderScope, handleClearFileScope, doSearch]);

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

  if (overlayState === OverlayState.ProcessingStatus) {
    return (
      <div className="search-overlay">
        <ProcessingStatusPanel onBack={handleProcessingStatusBack} />
      </div>
    );
  }

  // PathSearch mode
  if (overlayState === OverlayState.PathSearch) {
    return (
      <div className="search-overlay">
        <SearchInput value={query} onChange={handleQueryChange} onGearClick={handleGearClick} onStatusDotClick={handleStatusDotClick} status={status} />
        <PathResultsList
          query={pathQuery}
          scope={folderScope}
          onSelectFolder={handlePathSearchSelectFolder}
          onSelectFile={handlePathSearchSelectFile}
          onReprocessFile={handleReprocessFile}
          onReprocessFolder={handleReprocessFolder}
        />
      </div>
    );
  }

  // Home and Search states share the same layout
  return (
    <div className="search-overlay">
      <SearchInput value={query} onChange={handleQueryChange} onGearClick={handleGearClick} onStatusDotClick={handleStatusDotClick} status={status} />
      {hasFilterPills && (
        <FilterPills filters={filters} onRemoveFilter={handleRemoveFilter} />
      )}
      {(folderScope || fileScope) && (
        <BreadcrumbBar
          folder={folderScope}
          file={fileScope}
          onNavigate={handleFolderNavigate}
          onOpenFolder={() => folderScope && handleOpenFolder(folderScope)}
          onClear={handleClearFolderScope}
          onClearFile={handleClearFileScope}
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
          onFileClick={handleFileBrowse}
          onDocTypeClick={handleDocTypeClick}
          onLoadMore={loadMore}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
        />
      )}
      {hasSearched && aggregates.totalRecords > 0 && (
        <StickyFooter
          stats={aggregates}
          filters={buildSearchFilters(query, filters, folderScope, fileScope)}
        />
      )}
    </div>
  );
};
