import { ParsedQuery } from './parse-query';
import { type IconName } from './icons';

export interface SuggestionItem {
  /** Category for grouping */
  category: 'type' | 'status' | 'sort' | 'sort-direction' | 'amount' | 'date';
  /** Icon name from shared/icons */
  icon: IconName;
  /** Optional secondary icon for sort direction */
  directionIcon?: IconName;
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
    { category: 'date', icon: 'calendar', label: 'Today', insertText: `${d.today} `, hint: d.today, keywords: ['today', 'hom nay'], filterKey: 'dateFilter' },
    { category: 'date', icon: 'calendar', label: 'This Month', insertText: `${d.thisMonth} `, hint: d.thisMonth, keywords: ['this month', 'thang nay'], filterKey: 'dateFilter' },
    { category: 'date', icon: 'calendar', label: 'Last Month', insertText: `${d.lastMonth} `, hint: d.lastMonth, keywords: ['last month', 'thang truoc'], filterKey: 'dateFilter' },
    { category: 'date', icon: 'calendar', label: 'This Year', insertText: `${d.thisYear} `, hint: d.thisYear, keywords: ['this year', 'nam nay'], filterKey: 'dateFilter' },
  ];
}

/** Common amount filter suggestions */
export const AMOUNT_SUGGESTION_ITEMS: SuggestionItem[] = [
  { category: 'amount', icon: 'amount', label: '>1tr', insertText: '>1tr ', hint: '', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: 'amount', label: '>5tr', insertText: '>5tr ', hint: '', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: 'amount', label: '>10tr', insertText: '>10tr ', hint: '>', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: 'amount', label: '>50tr', insertText: '>50tr ', hint: '', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: 'amount', label: '>100tr', insertText: '>100tr ', hint: '', keywords: ['amount', 'so tien'], filterKey: 'amountMin' },
  { category: 'amount', icon: 'amount', label: '1tr-5tr', insertText: '1tr-5tr ', hint: '1M–5M', keywords: ['amount', 'range', 'so tien'], filterKey: 'amountMin' },
];

export const SUGGESTION_ITEMS: SuggestionItem[] = [
  // Type filters
  {
    category: 'type',
    icon: 'bankStatement',
    label: 'Bank Statement',
    insertText: 'type:bank ',
    hint: 'saoke',
    keywords: ['type', 'bank', 'saoke', 'sao ke', 'ngan hang', 'statement'],
    filterKey: 'docType',
  },
  {
    category: 'type',
    icon: 'invoiceOut',
    label: 'Invoice Out',
    insertText: 'type:out ',
    hint: 'hdra',
    keywords: ['type', 'out', 'hdra', 'hoa don dau ra', 'output', 'sales'],
    filterKey: 'docType',
  },
  {
    category: 'type',
    icon: 'invoiceIn',
    label: 'Invoice In',
    insertText: 'type:in ',
    hint: 'hdv',
    keywords: ['type', 'in', 'hdv', 'hoa don dau vao', 'input', 'purchase'],
    filterKey: 'docType',
  },
  {
    category: 'type',
    icon: 'invoiceAny',
    label: 'Invoice (any)',
    insertText: 'type:inv ',
    hint: 'in+out',
    keywords: ['type', 'invoice', 'hoa don', 'hdra', 'hdv', 'all invoices'],
    filterKey: 'docType',
  },

  // Status filters
  {
    category: 'status',
    icon: 'success',
    label: 'OK',
    insertText: 'status:ok ',
    hint: 'Processed, no issues',
    keywords: ['status', 'ok', 'done', 'xong', 'thanh cong'],
    filterKey: 'status',
  },
  {
    category: 'status',
    icon: 'eye',
    label: 'Uncertain',
    insertText: 'status:uncertain ',
    hint: 'Low AI confidence',
    keywords: ['status', 'uncertain', 'review', 'xem lai', 'thap'],
    filterKey: 'status',
  },
  {
    category: 'status',
    icon: 'mismatch',
    label: 'Mismatch',
    insertText: 'status:mismatch ',
    hint: 'Total ≠ line items',
    keywords: ['status', 'mismatch', 'chenh lech', 'sai'],
    filterKey: 'status',
  },

  // Sort filters (asc only — user can toggle direction on the pill)
  {
    category: 'sort',
    icon: 'calendar',
    directionIcon: 'arrowDown',
    label: 'Date',
    insertText: 'sort:date ',
    hint: 'Ngày lập',
    keywords: ['sort', 'date', 'ngay'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: 'clock',
    directionIcon: 'arrowDown',
    label: 'Processed',
    insertText: 'sort:time ',
    hint: 'TG Xử lý',
    keywords: ['sort', 'time', 'processed', 'thoi gian'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: 'amount',
    directionIcon: 'arrowDown',
    label: 'Amount',
    insertText: 'sort:amount ',
    hint: 'so tien',
    keywords: ['sort', 'amount', 'so tien'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: 'amount',
    directionIcon: 'arrowUp',
    label: 'Amount',
    insertText: 'sort:amount-asc ',
    hint: 'Tổng tiền',
    keywords: ['sort', 'amount', 'so tien', 'asc'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: 'folderOpen',
    directionIcon: 'arrowUp',
    label: 'Path',
    insertText: 'sort:path ',
    hint: 'Đường dẫn',
    keywords: ['sort', 'path', 'duong dan', 'file'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: 'target',
    directionIcon: 'arrowUp',
    label: 'Confidence',
    insertText: 'sort:confidence ',
    hint: 'Độ chính xác',
    keywords: ['sort', 'confidence', 'do tin cay'],
    filterKey: 'sortField',
  },
  {
    category: 'sort',
    icon: 'folderOpen',
    directionIcon: 'arrowUp',
    label: 'Invoice #',
    insertText: 'sort:shd ',
    hint: 'Ký hiệu + số hoá đơn',
    keywords: ['sort', 'shd', 'so hoa don', 'ky hieu hoa don', 'invoice number', 'invoice code'],
    filterKey: 'sortField',
  }
];

/** Sort direction sub-suggestions, used when user types `sort:<field>-` */
export const SORT_DIRECTION_ITEMS: SuggestionItem[] = [
  {
    category: 'sort-direction',
    icon: 'arrowUp',
    label: 'Ascending',
    insertText: '-asc ',
    hint: 'A→Z, 0→9, old→new',
    keywords: ['asc', 'ascending', 'tang dan'],
    filterKey: 'sortField',
  },
  {
    category: 'sort-direction',
    icon: 'arrowDown',
    label: 'Descending',
    insertText: '-desc ',
    hint: 'Z→A, 9→0, new→old',
    keywords: ['desc', 'descending', 'giam dan'],
    filterKey: 'sortField',
  },
];

/** Prefix hints shown when user types a partial prefix like "ty" or "sor" */
export interface PrefixHint {
  prefix: string;
  label: string;
  icon: IconName;
  insertText: string;
}

export const PREFIX_HINTS: PrefixHint[] = [
  { prefix: 'type', label: 'Filter by document type', icon: 'clipboardList', insertText: 'type:' },
  { prefix: 'status', label: 'Filter by status', icon: 'zap', insertText: 'status:' },
  { prefix: 'sort', label: 'Sort results', icon: 'arrowUpDown', insertText: 'sort:' },
  { prefix: 'amount', label: 'Filter by amount', icon: 'amount', insertText: '__show:amount' },
  { prefix: 'date', label: 'Filter by date', icon: 'calendar', insertText: '__show:date' },
];

/** Hint chips shown when input is empty — uses SuggestionItem for unified rendering.
 *  Amount and Date use special '__show:' prefix to trigger category expansion without inserting text. */
export const EMPTY_HINT_ITEMS: SuggestionItem[] = [
  { category: 'type', icon: 'clipboardList', label: 'type:', insertText: 'type:', hint: '', keywords: [], filterKey: 'docType' },
  { category: 'status', icon: 'zap', label: 'status:', insertText: 'status:', hint: '', keywords: [], filterKey: 'status' },
  { category: 'sort', icon: 'arrowUpDown', label: 'sort:', insertText: 'sort:', hint: '', keywords: [], filterKey: 'sortField' },
  { category: 'amount', icon: 'amount', label: 'amount', insertText: '__show:amount', hint: '', keywords: [], filterKey: 'amountMin' },
  { category: 'date', icon: 'calendar', label: 'date', insertText: '__show:date', hint: '', keywords: [], filterKey: 'dateFilter' },
];
