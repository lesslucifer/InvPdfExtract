import { t } from '../lib/i18n';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { OverlayState, SearchFilters } from '../shared/types';
import { parseSearchQuery, ParsedQuery } from '../shared/parse-query';
import { getSuggestions, getActiveToken } from '../shared/suggestion-engine';
import { SuggestionItem, EMPTY_HINT_ITEMS, AMOUNT_SUGGESTION_ITEMS, getDateSuggestionItems } from '../shared/suggestion-data';
import { SearchInput } from './SearchInput';
import { FilterPills } from './FilterPills';
import { SuggestionList } from './SuggestionList';
import { BreadcrumbBar } from './BreadcrumbBar';
import { ResultList } from './ResultList';
import { NoVaultScreen } from './NoVaultScreen';
import { DbErrorScreen } from './DbErrorScreen';
import { SettingsPanel } from './SettingsPanel';
import { CheatsheetPanel } from './CheatsheetPanel';
import { StickyFooter, StickyFooterHandle } from './StickyFooter';
import { PathResultsList } from './PathResultsList';
import { ProcessingStatusPanel } from './ProcessingStatusPanel';
import { PresetList } from './PresetList';
import { SavePresetModal } from './SavePresetModal';
import { mergePresetState } from '../shared/merge-preset';
import { useOverlayStore, useSearchStore, usePathSearchStore, usePresetStore, useProcessingStore } from '../stores';

const DEBOUNCE_MS = 200;

const urlParams = new URLSearchParams(window.location.search);
const hasNativeFrame = urlParams.get('nativeFrame') === 'true';
const isWindowlizedWindow = urlParams.get('windowlized') === 'true';

export const SearchOverlay: React.FC = () => {
  // Navigation state from store
  const overlayState = useOverlayStore(s => s.overlayState);
  const isWindowlized = useOverlayStore(s => s.isWindowlized);

  // Search state from store
  const query = useSearchStore(s => s.query);
  const filters = useSearchStore(s => s.filters);
  const folderScope = useSearchStore(s => s.folderScope);
  const fileScope = useSearchStore(s => s.fileScope);
  const hasSearched = useSearchStore(s => s.hasSearched);

  // Initialize windowlized flag once on mount
  useEffect(() => { useOverlayStore.getState().initWindowlized(); }, []);

  // PathSearch state from store
  const pathQuery = usePathSearchStore(s => s.pathQuery);
  // PresetSearch state from store
  const presetQuery = usePresetStore(s => s.presetQuery);
  const showSaveModal = usePresetStore(s => s.showSaveModal);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const footerRef = useRef<StickyFooterHandle>(null);

  // Autocomplete suggestion state
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const cursorPosRef = useRef(0);
  // Empty-input hint bar: shows after 300ms of empty focused input
  const [showHintBar, setShowHintBar] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: check if vault exists or if there is a pending DB error
  useEffect(() => {
    window.api.getDbError().then(error => {
      if (error) {
        useProcessingStore.setState({ dbError: error });
        useOverlayStore.getState().setOverlayState(OverlayState.DbError);
        return;
      }
      window.api.getAppConfig().then(config => {
        if (!config.lastVaultPath || !config.vaultPaths || config.vaultPaths.length === 0) {
          useOverlayStore.getState().setOverlayState(OverlayState.NoVault);
        }
      });
    });
  }, []);

  // Cleanup hint timer on unmount
  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  // Load all invoices on mount (skip for windowlized — restore effect handles the first search)
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (isWindowlizedWindow) return;
    if (initialLoadDone.current) return;
    if (overlayState === OverlayState.NoVault) return;
    initialLoadDone.current = true;
    const s = useSearchStore.getState();
    s.doSearch('', s.filters, s.folderScope, false, s.fileScope);
  }, [overlayState]);

  // Restore carried-over state when opened as a windowlized instance
  useEffect(() => {
    if (!isWindowlizedWindow) return;
    window.api.getInitialState().then(raw => {
      if (!raw) return;
      try {
        const state = JSON.parse(raw);
        const query: string = state.query ?? '';
        const filters: ParsedQuery = state.filters ?? { text: '' };
        const folderScope: string | null = state.folderScope ?? null;
        const fileScope: string | null = state.fileScope ?? null;
        const ss = useSearchStore.getState();
        ss.setQuery(query);
        ss.setFilters(filters);
        ss.setFolderScope(folderScope);
        ss.setFileScope(fileScope);
        if (state.overlayState && state.overlayState !== OverlayState.NoVault) {
          useOverlayStore.getState().setOverlayState(state.overlayState);
        }
        const expandedId: string | null = state.expandedId ?? null;
        ss.doSearch(query, filters, folderScope, false, fileScope).then(() => {
          if (expandedId) ss.setExpandedId(expandedId);
        });
      } catch { /* ignore parse errors */ }
    });
  }, []);

  // Restore persisted overlay UI state on mount (non-windowlized only)
  useEffect(() => {
    if (isWindowlizedWindow) return;
    window.api.getOverlayUIState().then(persisted => {
      if (!persisted) return;
      const ss = useSearchStore.getState();
      ss.setQuery(persisted.query);
      ss.setFilters(persisted.filters);
      ss.setFolderScope(persisted.folderScope);
      ss.setFileScope(persisted.fileScope);
      if (persisted.expandedId) ss.setExpandedId(persisted.expandedId);
      useOverlayStore.getState().setOverlayState(persisted.overlayState);
    });
  }, []);

  // Debounced save of UI state whenever tracked state changes (~5s)
  const expandedId = useSearchStore(s => s.expandedId);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const snapshot = () => {
      const ss = useSearchStore.getState();
      return {
        overlayState: useOverlayStore.getState().overlayState,
        query: ss.query,
        filters: ss.filters,
        folderScope: ss.folderScope,
        fileScope: ss.fileScope,
        expandedId: ss.expandedId,
      };
    };
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      const state = snapshot();
      if (isWindowlizedWindow) {
        window.api.saveSpawnedWindowUIState(state);
      } else {
        window.api.saveOverlayUIState(state);
      }
    }, 5000);
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    };
  }, [overlayState, query, filters, folderScope, fileScope, expandedId]);

  // Immediate save on hide/close to catch final state
  useEffect(() => {
    const snapshot = () => {
      const ss = useSearchStore.getState();
      return {
        overlayState: useOverlayStore.getState().overlayState,
        query: ss.query,
        filters: ss.filters,
        folderScope: ss.folderScope,
        fileScope: ss.fileScope,
        expandedId: ss.expandedId,
      };
    };
    if (isWindowlizedWindow) {
      const save = () => window.api.saveSpawnedWindowUIStateSync(snapshot());
      window.addEventListener('beforeunload', save);
      return () => window.removeEventListener('beforeunload', save);
    } else {
      const save = () => {
        if (document.visibilityState !== 'hidden') return;
        window.api.saveOverlayUIState(snapshot());
      };
      document.addEventListener('visibilitychange', save);
      return () => document.removeEventListener('visibilitychange', save);
    }
  }, []);

  const handleWindowlize = useCallback(() => {
    const ss = useSearchStore.getState();
    const serializedState = JSON.stringify({
      query: ss.query,
      filters: ss.filters,
      folderScope: ss.folderScope,
      fileScope: ss.fileScope,
      expandedId: ss.expandedId,
      overlayState: useOverlayStore.getState().overlayState,
    });
    window.api.windowlize(serializedState);
  }, []);

  const extractCompletedFilters = useCallback((value: string): { extracted: ParsedQuery; remaining: string } | null => {
    if (!value.endsWith(' ')) return null;
    const parsed = parseSearchQuery(value);
    const hasInlineFilters = parsed.docType || parsed.status || parsed.taxId ||
      parsed.amountMin != null || parsed.amountMax != null || parsed.dateFilter ||
      parsed.sortField;
    if (!hasInlineFilters) return null;
    return { extracted: parsed, remaining: parsed.text };
  }, []);

  const handleCursorChange = useCallback((pos: number) => {
    cursorPosRef.current = pos;
    const os = useOverlayStore.getState().overlayState;
    if (os !== OverlayState.PathSearch) {
      const ss = useSearchStore.getState();
      const newSuggestions = getSuggestions(ss.query, pos, ss.filters);
      setSuggestions(newSuggestions);
      setSuggestionIndex(0);
    }
  }, []);

  const queryChangeRef = useRef<(value: string) => void>(() => {});

  const handleSuggestionAccept = useCallback((item: SuggestionItem) => {
    // Special __show: prefix — expand category chips without inserting text
    if (item.insertText.startsWith('__show:')) {
      const category = item.insertText.slice(7); // 'amount' or 'date'
      if (category === 'amount') {
        setSuggestions(AMOUNT_SUGGESTION_ITEMS);
      } else if (category === 'date') {
        setSuggestions(getDateSuggestionItems());
      }
      setSuggestionIndex(0);
      setShowHintBar(false);
      // Remove any partial prefix token the user had typed (e.g. "amou", "dat")
      const ss = useSearchStore.getState();
      if (ss.query) {
        const { text: activeToken, startIndex } = getActiveToken(ss.query, cursorPosRef.current);
        if (activeToken) {
          const newQuery = (ss.query.slice(0, startIndex) + ss.query.slice(startIndex + activeToken.length)).trim();
          ss.setQuery(newQuery);
        }
      }
      return;
    }

    // For pure filter suggestions, apply directly as a pill without touching the text input
    const parsed = parseSearchQuery(item.insertText.trim());
    const isPureFilter = !parsed.text.trim() && (
      parsed.docType || parsed.status || parsed.taxId ||
      parsed.amountMin != null || parsed.amountMax != null ||
      parsed.dateFilter || parsed.sortField
    );
    if (isPureFilter) {
      const ss = useSearchStore.getState();
      const os = useOverlayStore.getState();
      const newFilters: ParsedQuery = { ...ss.filters };
      if (parsed.docType) newFilters.docType = parsed.docType;
      if (parsed.status) newFilters.status = parsed.status;
      if (parsed.taxId) newFilters.taxId = parsed.taxId;
      if (parsed.amountMin != null) newFilters.amountMin = parsed.amountMin;
      if (parsed.amountMax != null) newFilters.amountMax = parsed.amountMax;
      if (parsed.dateFilter) newFilters.dateFilter = parsed.dateFilter;
      if (parsed.sortField) { newFilters.sortField = parsed.sortField; newFilters.sortDirection = parsed.sortDirection; }
      ss.setFilters(newFilters);
      // Remove the typed prefix token from the query
      const { text: activeToken, startIndex } = getActiveToken(ss.query, cursorPosRef.current);
      const newQuery = (ss.query.slice(0, startIndex) + ss.query.slice(startIndex + activeToken.length)).trim();
      ss.setQuery(newQuery);
      if (os.overlayState === OverlayState.Home) os.setOverlayState(OverlayState.Search);
      ss.doSearch(newQuery, newFilters, ss.folderScope, false, ss.fileScope);
      setSuggestions([]);
      setSuggestionIndex(0);
      return;
    }

    const currentQuery = useSearchStore.getState().query;
    const { text: activeToken, startIndex } = getActiveToken(currentQuery, cursorPosRef.current);
    const before = currentQuery.slice(0, startIndex);
    const after = currentQuery.slice(startIndex + activeToken.length);
    const newValue = before + item.insertText + after;

    setSuggestions([]);
    setSuggestionIndex(0);

    // Feed the new value through the normal query change handler
    // which will handle filter extraction if the insertText ends with a space
    queryChangeRef.current(newValue);
  }, []);

  const handleQueryChangeInner = useCallback((value: string) => {
    const os = useOverlayStore.getState();
    const ss = useSearchStore.getState();
    const ps = usePresetStore.getState();
    const pss = usePathSearchStore.getState();

    // PresetSearch: first char is '#'
    if (value.startsWith('#') && os.overlayState !== OverlayState.PresetSearch) {
      ps.setPrePresetState(os.overlayState);
      os.setOverlayState(OverlayState.PresetSearch);
      ps.setPresetQuery(value.slice(1));
      ss.setQuery(value);
      setSuggestions([]);
      return;
    }

    // Already in PresetSearch mode — update presetQuery
    if (os.overlayState === OverlayState.PresetSearch) {
      if (!value) {
        os.setOverlayState(ps.prePresetState === OverlayState.PresetSearch
          ? OverlayState.Home : ps.prePresetState);
        ss.setQuery('');
        ps.setPresetQuery('');
      } else if (!value.startsWith('#')) {
        os.setOverlayState(OverlayState.Home);
        ss.setQuery(value);
        ps.setPresetQuery('');
      } else {
        ps.setPresetQuery(value.slice(1));
        ss.setQuery(value);
      }
      return;
    }

    // PathSearch: first char is '/' or '\'
    if ((value.startsWith('/') || value.startsWith('\\')) &&
        os.overlayState !== OverlayState.PathSearch) {
      pss.setPrePathState(os.overlayState);
      os.setOverlayState(OverlayState.PathSearch);
      pss.setPathQuery(value.slice(1));
      ss.setQuery(value);
      setSuggestions([]);
      return;
    }

    // Already in PathSearch mode — update pathQuery
    if (os.overlayState === OverlayState.PathSearch) {
      if (!value) {
        os.setOverlayState(pss.prePathState === OverlayState.PathSearch
          ? OverlayState.Home : pss.prePathState);
        ss.setQuery('');
        pss.setPathQuery('');
      } else if (!value.startsWith('/') && !value.startsWith('\\')) {
        os.setOverlayState(OverlayState.Home);
        ss.setQuery(value);
        pss.setPathQuery('');
      } else {
        pss.setPathQuery(value.slice(1));
        ss.setQuery(value);
      }
      return;
    }

    ss.setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Compute suggestions for the new value
    const cursorPos = value.length;
    cursorPosRef.current = cursorPos;
    const newSuggestions = getSuggestions(value, cursorPos, ss.filters);
    setSuggestions(newSuggestions);
    setSuggestionIndex(0);

    // Manage hint bar visibility
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    if (!value.trim()) {
      hintTimerRef.current = setTimeout(() => setShowHintBar(true), 300);
    } else if (value.trimEnd().endsWith('?')) {
      setShowHintBar(true);
    } else {
      setShowHintBar(false);
    }

    // Try to extract completed filter tokens
    const extraction = extractCompletedFilters(value);
    if (extraction) {
      const newFilters: ParsedQuery = { ...ss.filters, text: '' };
      const { extracted } = extraction;
      if (extracted.docType) newFilters.docType = extracted.docType;
      if (extracted.status) newFilters.status = extracted.status;
      if (extracted.taxId) newFilters.taxId = extracted.taxId;
      if (extracted.amountMin != null) newFilters.amountMin = extracted.amountMin;
      if (extracted.amountMax != null) newFilters.amountMax = extracted.amountMax;
      if (extracted.dateFilter) newFilters.dateFilter = extracted.dateFilter;
      if (extracted.sortField) newFilters.sortField = extracted.sortField;
      if (extracted.sortDirection) newFilters.sortDirection = extracted.sortDirection;
      ss.setFilters(newFilters);
      ss.setQuery(extraction.remaining);
      setSuggestions([]);

      if (os.overlayState === OverlayState.Home) os.setOverlayState(OverlayState.Search);
      debounceRef.current = setTimeout(() => useSearchStore.getState().doSearch(extraction.remaining, newFilters, ss.folderScope, false, ss.fileScope), DEBOUNCE_MS);
      return;
    }

    // Strip trailing '?' — it's a hint trigger, not a search character
    const searchValue = value.replace(/\?+$/, '');

    if (searchValue.trim() && os.overlayState === OverlayState.Home) {
      os.setOverlayState(OverlayState.Search);
    }
    const hasActiveFilters = ss.filters.docType || ss.filters.status || ss.filters.taxId ||
      ss.filters.amountMin != null || ss.filters.amountMax != null || ss.filters.dateFilter;
    if (!searchValue.trim() && os.overlayState === OverlayState.Search && !ss.folderScope && !ss.fileScope && !hasActiveFilters) {
      os.setOverlayState(OverlayState.Home);
      ss.doSearch('', ss.filters, null);
      return;
    }

    debounceRef.current = setTimeout(() => useSearchStore.getState().doSearch(searchValue, ss.filters, ss.folderScope, false, ss.fileScope), DEBOUNCE_MS);
  }, [extractCompletedFilters]);

  // Keep ref in sync so handleSuggestionAccept (defined before handleQueryChangeInner) can call it
  queryChangeRef.current = handleQueryChangeInner;
  const handleQueryChange = handleQueryChangeInner;

  const handlePathSearchSelectFolder = useCallback((relativePath: string) => {
    const ss = useSearchStore.getState();
    ss.setFolderScope(relativePath);
    ss.setFileScope(null);
    ss.setQuery('');
    usePathSearchStore.getState().setPathQuery('');
    useOverlayStore.getState().setOverlayState(OverlayState.Search);
    ss.doSearch('', ss.filters, relativePath);
  }, []);

  const handlePathSearchSelectFile = useCallback((relativePath: string) => {
    const ss = useSearchStore.getState();
    const parts = relativePath.split('/');
    parts.pop();
    const parentFolder = parts.join('/');
    ss.setFileScope(relativePath);
    ss.setFolderScope(parentFolder || null);
    ss.setQuery('');
    usePathSearchStore.getState().setPathQuery('');
    useOverlayStore.getState().setOverlayState(OverlayState.Search);
    ss.doSearch('', ss.filters, parentFolder || null, false, relativePath);
  }, []);

  const handleFolderNavigate = useCallback((folder: string) => {
    const ss = useSearchStore.getState();
    ss.setFolderScope(folder);
    ss.setFileScope(null);
    ss.doSearch(ss.query, ss.filters, folder);
  }, []);

  const handleLocateFolder = useCallback((relativePath: string) => {
    window.api.locateFolder(relativePath);
  }, []);

  const handleLocateFile = useCallback((relativePath: string) => {
    window.api.locateFile(relativePath);
  }, []);

  const handleReprocessFile = useCallback(async (relativePath: string) => {
    useSearchStore.getState().markFileReprocessing(relativePath);
    await window.api.reprocessFile(relativePath);
  }, []);

  const handleReprocessFolder = useCallback(async (folderPrefix: string) => {
    useSearchStore.getState().markFolderReprocessing(folderPrefix);
    await window.api.reprocessFolder(folderPrefix);
  }, []);

  const handleBreadcrumbReload = useCallback(() => {
    const ss = useSearchStore.getState();
    ss.markBreadcrumbReprocessing();
    if (ss.fileScope) {
      window.api.reprocessFile(ss.fileScope);
    } else if (ss.folderScope) {
      window.api.reprocessFolder(ss.folderScope);
    }
  }, []);

  const handleBreadcrumbReloadJE = useCallback((aiOnly: boolean) => {
    const ss = useSearchStore.getState();
    const filters: SearchFilters = {
      text: ss.query.trim() || undefined,
      folder: ss.folderScope || undefined,
      filePath: ss.fileScope || undefined,
      docType: ss.filters.docType,
      status: ss.filters.status,
      taxId: ss.filters.taxId,
      amountMin: ss.filters.amountMin,
      amountMax: ss.filters.amountMax,
      dateFilter: ss.filters.dateFilter,
    };
    window.api.regenerateJEFiltered(filters, aiOnly);
  }, []);

  const handleVaultChanged = useCallback(() => {
    useSearchStore.getState().resetSearch();
    initialLoadDone.current = false;
    window.api.getAppConfig().then(config => {
      if (!config.lastVaultPath || !config.vaultPaths || config.vaultPaths.length === 0) {
        useOverlayStore.getState().setOverlayState(OverlayState.NoVault);
      } else {
        useProcessingStore.setState({ dbError: null });
        useOverlayStore.getState().setOverlayState(OverlayState.Home);
      }
    });
  }, []);

  const handleGearClick = useCallback(() => {
    useOverlayStore.getState().goTo(OverlayState.Settings);
  }, []);

  const handleCheatsheetClick = useCallback(() => {
    useOverlayStore.getState().goTo(OverlayState.Cheatsheet);
  }, []);

  const handleStatusDotClick = useCallback(() => {
    useOverlayStore.getState().goTo(OverlayState.ProcessingStatus);
  }, []);

  const handleLoadPreset = useCallback((filtersJson: string) => {
    try {
      const ss = useSearchStore.getState();
      const cleanQuery = ss.query.startsWith('#') ? '' : ss.query;
      const result = mergePresetState(
        { currentQuery: cleanQuery, currentFilters: ss.filters, currentFolderScope: ss.folderScope, currentFileScope: ss.fileScope },
        filtersJson,
      );

      ss.setQuery(result.query);
      ss.setFilters(result.filters);
      ss.setFolderScope(result.folderScope);
      ss.setFileScope(result.fileScope);
      useOverlayStore.getState().setOverlayState(OverlayState.Search);
      usePresetStore.getState().setPresetQuery('');
      ss.doSearch(result.query, result.filters, result.folderScope, false, result.fileScope);
    } catch { /* ignore parse errors */ }
  }, []);

  const handleDeletePreset = useCallback(async (id: string) => {
    await window.api.deletePreset(id);
  }, []);

  const handleWindowlizePreset = useCallback((filtersJson: string) => {
    try {
      const state = JSON.parse(filtersJson);
      const serialized = JSON.stringify({
        query: state.query || '',
        filters: state.filters || { text: '' },
        folderScope: state.folderScope || null,
        fileScope: state.fileScope || null,
        overlayState: OverlayState.Search,
      });
      window.api.windowlize(serialized);
    } catch { /* ignore */ }
  }, []);

  const handleSavePreset = useCallback(async (name: string) => {
    const ss = useSearchStore.getState();
    const filtersJson = JSON.stringify({ query: ss.query, filters: ss.filters, folderScope: ss.folderScope, fileScope: ss.fileScope });
    await window.api.savePreset(name, filtersJson);
    usePresetStore.getState().setShowSaveModal(false);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const os = useOverlayStore.getState();
      const ss = useSearchStore.getState();

      // Ctrl+D / Cmd+D: save preset
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        if (usePresetStore.getState().showSaveModal) return;
        const hasActive = ss.query.trim() || ss.folderScope || ss.fileScope || ss.filters.docType || ss.filters.status || ss.filters.taxId ||
          ss.filters.amountMin != null || ss.filters.amountMax != null || ss.filters.dateFilter;
        if (hasActive) {
          usePresetStore.getState().setShowSaveModal(true);
        }
        return;
      }

      // Ctrl+S / Cmd+S: export XLSX
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        footerRef.current?.triggerExport();
        return;
      }

      // Ctrl+, / Cmd+,: open settings
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        useOverlayStore.getState().goTo(OverlayState.Settings);
        return;
      }

      if (usePresetStore.getState().showSaveModal) return;

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
          if (os.overlayState === OverlayState.Search || os.overlayState === OverlayState.Home) {
            e.preventDefault();
            ss.setSelectedIndex(Math.min(ss.selectedIndex + 1, ss.results.length - 1));
          }
          break;
        case 'ArrowUp':
          if (os.overlayState === OverlayState.Search || os.overlayState === OverlayState.Home) {
            e.preventDefault();
            ss.setSelectedIndex(Math.max(ss.selectedIndex - 1, 0));
          }
          break;
        case 'Enter':
          if ((os.overlayState === OverlayState.Search || os.overlayState === OverlayState.Home) && ss.results[ss.selectedIndex]) {
            e.preventDefault();
            ss.toggleExpand(ss.results[ss.selectedIndex].id);
          }
          break;
        case 'Escape':
          e.preventDefault();
          if (os.overlayState === OverlayState.PresetSearch) {
            const ps = usePresetStore.getState();
            os.setOverlayState(ps.prePresetState === OverlayState.PresetSearch
              ? OverlayState.Home : ps.prePresetState);
            ss.setQuery('');
            ps.setPresetQuery('');
          } else if (os.overlayState === OverlayState.PathSearch) {
            os.setOverlayState(OverlayState.Home);
            ss.setQuery('');
            usePathSearchStore.getState().setPathQuery('');
            ss.setFolderScope(null);
            ss.setFileScope(null);
            ss.setFilters({ text: '' } as ParsedQuery);
          } else if (os.overlayState === OverlayState.Settings ||
                     os.overlayState === OverlayState.Cheatsheet ||
                     os.overlayState === OverlayState.ProcessingStatus) {
            os.goBack();
          } else if (ss.expandedId) {
            ss.setExpandedId(null);
          } else if (ss.query) {
            handleQueryChange('');
          } else if (ss.filters.docType || ss.filters.status || ss.filters.taxId || ss.filters.amountMin != null ||
                     ss.filters.amountMax != null || ss.filters.dateFilter) {
            ss.setFilters({ text: '' } as ParsedQuery);
            if (!ss.folderScope && !ss.fileScope) {
              os.setOverlayState(OverlayState.Home);
              ss.doSearch('', { text: '' } as ParsedQuery, null);
            } else {
              ss.doSearch('', { text: '' } as ParsedQuery, ss.folderScope, false, ss.fileScope);
            }
          } else if (ss.fileScope) {
            ss.clearFileScope();
          } else if (ss.folderScope) {
            ss.clearFolderScope();
          } else if (!os.isWindowlized) {
            window.api.hideOverlay();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [suggestions, suggestionIndex, handleSuggestionAccept, handleQueryChange]);

  // Check if there are active filter pills
  const hasSortPill = filters.sortField &&
    !(filters.sortField === 'time' && (!filters.sortDirection || filters.sortDirection === 'desc'));
  const hasFilterPills = filters.docType || filters.status || filters.taxId ||
    filters.amountMin != null || filters.amountMax != null || filters.dateFilter || hasSortPill;

  const titleBar = isWindowlized && !hasNativeFrame ? (
    <div className="title-bar flex items-center justify-between px-3 h-8 text-text-secondary text-3 select-none shrink-0 border-b border-border">
      <span className="text-text font-medium text-3">{t('invoicevault', 'InvoiceVault')}</span>
      <button
        className="title-bar__close bg-transparent border-none text-text-muted cursor-pointer w-6 h-6 inline-flex items-center justify-center rounded hover:bg-bg-hover hover:text-text"
        onClick={() => window.api.closeWindow()}
        aria-label={t('close_window', 'Close window')}
        title={t('close_window', 'Close window')}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
        </svg>
      </button>
    </div>
  ) : null;

  // Render based on state
  const overlayClass = `relative bg-bg rounded-2xl shadow-overlay overflow-hidden flex flex-col ${isWindowlized ? 'h-full rounded-none shadow-none [animation:none]' : 'max-h-[480px] animate-overlay-in'}`;


  if (overlayState === OverlayState.NoVault) {
    return (
      <div className={overlayClass}>
        {titleBar}
        <NoVaultScreen />
      </div>
    );
  }

  if (overlayState === OverlayState.DbError) {
    return (
      <div className={overlayClass}>
        {titleBar}
        <DbErrorScreen />
      </div>
    );
  }

  if (overlayState === OverlayState.Settings) {
    return (
      <div className={overlayClass}>
        {titleBar}
        <SettingsPanel onVaultChanged={handleVaultChanged} />
      </div>
    );
  }

  if (overlayState === OverlayState.Cheatsheet) {
    return (
      <div className={overlayClass}>
        {titleBar}
        <CheatsheetPanel />
      </div>
    );
  }

  if (overlayState === OverlayState.ProcessingStatus) {
    return (
      <div className={overlayClass}>
        {titleBar}
        <ProcessingStatusPanel />
      </div>
    );
  }

  // PathSearch mode
  if (overlayState === OverlayState.PathSearch) {
    return (
      <div className={overlayClass}>
        {titleBar}
        <SearchInput value={query} onChange={handleQueryChange} onCursorChange={handleCursorChange} onStatusDotClick={handleStatusDotClick} />
        {(folderScope || fileScope) && (
          <BreadcrumbBar
            onNavigate={handleFolderNavigate}
            onOpenFolder={() => folderScope && handleLocateFolder(folderScope)}
            onReload={handleBreadcrumbReload}
            onReloadJE={handleBreadcrumbReloadJE}
          />
        )}
        <PathResultsList
          query={pathQuery}
          scope={folderScope}
          onSelectFolder={handlePathSearchSelectFolder}
          onSelectFile={handlePathSearchSelectFile}
          onReprocessFile={handleReprocessFile}
          onReprocessFolder={handleReprocessFolder}
          onOpenFile={handleLocateFile}
          onOpenFolder={handleLocateFolder}
        />
      </div>
    );
  }

  // PresetSearch mode
  if (overlayState === OverlayState.PresetSearch) {
    return (
      <div className={overlayClass}>
        {titleBar}
        <SearchInput value={query} onChange={handleQueryChange} onCursorChange={handleCursorChange} onStatusDotClick={handleStatusDotClick} />
        <PresetList
          query={presetQuery}
          onLoadPreset={handleLoadPreset}
          onDeletePreset={handleDeletePreset}
          onWindowlizePreset={handleWindowlizePreset}
        />
        <SavePresetModal visible={showSaveModal} onSave={handleSavePreset} onCancel={() => usePresetStore.getState().setShowSaveModal(false)} />
      </div>
    );
  }

  // Compute which suggestion chips to show: active suggestions or empty-input hints
  const visibleSuggestions = suggestions.length > 0
    ? suggestions
    : showHintBar && (!query || query.trimEnd().endsWith('?'))
      ? EMPTY_HINT_ITEMS
      : [];

  // Home and Search states share the same layout
  return (
    <div className={overlayClass}>
      {titleBar}
      <SearchInput value={query} onChange={handleQueryChange} onCursorChange={handleCursorChange} onStatusDotClick={handleStatusDotClick} />
      <SuggestionList
        items={visibleSuggestions}
        selectedIndex={suggestionIndex}
        onAccept={handleSuggestionAccept}
        onHover={setSuggestionIndex}
        visible={visibleSuggestions.length > 0}
      />
      {hasFilterPills && (
        <FilterPills />
      )}
      {(folderScope || fileScope) && (
        <BreadcrumbBar
          onNavigate={handleFolderNavigate}
          onOpenFolder={() => folderScope && handleLocateFolder(folderScope)}
          onReload={handleBreadcrumbReload}
          onReloadJE={handleBreadcrumbReloadJE}
        />
      )}
      {hasSearched && (
        <ResultList
          onOpenFile={handleLocateFile}
          onOpenFolder={handleLocateFolder}
          onReprocessFile={handleReprocessFile}
          onReprocessFolder={handleReprocessFolder}
        />
      )}
      <StickyFooter
        ref={footerRef}
        onWindowlize={handleWindowlize}
        onCheatsheetClick={handleCheatsheetClick}
        onSettingsClick={!isWindowlized ? handleGearClick : undefined}
      />
      <SavePresetModal visible={showSaveModal} onSave={handleSavePreset} onCancel={() => usePresetStore.getState().setShowSaveModal(false)} />
    </div>
  );
};
