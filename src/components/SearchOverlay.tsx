import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SearchResult, OverlayState, AggregateStats, SearchFilters, FileStatus, FilterPreset, PresetFilters } from '../shared/types';
import { parseSearchQuery, buildQueryString, ParsedQuery, SORT_DEFAULT_DIRECTIONS } from '../shared/parse-query';
import { getSuggestions, getActiveToken } from '../shared/suggestion-engine';
import { SuggestionItem, EMPTY_HINT_ITEMS } from '../shared/suggestion-data';
import { SearchInput } from './SearchInput';
import { FilterPills } from './FilterPills';
import { SuggestionList } from './SuggestionList';
import { BreadcrumbBar } from './BreadcrumbBar';
import { ResultList } from './ResultList';
import { NoVaultScreen } from './NoVaultScreen';
import { SettingsPanel } from './SettingsPanel';
import { StickyFooter } from './StickyFooter';
import { PathResultsList } from './PathResultsList';
import { ProcessingStatusPanel } from './ProcessingStatusPanel';

const DEBOUNCE_MS = 200;
const PAGE_SIZE = 50;

/** Convert a FilterPreset to a SuggestionItem for display in the chips bar */
function presetToSuggestionItem(preset: FilterPreset): SuggestionItem {
  let summary = '';
  try {
    const pf: PresetFilters = JSON.parse(preset.filters);
    const parts: string[] = [];
    if (pf.filters?.docType) {
      const icons: Record<string, string> = { bank_statement: '🏦', invoice_out: '📤', invoice_in: '📥' };
      parts.push(icons[pf.filters.docType] || '');
    }
    if (pf.filters?.status) parts.push(pf.filters.status);
    if (pf.filters?.amountMin != null) parts.push(`>${formatCompact(pf.filters.amountMin)}`);
    if (pf.filters?.amountMax != null) parts.push(`<${formatCompact(pf.filters.amountMax)}`);
    if (pf.filters?.dateFilter) parts.push(pf.filters.dateFilter);
    if (pf.folderScope) parts.push('📁');
    if (pf.query) parts.push(pf.query);
    summary = parts.join(' ');
  } catch { /* ignore */ }

  return {
    category: 'preset',
    icon: '\u2605', // ★
    label: preset.name,
    insertText: '', // presets don't insert text, they load state
    hint: summary,
    keywords: [preset.name.toLowerCase()],
    filterKey: 'text',
    presetId: preset.id,
    presetFilters: preset.filters,
  };
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000 && n % 1_000_000_000 === 0) return `${n / 1_000_000_000}t`;
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}tr`;
  if (n >= 1_000 && n % 1_000 === 0) return `${n / 1_000}k`;
  return String(n);
}

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
  // Windowlized state — detected from URL param (synchronous, no flash)
  const [isWindowlized] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('windowlized') === 'true';
  });
  // PathSearch state — the text after the leading '/'
  const [pathQuery, setPathQuery] = useState('');
  // Track the state before PathSearch was entered so Backspace-to-empty can restore it
  const prePathStateRef = useRef<OverlayState>(OverlayState.Home);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autocomplete suggestion state
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const cursorPosRef = useRef(0);
  // Empty-input hint bar: shows after 300ms of empty focused input
  const [showHintBar, setShowHintBar] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter presets
  const [presets, setPresets] = useState<FilterPreset[]>([]);

  // On mount: check if vault exists + load presets
  useEffect(() => {
    window.api.getAppConfig().then(config => {
      if (!config.lastVaultPath || !config.vaultPaths || config.vaultPaths.length === 0) {
        setOverlayState(OverlayState.NoVault);
      } else {
        window.api.listPresets().then(setPresets).catch(() => {});
      }
    });
  }, []);

  // Subscribe to processing status updates from main process
  useEffect(() => {
    const unsubscribe = window.api.onStatusUpdate(setStatus);
    return unsubscribe;
  }, []);

  // Subscribe to file status changes to update StatusDots in search results
  const resultsRef = useRef(results);
  resultsRef.current = results;
  useEffect(() => {
    const unsubscribe = window.api.onFileStatusChanged(async () => {
      const currentResults = resultsRef.current;
      if (currentResults.length === 0) return;
      const paths = [...new Set(currentResults.map(r => r.relative_path))];
      const updatedStatuses = await window.api.getFileStatusesByPaths(paths);
      setResults(prev => prev.map(r => {
        const newStatus = updatedStatuses[r.relative_path];
        return newStatus !== undefined ? { ...r, file_status: newStatus } : r;
      }));
    });
    return unsubscribe;
  }, []);

  // Cleanup hint timer on unmount
  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
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

  // Restore carried-over state when opened as a windowlized instance
  useEffect(() => {
    if (!isWindowlized) return;
    window.api.getInitialState().then(raw => {
      if (!raw) return;
      try {
        const state = JSON.parse(raw);
        if (state.query) setQuery(state.query);
        if (state.filters) setFilters(state.filters);
        if (state.folderScope) setFolderScope(state.folderScope);
        if (state.fileScope) setFileScope(state.fileScope);
        if (state.overlayState && state.overlayState !== OverlayState.NoVault) {
          setOverlayState(state.overlayState);
        }
        // Trigger search with restored state
        doSearch(
          state.query || '',
          state.filters || { text: '' },
          state.folderScope || null,
          false,
          state.fileScope || null,
        );
      } catch { /* ignore parse errors */ }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWindowlize = useCallback(() => {
    const serializedState = JSON.stringify({
      query,
      filters,
      folderScope,
      fileScope,
      overlayState,
    });
    window.api.windowlize(serializedState);
  }, [query, filters, folderScope, fileScope, overlayState]);

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
      parsed.amountMin != null || parsed.amountMax != null || parsed.dateFilter ||
      parsed.sortField;

    if (!hasInlineFilters) return null;
    return { extracted: parsed, remaining: parsed.text };
  }, []);

  // When the `?` trigger is active, cursor-change events must not overwrite suggestions.
  // We store the `?`-mode query so we can check it even with stale closures.
  const questionTriggerQueryRef = useRef<string | null>(null);

  const handleCursorChange = useCallback((pos: number) => {
    cursorPosRef.current = pos;
    // Skip suggestion recomputation while `?` trigger is active
    if (questionTriggerQueryRef.current !== null) return;
    // Recompute suggestions with new cursor position
    if (overlayState !== OverlayState.PathSearch) {
      const newSuggestions = getSuggestions(query, pos, filters);
      setSuggestions(newSuggestions);
      setSuggestionIndex(0);
    }
  }, [query, filters, overlayState]);

  const queryChangeRef = useRef<(value: string) => void>(() => {});
  const loadPresetRef = useRef<(preset: FilterPreset) => void>(() => {});

  const handleSuggestionAccept = useCallback((item: SuggestionItem) => {
    // Preset items: load the preset instead of inserting text
    if (item.category === 'preset' && item.presetId) {
      const preset = presets.find(p => p.id === item.presetId);
      if (preset) loadPresetRef.current(preset);
      return;
    }

    const { text: activeToken, startIndex } = getActiveToken(query, cursorPosRef.current);
    // Replace the active token with the suggestion's insertText
    const before = query.slice(0, startIndex);
    const after = query.slice(startIndex + activeToken.length);
    const newValue = before + item.insertText + after;

    setSuggestions([]);
    setSuggestionIndex(0);

    // Feed the new value through the normal query change handler
    // which will handle filter extraction if the insertText ends with a space
    queryChangeRef.current(newValue);
  }, [query, presets]);

  const handleQueryChangeInner = useCallback((value: string) => {
    // PathSearch: first char is '/' or '\'
    if ((value.startsWith('/') || value.startsWith('\\')) &&
        overlayState !== OverlayState.PathSearch) {
      prePathStateRef.current = overlayState;
      setOverlayState(OverlayState.PathSearch);
      setPathQuery(value.slice(1));
      setQuery(value);
      setSuggestions([]);
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

    // `?` trigger: show presets + hint chips
    if (value.trimEnd().endsWith('?')) {
      const filterText = value.replace(/\?+\s*$/, '').trim().toLowerCase();
      const presetItems = presets.map(presetToSuggestionItem);
      const allItems = [...presetItems, ...EMPTY_HINT_ITEMS];
      const filtered = filterText
        ? allItems.filter(item =>
            item.label.toLowerCase().includes(filterText) ||
            item.hint?.toLowerCase().includes(filterText) ||
            item.keywords.some(k => k.includes(filterText))
          )
        : allItems;
      setSuggestions(filtered);
      setSuggestionIndex(0);
      setShowHintBar(false);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      questionTriggerQueryRef.current = value;
      return;
    }

    // Clear `?` trigger lock when query no longer ends with `?`
    questionTriggerQueryRef.current = null;

    // Compute suggestions for the new value
    const cursorPos = value.length; // onChange always puts cursor at end
    cursorPosRef.current = cursorPos;
    const newSuggestions = getSuggestions(value, cursorPos, filters);
    setSuggestions(newSuggestions);
    setSuggestionIndex(0);

    // Manage hint bar visibility
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    if (!value.trim()) {
      hintTimerRef.current = setTimeout(() => setShowHintBar(true), 300);
    } else {
      setShowHintBar(false);
    }

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
      if (extracted.sortField) newFilters.sortField = extracted.sortField;
      if (extracted.sortDirection) newFilters.sortDirection = extracted.sortDirection;
      setFilters(newFilters);
      setQuery(extraction.remaining);
      setSuggestions([]); // clear suggestions after filter extraction

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
  }, [doSearch, overlayState, folderScope, fileScope, filters, extractCompletedFilters, presets]);

  // Keep ref in sync so handleSuggestionAccept (defined before handleQueryChangeInner) can call it
  queryChangeRef.current = handleQueryChangeInner;
  const handleQueryChange = handleQueryChangeInner;

  const handleRemoveFilter = useCallback((key: keyof ParsedQuery) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    // Amount min/max are always paired — clear both together
    if (key === 'amountMin' || key === 'amountMax') {
      delete newFilters.amountMin;
      delete newFilters.amountMax;
    }
    // Sort field/direction are paired
    if (key === 'sortField' || key === 'sortDirection') {
      delete newFilters.sortField;
      delete newFilters.sortDirection;
    }
    newFilters.text = '';
    setFilters(newFilters);

    // Check if anything is left to search
    const hasRemaining = query.trim() || folderScope || fileScope || newFilters.docType ||
      newFilters.status || newFilters.amountMin != null || newFilters.amountMax != null ||
      newFilters.dateFilter || newFilters.sortField;

    if (!hasRemaining) {
      setOverlayState(OverlayState.Home);
      doSearch('', { text: '' }, null);
    } else {
      doSearch(query, newFilters, folderScope, false, fileScope);
    }
  }, [filters, query, folderScope, fileScope, doSearch]);

  const handleToggleSortDirection = useCallback(() => {
    if (!filters.sortField) return;
    const currentDir = filters.sortDirection || SORT_DEFAULT_DIRECTIONS[filters.sortField];
    const newDir = currentDir === 'asc' ? 'desc' : 'asc';
    const newFilters = { ...filters, sortDirection: newDir as ParsedQuery['sortDirection'] };
    setFilters(newFilters);
    doSearch(query, newFilters, folderScope, false, fileScope);
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
    setResults(prev => prev.map(r =>
      r.relative_path === relativePath ? { ...r, file_status: FileStatus.Pending } : r
    ));
    await window.api.reprocessFile(relativePath);
  }, []);

  const handleReprocessFolder = useCallback(async (folderPrefix: string) => {
    setResults(prev => prev.map(r =>
      r.relative_path.startsWith(folderPrefix + '/') ? { ...r, file_status: FileStatus.Pending } : r
    ));
    await window.api.reprocessFolder(folderPrefix);
  }, []);

  const handleBreadcrumbReload = useCallback(() => {
    if (fileScope) {
      setResults(prev => prev.map(r =>
        r.relative_path === fileScope ? { ...r, file_status: FileStatus.Pending } : r
      ));
      window.api.reprocessFile(fileScope);
    } else if (folderScope) {
      setResults(prev => prev.map(r =>
        r.relative_path.startsWith(folderScope + '/') ? { ...r, file_status: FileStatus.Pending } : r
      ));
      window.api.reprocessFolder(folderScope);
    }
  }, [fileScope, folderScope]);

  const handleFieldUpdated = useCallback(() => {
    if (query.trim() || folderScope || fileScope || filters.docType || filters.status ||
        filters.amountMin != null || filters.amountMax != null || filters.dateFilter) {
      doSearch(query, filters, folderScope, false, fileScope);
    }
  }, [query, folderScope, fileScope, filters, doSearch]);

  // === Filter Preset Handlers ===

  const handleSavePreset = useCallback(async (name: string) => {
    const pf: PresetFilters = { query, filters, folderScope, fileScope };
    const preset = await window.api.savePreset(name, JSON.stringify(pf));
    if (preset) setPresets(prev => [preset, ...prev]);
  }, [query, filters, folderScope, fileScope]);

  const handleLoadPreset = useCallback((preset: FilterPreset) => {
    try {
      const pf: PresetFilters = JSON.parse(preset.filters);
      setQuery(pf.query || '');
      setFilters(pf.filters || { text: '' });
      setFolderScope(pf.folderScope || null);
      setFileScope(pf.fileScope || null);
      setSuggestions([]);
      setShowHintBar(false);

      const hasContent = pf.query || pf.folderScope || pf.fileScope ||
        pf.filters?.docType || pf.filters?.status ||
        pf.filters?.amountMin != null || pf.filters?.amountMax != null ||
        pf.filters?.dateFilter;
      if (hasContent) {
        setOverlayState(OverlayState.Search);
      }
      doSearch(pf.query || '', pf.filters || { text: '' }, pf.folderScope || null, false, pf.fileScope || null);
    } catch { /* ignore parse errors */ }
  }, [doSearch]);
  loadPresetRef.current = handleLoadPreset;

  const handlePresetWindowlize = useCallback((presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    try {
      const pf: PresetFilters = JSON.parse(preset.filters);
      const serializedState = JSON.stringify({
        query: pf.query || '',
        filters: pf.filters || { text: '' },
        folderScope: pf.folderScope || null,
        fileScope: pf.fileScope || null,
        overlayState: OverlayState.Search,
      });
      window.api.windowlize(serializedState);
    } catch { /* ignore parse errors */ }
  }, [presets]);

  const handleDeletePreset = useCallback(async (id: string) => {
    await window.api.deletePreset(id);
    setPresets(prev => prev.filter(p => p.id !== id));
  }, []);

  const handleVaultCreated = useCallback(() => {
    goTo(OverlayState.Home);
  }, [goTo]);

  const handleVaultChanged = useCallback(() => {
    setQuery('');
    setFilters({ text: '' });
    setFolderScope(null);
    setFileScope(null);
    setResults([]);
    setSelectedIndex(0);
    setExpandedId(null);
    setHasSearched(false);
    setPageOffset(0);
    setHasMore(true);
    setAggregates({ totalRecords: 0, totalAmount: 0 });
    setPresets([]);
    initialLoadDone.current = false;
    window.api.getAppConfig().then(config => {
      if (!config.lastVaultPath || !config.vaultPaths || config.vaultPaths.length === 0) {
        setOverlayState(OverlayState.NoVault);
      } else {
        window.api.listPresets().then(setPresets).catch(() => {});
      }
    });
  }, []);

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
      // When suggestions are visible, they capture navigation keys
      if (suggestions.length > 0) {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setSuggestionIndex(prev => Math.min(prev + 1, suggestions.length - 1));
            return;
          case 'ArrowUp':
            e.preventDefault();
            setSuggestionIndex(prev => Math.max(prev - 1, 0));
            return;
          case 'Tab':
          case 'Enter':
            e.preventDefault();
            if (suggestions[suggestionIndex]) {
              handleSuggestionAccept(suggestions[suggestionIndex]);
            }
            return;
          case 'Escape':
            e.preventDefault();
            setSuggestions([]);
            setSuggestionIndex(0);
            return;
        }
      }

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
          } else if (!isWindowlized) {
            window.api.hideOverlay();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [results, selectedIndex, handleToggleExpand, overlayState, expandedId, query, pathQuery,
      folderScope, fileScope, filters, handleQueryChange, handleSettingsBack, handleProcessingStatusBack, handleClearFolderScope, handleClearFileScope, doSearch, isWindowlized,
      suggestions, suggestionIndex, handleSuggestionAccept]);

  // Check if there are active filter pills
  const hasSortPill = filters.sortField &&
    !(filters.sortField === 'time' && (!filters.sortDirection || filters.sortDirection === 'desc'));
  const hasFilterPills = filters.docType || filters.status ||
    filters.amountMin != null || filters.amountMax != null || filters.dateFilter || hasSortPill;

  // Active filters = any filter state worth saving as a preset
  const hasActiveFilters = !!(query.trim() || folderScope || fileScope || hasFilterPills);

  const titleBar = isWindowlized ? (
    <div className="title-bar">
      <span className="title-bar__text">InvoiceVault</span>
      <button
        className="title-bar__close"
        onClick={() => window.api.closeWindow()}
        aria-label="Close window"
        title="Close window"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
        </svg>
      </button>
    </div>
  ) : null;

  // Render based on state
  const overlayClassName = `search-overlay${isWindowlized ? ' search-overlay--windowlized' : ''}`;

  if (overlayState === OverlayState.NoVault) {
    return (
      <div className={overlayClassName}>
        {titleBar}
        <NoVaultScreen onVaultCreated={handleVaultCreated} />
      </div>
    );
  }

  if (overlayState === OverlayState.Settings) {
    return (
      <div className={overlayClassName}>
        {titleBar}
        <SettingsPanel onBack={handleSettingsBack} onVaultChanged={handleVaultChanged} />
      </div>
    );
  }

  if (overlayState === OverlayState.ProcessingStatus) {
    return (
      <div className={overlayClassName}>
        {titleBar}
        <ProcessingStatusPanel onBack={handleProcessingStatusBack} />
      </div>
    );
  }

  // PathSearch mode
  if (overlayState === OverlayState.PathSearch) {
    return (
      <div className={overlayClassName}>
        {titleBar}
        <SearchInput value={query} onChange={handleQueryChange} onCursorChange={handleCursorChange} onStatusDotClick={handleStatusDotClick} status={status} />
        <PathResultsList
          query={pathQuery}
          scope={folderScope}
          onSelectFolder={handlePathSearchSelectFolder}
          onSelectFile={handlePathSearchSelectFile}
          onReprocessFile={handleReprocessFile}
          onReprocessFolder={handleReprocessFolder}
          onOpenFile={handleOpenFile}
          onOpenFolder={handleOpenFolder}
        />
      </div>
    );
  }

  // Compute which suggestion chips to show: active suggestions or empty-input hints (with presets)
  const hintItems = presets.length > 0
    ? [...presets.map(presetToSuggestionItem), ...EMPTY_HINT_ITEMS]
    : EMPTY_HINT_ITEMS;
  const visibleSuggestions = suggestions.length > 0
    ? suggestions
    : showHintBar && !query
      ? hintItems
      : [];

  // Home and Search states share the same layout
  return (
    <div className={overlayClassName}>
      {titleBar}
      <SearchInput value={query} onChange={handleQueryChange} onCursorChange={handleCursorChange} onStatusDotClick={handleStatusDotClick} status={status} hasActiveFilters={hasActiveFilters} onSavePreset={handleSavePreset} />
      <SuggestionList
        items={visibleSuggestions}
        selectedIndex={suggestionIndex}
        onAccept={handleSuggestionAccept}
        onHover={setSuggestionIndex}
        visible={visibleSuggestions.length > 0}
        onDeletePreset={handleDeletePreset}
        onCtrlClickPreset={handlePresetWindowlize}
      />
      {hasFilterPills && (
        <FilterPills filters={filters} onRemoveFilter={handleRemoveFilter} onToggleSortDirection={handleToggleSortDirection} />
      )}
      {(folderScope || fileScope) && (
        <BreadcrumbBar
          folder={folderScope}
          file={fileScope}
          onNavigate={handleFolderNavigate}
          onOpenFolder={() => folderScope && handleOpenFolder(folderScope)}
          onClear={handleClearFolderScope}
          onClearFile={handleClearFileScope}
          onReload={handleBreadcrumbReload}
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
          onOpenFolder={handleOpenFolder}
          onReprocessFile={handleReprocessFile}
          onReprocessFolder={handleReprocessFolder}
          onLoadMore={loadMore}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
        />
      )}
      {(hasSearched && aggregates.totalRecords > 0) || !isWindowlized ? (
        <StickyFooter
          stats={aggregates}
          filters={buildSearchFilters(query, filters, folderScope, fileScope)}
          onWindowlize={!isWindowlized && hasSearched && aggregates.totalRecords > 0 ? handleWindowlize : undefined}
          onGearClick={!isWindowlized ? handleGearClick : undefined}
        />
      ) : null}
    </div>
  );
};
