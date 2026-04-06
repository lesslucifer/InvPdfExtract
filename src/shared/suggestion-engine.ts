import { ParsedQuery } from './parse-query';
import {
  SuggestionItem,
  SUGGESTION_ITEMS,
  PREFIX_HINTS,
  PrefixHint,
  AMOUNT_SUGGESTION_ITEMS,
  getDateSuggestionItems,
} from './suggestion-data';

export interface ActiveToken {
  /** The token text (e.g., "type:", "type:ba", "sor") */
  text: string;
  /** Start index of the token in the full input string */
  startIndex: number;
}

/**
 * Extract the token the user is currently typing, based on cursor position.
 * A token is a whitespace-delimited segment.
 */
export function getActiveToken(input: string, cursorPos: number): ActiveToken {
  // Find the start of the current token by scanning back from cursor
  let start = cursorPos;
  while (start > 0 && input[start - 1] !== ' ') {
    start--;
  }
  const text = input.slice(start, cursorPos);
  return { text, startIndex: start };
}

function isFilterActive(filterKey: keyof ParsedQuery, filters: ParsedQuery): boolean {
  switch (filterKey) {
    case 'docType': return !!filters.docType;
    case 'status': return !!filters.status;
    case 'sortField': return !!filters.sortField;
    case 'dateFilter': return !!filters.dateFilter;
    case 'amountMin': return filters.amountMin != null;
    case 'amountMax': return filters.amountMax != null;
    case 'taxId': return !!filters.taxId;
    default: return false;
  }
}

/**
 * Get suggestions for the current input state.
 *
 * Returns an array of SuggestionItems to display, or an empty array if
 * no suggestions should be shown.
 */
export function getSuggestions(
  input: string,
  cursorPos: number,
  currentFilters: ParsedQuery,
): SuggestionItem[] {
  if (!input.trim()) return [];

  const { text: token } = getActiveToken(input, cursorPos);
  if (!token) return [];

  const lower = token.toLowerCase();

  // Prefix-colon triggers: type:, status:, sort:, amount:, date:
  if (lower.includes(':')) {
    const [prefix, value] = lower.split(':');
    const valueStr = value || '';

    // Special virtual prefixes: amount: and date:
    if (prefix === 'amount') {
      if (isFilterActive('amountMin', currentFilters)) return [];
      return AMOUNT_SUGGESTION_ITEMS.filter(item => {
        if (!valueStr) return true;
        return item.label.toLowerCase().includes(valueStr) || item.hint.toLowerCase().includes(valueStr);
      });
    }
    if (prefix === 'date') {
      if (isFilterActive('dateFilter', currentFilters)) return [];
      const dateItems = getDateSuggestionItems();
      return dateItems.filter(item => {
        if (!valueStr) return true;
        return (
          item.label.toLowerCase().includes(valueStr) ||
          item.hint.toLowerCase().includes(valueStr) ||
          item.keywords.some(kw => kw.includes(valueStr))
        );
      });
    }

    // Filter items by category matching the prefix, then by value substring
    const categoryMap: Record<string, SuggestionItem['category']> = {
      type: 'type',
      status: 'status',
      sort: 'sort',
    };
    const category = categoryMap[prefix];
    if (!category) return [];

    return SUGGESTION_ITEMS.filter(item => {
      if (item.category !== category) return false;
      if (isFilterActive(item.filterKey, currentFilters)) return false;
      if (!valueStr) return true; // show all for this category
      // Match value against label, hint, and keywords
      const lowerValue = valueStr.toLowerCase();
      return (
        item.label.toLowerCase().includes(lowerValue) ||
        item.hint.toLowerCase().includes(lowerValue) ||
        item.keywords.some(kw => kw.includes(lowerValue))
      );
    });
  }

  // Partial prefix match: "ty" → type:, "sor" → sort:, "sta" → status:
  const prefixMatch = getPartialPrefixMatch(lower, currentFilters);
  if (prefixMatch) {
    // Convert prefix hint to a suggestion item for display
    return [{
      category: 'type', // doesn't matter for display
      icon: prefixMatch.icon,
      label: prefixMatch.label,
      insertText: prefixMatch.insertText,
      hint: prefixMatch.prefix + ':',
      keywords: [],
      filterKey: 'text',
    }];
  }

  return [];
}

/**
 * Check if the token is a partial prefix match (e.g., "ty" matching "type").
 */
export function getPartialPrefixMatch(
  token: string,
  currentFilters: ParsedQuery,
): PrefixHint | null {
  if (!token || token.length < 2) return null; // require at least 2 chars

  const filterKeyMap: Record<string, keyof ParsedQuery> = {
    type: 'docType',
    status: 'status',
    sort: 'sortField',
  };

  for (const hint of PREFIX_HINTS) {
    if (hint.prefix.startsWith(token) && hint.prefix !== token) {
      const filterKey = filterKeyMap[hint.prefix];
      if (filterKey && isFilterActive(filterKey, currentFilters)) continue;
      return hint;
    }
  }

  return null;
}
