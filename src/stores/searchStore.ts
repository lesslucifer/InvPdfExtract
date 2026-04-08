import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { SearchResult, AggregateStats, SearchFilters, FileStatus, OverlayState } from '../shared/types';
import { buildQueryString, ParsedQuery, SORT_DEFAULT_DIRECTIONS } from '../shared/parse-query';
import { useOverlayStore } from './overlayStore';
import { replaceSearchResult } from './search-store-helpers';

const PAGE_SIZE = 50;

interface SearchStore {
  // Input state
  query: string;
  filters: ParsedQuery;
  folderScope: string | null;
  fileScope: string | null;

  // Result state
  results: SearchResult[];
  selectedIndex: number;
  expandedId: string | null;
  hasSearched: boolean;

  // Pagination
  aggregates: AggregateStats;
  pageOffset: number;
  hasMore: boolean;
  isLoadingMore: boolean;

  // Actions — basic setters
  setQuery: (query: string) => void;
  setFilters: (filters: ParsedQuery) => void;
  setFolderScope: (folder: string | null) => void;
  setFileScope: (file: string | null) => void;
  setSelectedIndex: (index: number) => void;
  setExpandedId: (id: string | null) => void;
  toggleExpand: (id: string) => void;

  // Search execution
  doSearch: (text: string, filters: ParsedQuery, folder: string | null, append?: boolean, file?: string | null) => Promise<void>;
  loadMore: () => void;
  resetSearch: () => void;

  // Filter manipulation
  removeFilter: (key: keyof ParsedQuery) => void;
  toggleSortDirection: () => void;
  applyDocTypeFilter: (docType: string) => void;
  applyMstFilter: (taxId: string) => void;
  applyInvoiceCodeFilter: (invoiceCode: string) => void;
  applyDateFilter: (date: string) => void;
  applyInvoiceNumberSort: () => void;

  // Scope manipulation
  browseFolder: (folder: string) => void;
  browseFile: (relativePath: string) => void;
  clearFolderScope: () => void;
  clearFileScope: () => void;

  // Optimistic status updates
  markFileReprocessing: (relativePath: string) => void;
  markFolderReprocessing: (folderPrefix: string) => void;
  markBreadcrumbReprocessing: () => void;

  // File status updates from IPC
  updateFileStatuses: (statuses: Record<string, FileStatus>) => void;
  removeResultsForFile: (relativePath: string) => void;
  replaceResult: (result: SearchResult) => void;
}

function buildSearchFilters(text: string, filters: ParsedQuery, folder: string | null, file: string | null = null): SearchFilters {
  return {
    text: text.trim() || undefined,
    folder: folder || undefined,
    filePath: file || undefined,
    docType: filters.docType,
    status: filters.status,
    taxId: filters.taxId,
    invoiceCode: filters.invoiceCode,
    amountMin: filters.amountMin,
    amountMax: filters.amountMax,
    dateFilter: filters.dateFilter,
    sortField: filters.sortField,
    sortDirection: filters.sortDirection,
  };
}

export const useSearchStore = create<SearchStore>()(
  immer((set, get) => ({
    query: '',
    filters: { text: '' } as ParsedQuery,
    folderScope: null,
    fileScope: null,
    results: [],
    selectedIndex: 0,
    expandedId: null,
    hasSearched: false,
    aggregates: { totalRecords: 0, totalAmount: 0 },
    pageOffset: 0,
    hasMore: true,
    isLoadingMore: false,

    setQuery: (query) => set({ query }),
    setFilters: (filters) => set({ filters }),
    setFolderScope: (folder) => set({ folderScope: folder }),
    setFileScope: (file) => set({ fileScope: file }),
    setSelectedIndex: (index) => set({ selectedIndex: index }),
    setExpandedId: (id) => set({ expandedId: id }),
    toggleExpand: (id) => set(s => { s.expandedId = s.expandedId === id ? null : id; }),

    doSearch: async (text, currentFilters, folder, append = false, file = null) => {
      const searchQuery = buildQueryString({ ...currentFilters, text: text.trim() });
      const sf = buildSearchFilters(text, currentFilters, folder, file);
      const state = get();
      const currentOffset = append ? state.pageOffset : 0;

      if (append) {
        if (state.isLoadingMore || !state.hasMore) return;
        set({ isLoadingMore: true });
      }

      const [res, agg] = await Promise.all([
        window.api.search(searchQuery || '', currentOffset, file ? null : folder, file),
        append ? Promise.resolve(state.aggregates) : window.api.getAggregates(sf),
      ]);

      if (append) {
        set(s => {
          s.results = [...s.results, ...res];
          s.isLoadingMore = false;
          s.pageOffset = currentOffset + res.length;
          s.hasMore = res.length === PAGE_SIZE;
          s.hasSearched = true;
        });
      } else {
        set({
          results: res,
          selectedIndex: 0,
          expandedId: null,
          aggregates: agg,
          pageOffset: currentOffset + res.length,
          hasMore: res.length === PAGE_SIZE,
          hasSearched: true,
          isLoadingMore: false,
        });
      }
    },

    loadMore: () => {
      const { query, filters, folderScope, fileScope, doSearch } = get();
      doSearch(query, filters, folderScope, true, fileScope);
    },

    resetSearch: () => {
      set({
        query: '',
        filters: { text: '' } as ParsedQuery,
        folderScope: null,
        fileScope: null,
        results: [],
        selectedIndex: 0,
        expandedId: null,
        hasSearched: false,
        pageOffset: 0,
        hasMore: true,
        aggregates: { totalRecords: 0, totalAmount: 0 },
        isLoadingMore: false,
      });
    },

    removeFilter: (key) => {
      const state = get();
      const newFilters = { ...state.filters };
      delete newFilters[key];
      if (key === 'amountMin' || key === 'amountMax') {
        delete newFilters.amountMin;
        delete newFilters.amountMax;
      }
      if (key === 'sortField' || key === 'sortDirection') {
        delete newFilters.sortField;
        delete newFilters.sortDirection;
      }
      newFilters.text = '';
      set({ filters: newFilters });

      const hasRemaining = state.query.trim() || state.folderScope || state.fileScope ||
        newFilters.docType || newFilters.status || newFilters.taxId || newFilters.invoiceCode ||
        newFilters.amountMin != null || newFilters.amountMax != null ||
        newFilters.dateFilter || newFilters.sortField;

      if (!hasRemaining) {
        useOverlayStore.getState().setOverlayState(OverlayState.Home);
        get().doSearch('', { text: '' } as ParsedQuery, null);
      } else {
        get().doSearch(state.query, newFilters, state.folderScope, false, state.fileScope);
      }
    },

    toggleSortDirection: () => {
      const state = get();
      if (!state.filters.sortField) return;
      const currentDir = state.filters.sortDirection || SORT_DEFAULT_DIRECTIONS[state.filters.sortField];
      const newDir = currentDir === 'asc' ? 'desc' : 'asc';
      const newFilters = { ...state.filters, sortDirection: newDir as ParsedQuery['sortDirection'] };
      set({ filters: newFilters });
      get().doSearch(state.query, newFilters, state.folderScope, false, state.fileScope);
    },

    applyDocTypeFilter: (docType) => {
      const state = get();
      const newFilters = { ...state.filters, text: '' };
      if (state.filters.docType === docType) {
        delete newFilters.docType;
      } else {
        newFilters.docType = docType;
      }
      set({ filters: newFilters });
      const overlayState = useOverlayStore.getState().overlayState;
      if (overlayState === OverlayState.Home) {
        useOverlayStore.getState().setOverlayState(OverlayState.Search);
      }
      get().doSearch(state.query, newFilters, state.folderScope, false, state.fileScope);
    },

    applyMstFilter: (taxId) => {
      const state = get();
      const newFilters = { ...state.filters, text: '', taxId };
      set({ filters: newFilters });
      const overlayState = useOverlayStore.getState().overlayState;
      if (overlayState === OverlayState.Home) {
        useOverlayStore.getState().setOverlayState(OverlayState.Search);
      }
      get().doSearch(state.query, newFilters, state.folderScope, false, state.fileScope);
    },

    applyInvoiceCodeFilter: (invoiceCode) => {
      const state = get();
      const newFilters = { ...state.filters, text: '' };
      if (state.filters.invoiceCode === invoiceCode) {
        delete newFilters.invoiceCode;
      } else {
        newFilters.invoiceCode = invoiceCode;
      }
      set({ filters: newFilters });
      const overlayState = useOverlayStore.getState().overlayState;
      if (overlayState === OverlayState.Home) {
        useOverlayStore.getState().setOverlayState(OverlayState.Search);
      }
      get().doSearch(state.query, newFilters, state.folderScope, false, state.fileScope);
    },

    applyDateFilter: (date) => {
      const state = get();
      const newFilters = { ...state.filters, text: '', dateFilter: date };
      set({ filters: newFilters });
      const overlayState = useOverlayStore.getState().overlayState;
      if (overlayState === OverlayState.Home) {
        useOverlayStore.getState().setOverlayState(OverlayState.Search);
      }
      get().doSearch(state.query, newFilters, state.folderScope, false, state.fileScope);
    },

    applyInvoiceNumberSort: () => {
      const state = get();
      const currentDir = state.filters.sortDirection || SORT_DEFAULT_DIRECTIONS.shd;
      const sortDirection = state.filters.sortField === 'shd'
        ? (currentDir === 'asc' ? 'desc' : 'asc')
        : SORT_DEFAULT_DIRECTIONS.shd;
      const newFilters = {
        ...state.filters,
        sortField: 'shd' as const,
        sortDirection,
      };
      set({ filters: newFilters });
      const overlayState = useOverlayStore.getState().overlayState;
      if (overlayState === OverlayState.Home) {
        useOverlayStore.getState().setOverlayState(OverlayState.Search);
      }
      get().doSearch(state.query, newFilters, state.folderScope, false, state.fileScope);
    },

    browseFolder: (folder) => {
      const state = get();
      set({ folderScope: folder, fileScope: null, query: '' });
      useOverlayStore.getState().goTo(OverlayState.Search);
      get().doSearch('', state.filters, folder);
    },

    browseFile: (relativePath) => {
      const state = get();
      const parts = relativePath.split('/');
      parts.pop();
      const parentFolder = parts.join('/');
      set({ fileScope: relativePath, folderScope: parentFolder || null, query: '' });
      useOverlayStore.getState().goTo(OverlayState.Search);
      get().doSearch('', state.filters, parentFolder || null, false, relativePath);
    },

    clearFolderScope: () => {
      const state = get();
      set({ folderScope: null, fileScope: null });
      const hasActiveFilters = state.filters.docType || state.filters.status || state.filters.taxId ||
        state.filters.invoiceCode || state.filters.amountMin != null || state.filters.amountMax != null ||
        state.filters.dateFilter || state.filters.sortField;
      if (!state.query.trim() && !hasActiveFilters) {
        useOverlayStore.getState().setOverlayState(OverlayState.Home);
        get().doSearch('', { text: '' } as ParsedQuery, null);
      } else {
        get().doSearch(state.query, state.filters, null);
      }
    },

    clearFileScope: () => {
      const state = get();
      set({ fileScope: null });
      get().doSearch(state.query, state.filters, state.folderScope, false, null);
    },

    markFileReprocessing: (relativePath) => {
      set(s => {
        for (const r of s.results) {
          if (r.relative_path === relativePath) r.file_status = FileStatus.Pending;
        }
      });
    },

    markFolderReprocessing: (folderPrefix) => {
      set(s => {
        for (const r of s.results) {
          if (r.relative_path.startsWith(folderPrefix + '/')) r.file_status = FileStatus.Pending;
        }
      });
    },

    markBreadcrumbReprocessing: () => {
      const { fileScope, folderScope } = get();
      if (fileScope) {
        get().markFileReprocessing(fileScope);
      } else if (folderScope) {
        get().markFolderReprocessing(folderScope);
      }
    },

    updateFileStatuses: (statuses) => {
      set(s => {
        for (const r of s.results) {
          const newStatus = statuses[r.relative_path];
          if (newStatus !== undefined) r.file_status = newStatus;
        }
      });
    },

    removeResultsForFile: (relativePath) => {
      set(s => {
        s.results = s.results.filter(r => r.relative_path !== relativePath);
      });
    },

    replaceResult: (result) => {
      set(s => {
        s.results = replaceSearchResult(s.results, result);
      });
    },
  }))
);
