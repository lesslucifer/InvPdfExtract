const AMOUNT_SUFFIXES: Record<string, number> = {
  k: 1_000,
  tr: 1_000_000,
  m: 1_000_000,
  b: 1_000_000_000,
  t: 1_000_000_000,
};

/** Parse a number that may have a money suffix (k, tr, m, b, t) */
function parseAmountWithSuffix(s: string): number | null {
  const match = s.match(/^(\d+(?:\.\d+)?)(k|tr|m|b|t)?$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const multiplier = match[2] ? AMOUNT_SUFFIXES[match[2]] : 1;
  return num * multiplier;
}

export type SortField = 'time' | 'date' | 'path' | 'amount' | 'confidence' | 'shd';
export type SortDirection = 'asc' | 'desc';

export const SORT_DEFAULT_DIRECTIONS: Record<SortField, SortDirection> = {
  time: 'desc',
  date: 'desc',
  path: 'asc',
  amount: 'desc',
  confidence: 'asc',
  shd: 'asc',
};

export interface ParsedQuery {
  text: string;
  docType?: string;
  status?: string;
  folder?: string;
  filePath?: string;
  amountMin?: number;
  amountMax?: number;
  dateFilter?: string;
  sortField?: SortField;
  sortDirection?: SortDirection;
  taxId?: string;
  invoiceCode?: string;
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = { text: '' };
  const tokens: string[] = [];

  const parts = raw.split(/\s+/);
  for (const part of parts) {
    const lower = part.toLowerCase();

    // type: filter
    if (lower.startsWith('type:')) {
      const val = lower.slice(5);
      if (val === 'bank' || val === 'saoke') result.docType = 'bank_statement';
      else if (val === 'hdra' || val === 'out') result.docType = 'invoice_out';
      else if (val === 'hdv' || val === 'in') result.docType = 'invoice_in';
      else if (val === 'inv') result.docType = 'invoice';
      continue;
    }

    // status: filter
    if (lower.startsWith('status:')) {
      result.status = lower.slice(7);
      continue;
    }

    // taxId: filter (tax ID — preserve original case)
    if (lower.startsWith('taxid:')) {
      result.taxId = part.slice(6);
      continue;
    }

    if (lower.startsWith('code:')) {
      result.invoiceCode = part.slice(5);
      continue;
    }

    if (lower.startsWith('invoicecode:')) {
      result.invoiceCode = part.slice(12);
      continue;
    }

    // sort: filter — sort:field or sort:field-asc / sort:field-desc
    if (lower.startsWith('sort:')) {
      const sortVal = lower.slice(5);
      const match = sortVal.match(/^(time|processed|date|path|amount|confidence|shd)(?:-(asc|desc))?$/);
      if (match) {
        const rawField = match[1];
        result.sortField = (rawField === 'processed' ? 'time' : rawField) as SortField;
        result.sortDirection = (match[2] as SortDirection) || undefined;
        continue;
      }
    }

    // Date filter: YYYY-MM or YYYY-MM-DD (must be checked before amount range)
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(part)) {
      result.dateFilter = part;
      continue;
    }

    // Amount range: >N, <N, N-M with optional suffixes (k, tr, m, b, t)
    const rangeMatch = lower.match(/^(\d+(?:\.\d+)?(?:k|tr|m|b|t)?)-(\d+(?:\.\d+)?(?:k|tr|m|b|t)?)$/);
    if (rangeMatch) {
      const min = parseAmountWithSuffix(rangeMatch[1]);
      const max = parseAmountWithSuffix(rangeMatch[2]);
      if (min != null && max != null) {
        result.amountMin = min;
        result.amountMax = max;
        continue;
      }
    }
    if (lower.startsWith('>')) {
      const amt = parseAmountWithSuffix(lower.slice(1));
      if (amt != null) { result.amountMin = amt; continue; }
    }
    if (lower.startsWith('<')) {
      const amt = parseAmountWithSuffix(lower.slice(1));
      if (amt != null) { result.amountMax = amt; continue; }
    }

    tokens.push(part);
  }

  result.text = tokens.join(' ');
  return result;
}

/** Reconstruct a query string from structured filters */
export function buildQueryString(parsed: ParsedQuery): string {
  const parts: string[] = [];

  if (parsed.docType) {
    const typeMap: Record<string, string> = {
      bank_statement: 'type:bank',
      invoice_out: 'type:out',
      invoice_in: 'type:in',
      invoice: 'type:inv',
    };
    if (typeMap[parsed.docType]) parts.push(typeMap[parsed.docType]);
  }

  if (parsed.status) parts.push(`status:${parsed.status}`);

  if (parsed.taxId) parts.push(`taxId:${parsed.taxId}`);

  if (parsed.invoiceCode) parts.push(`code:${parsed.invoiceCode}`);

  if (parsed.amountMin != null && parsed.amountMax != null) {
    // Check if both are clean multiples of 1M for Ntr-Mtr shorthand
    if (parsed.amountMin % 1_000_000 === 0 && parsed.amountMax % 1_000_000 === 0) {
      parts.push(`${parsed.amountMin / 1_000_000}tr-${parsed.amountMax / 1_000_000}tr`);
    } else {
      parts.push(`>${parsed.amountMin}`);
      parts.push(`<${parsed.amountMax}`);
    }
  } else if (parsed.amountMin != null) {
    parts.push(`>${parsed.amountMin}`);
  } else if (parsed.amountMax != null) {
    parts.push(`<${parsed.amountMax}`);
  }

  if (parsed.dateFilter) parts.push(parsed.dateFilter);

  if (parsed.sortField) {
    const dir = parsed.sortDirection || SORT_DEFAULT_DIRECTIONS[parsed.sortField];
    if (dir !== SORT_DEFAULT_DIRECTIONS[parsed.sortField]) {
      parts.push(`sort:${parsed.sortField}-${dir}`);
    } else {
      parts.push(`sort:${parsed.sortField}`);
    }
  }

  if (parsed.text.trim()) parts.push(parsed.text.trim());

  return parts.join(' ');
}
