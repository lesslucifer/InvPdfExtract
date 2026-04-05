import { ParsedQuery } from './parse-query';

export interface SuggestionItem {
  /** Category for grouping */
  category: 'type' | 'status' | 'sort' | 'amount' | 'date';
  /** Display icon (emoji) */
  icon: string;
  /** Primary label shown to the user */
  label: string;
  /** The raw text to insert into the input on acceptance */
  insertText: string;
  /** Secondary hint text (aliases, syntax examples) */
  hint: string;
  /** All searchable keywords (for matching) */
  keywords: string[];
  /** Which ParsedQuery key this would set (to check for conflicts with existing pills) */
  filterKey: keyof ParsedQuery;
}

/** Helper to get date strings relative to today */
function getRelativeDates() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');

  // Last month
  const lastMonth = new Date(y, now.getMonth() - 1, 1);
  const lmY = lastMonth.getFullYear();
  const lmM = String(lastMonth.getMonth() + 1).padStart(2, '0');

  return {
    today: `${y}-${m}-${d}`,
    yesterday: (() => {
      const yd = new Date(y, now.getMonth(), now.getDate() - 1);
      return `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;
    })(),
    thisMonth: `${y}-${m}`,
    lastMonth: `${lmY}-${lmM}`,
    thisYear: `${y}`,
  };
}

/** Get date suggestion items (computed dynamically from current date) */
export function getDateSuggestionItems(): SuggestionItem[] {
  const d = getRelativeDates();
  return [
    { category: 'date', icon: '📅', label: 'Today', insertText: `${d.today} `, hint: d.today, keywords: ['today', 'hom nay'], filterKey: 'dateFilter' },
    { category: 'date', icon: '📅', label: 'This Month', insertText: `${d.thisMonth} `, hint: d.thisMonth, keywords: ['this month', 'thang nay'], filterKey: 'dateFilter' },
    { category: 'date', icon: '📅', label: 'Last Month', insertText: `${d.lastMonth} `, hint: d.lastMonth, keywords: ['last month', 'thang truoc'], filterKey: 'dateFilter' },
    { category: 'date', icon: '📅', label: 'This Year', insertText: `${d.thisYear} `, hint: d.thisYear, keywords: ['this year', 'nam nay'], filterKey: 'dateFilter' },
  ];
}

/** Common amount filter suggestions */
export const AMOUNT_SUGGESTION_ITEMS: SuggestionItem[] = [
  { category: 'amount', icon: '💰', label: '>1tr', insertText: '>1tr ', hint: '', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: '💰', label: '>5tr', insertText: '>5tr ', hint: '', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: '💰', label: '>10tr', insertText: '>10tr ', hint: '>', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: '💰', label: '>50tr', insertText: '>50tr ', hint: '', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: '💰', label: '>100tr', insertText: '>100tr ', hint: '', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: '💰', label: '1tr-5tr', insertText: '1tr-5tr ', hint: '1M–5M', keywords: ['amount', 'range', 'so tien'], filterKey: 'amountMin' },
];

export const SUGGESTION_ITEMS: SuggestionItem[] = [
  // Type filters
  {
    category: 'type',
    icon: '🏦',
    label: 'Bank Statement',
    insertText: 'type:bank ',
    hint: 'saoke',
    keywords: ['type', 'bank', 'saoke', 'sao ke', 'ngan hang', 'statement'],
    filterKey: 'docType',
  },
  {
    category: 'type',
    icon: '📤',
    label: 'Invoice Out',
    insertText: 'type:out ',
    hint: 'hdra',
    keywords: ['type', 'out', 'hdra', 'hoa don dau ra', 'output', 'sales'],
    filterKey: 'docType',
  },
  {
    category: 'type',
    icon: '📥',
    label: 'Invoice In',
    insertText: 'type:in ',
    hint: 'hdv',
    keywords: ['type', 'in', 'hdv', 'hoa don dau vao', 'input', 'purchase'],
    filterKey: 'docType',
  },

  // Status filters
  {
    category: 'status',
    icon: '⚠️',
    label: 'Conflict',
    insertText: 'status:conflict ',
    hint: 'Fields differ from AI',
    keywords: ['status', 'conflict', 'xung dot'],
    filterKey: 'status',
  },
  {
    category: 'status',
    icon: '🔍',
    label: 'Needs Review',
    insertText: 'status:review ',
    hint: 'Low confidence',
    keywords: ['status', 'review', 'xem lai'],
    filterKey: 'status',
  },
  {
    category: 'status',
    icon: '❗',
    label: 'Mismatch',
    insertText: 'status:mismatch ',
    hint: 'Total ≠ line items',
    keywords: ['status', 'mismatch', 'chenh lech', 'sai'],
    filterKey: 'status',
  },

  // Sort filters (asc only — user can toggle direction on the pill)
  {
    category: 'sort',
    icon: '📅',
    label: 'Date',
    insertText: 'sort:date ',
    hint: 'ngay',
    keywords: ['sort', 'date', 'ngay'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: '🕐',
    label: 'Processed',
    insertText: 'sort:time ',
    hint: 'thoi gian',
    keywords: ['sort', 'time', 'processed', 'thoi gian'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: '💰',
    label: 'Amount',
    insertText: 'sort:amount ',
    hint: 'so tien',
    keywords: ['sort', 'amount', 'so tien'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: '📂',
    label: 'Path',
    insertText: 'sort:path ',
    hint: 'duong dan',
    keywords: ['sort', 'path', 'duong dan', 'file'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: '🎯',
    label: 'Confidence',
    insertText: 'sort:confidence ',
    hint: 'do tin cay',
    keywords: ['sort', 'confidence', 'do tin cay'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: '🔢',
    label: 'Invoice #',
    insertText: 'sort:shd ',
    hint: 'so hoa don',
    keywords: ['sort', 'shd', 'so hoa don', 'invoice number'],
    filterKey: 'sortField',
  },
];


/** Prefix hints shown when user types a partial prefix like "ty" or "sor" */
export interface PrefixHint {
  prefix: string;
  label: string;
  icon: string;
  insertText: string;
}

export const PREFIX_HINTS: PrefixHint[] = [
  { prefix: 'type', label: 'Filter by document type', icon: '📋', insertText: 'type:' },
  { prefix: 'status', label: 'Filter by status', icon: '⚡', insertText: 'status:' },
  { prefix: 'sort', label: 'Sort results', icon: '↕️', insertText: 'sort:' },
];

/** Hint chips shown when input is empty — uses SuggestionItem for unified rendering.
 *  Amount and Date use special '__show:' prefix to trigger category expansion without inserting text. */
export const EMPTY_HINT_ITEMS: SuggestionItem[] = [
  { category: 'type', icon: '📋', label: 'type:', insertText: 'type:', hint: '', keywords: [], filterKey: 'docType' },
  { category: 'status', icon: '⚡', label: 'status:', insertText: 'status:', hint: '', keywords: [], filterKey: 'status' },
  { category: 'sort', icon: '↕️', label: 'sort:', insertText: 'sort:', hint: '', keywords: [], filterKey: 'sortField' },
  { category: 'amount', icon: '💰', label: 'Amount', insertText: '__show:amount', hint: '', keywords: [], filterKey: 'amountMin' },
  { category: 'date', icon: '📅', label: 'Date', insertText: '__show:date', hint: '', keywords: [], filterKey: 'dateFilter' },
];
