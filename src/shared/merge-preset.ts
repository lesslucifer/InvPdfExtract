import { ParsedQuery } from './parse-query';
import { PresetFilters } from './types';

export interface MergeInput {
  currentQuery: string;
  currentFilters: ParsedQuery;
  currentFolderScope: string | null;
  currentFileScope: string | null;
}

export interface MergeResult {
  query: string;
  filters: ParsedQuery;
  folderScope: string | null;
  fileScope: string | null;
}

export function mergePresetState(current: MergeInput, presetJson: string): MergeResult {
  const state: PresetFilters = JSON.parse(presetJson);
  const presetFilters: ParsedQuery = state.filters || { text: '' };

  // Query: append, dedupe if identical
  const currentQ = current.currentQuery.trim();
  const presetQ = (state.query || '').trim();
  let finalQuery: string;
  if (!currentQ) {
    finalQuery = presetQ;
  } else if (!presetQ || currentQ === presetQ) {
    finalQuery = currentQ;
  } else {
    finalQuery = `${currentQ} ${presetQ}`;
  }

  // Filters: fill empty only
  const merged: ParsedQuery = { ...current.currentFilters, text: '' };
  if (!merged.docType && presetFilters.docType) merged.docType = presetFilters.docType;
  if (!merged.status && presetFilters.status) merged.status = presetFilters.status;
  if (merged.amountMin == null && presetFilters.amountMin != null) merged.amountMin = presetFilters.amountMin;
  if (merged.amountMax == null && presetFilters.amountMax != null) merged.amountMax = presetFilters.amountMax;
  if (!merged.dateFilter && presetFilters.dateFilter) merged.dateFilter = presetFilters.dateFilter;
  if (!merged.taxId && presetFilters.taxId) merged.taxId = presetFilters.taxId;
  if (!merged.sortField && presetFilters.sortField) {
    merged.sortField = presetFilters.sortField;
    merged.sortDirection = presetFilters.sortDirection;
  }

  // Scopes: fill empty only
  const folderScope = current.currentFolderScope || state.folderScope || null;
  const fileScope = current.currentFileScope || state.fileScope || null;

  return { query: finalQuery, filters: merged, folderScope, fileScope };
}
