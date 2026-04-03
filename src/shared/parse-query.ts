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

export interface ParsedQuery {
  text: string;
  docType?: string;
  status?: string;
  folder?: string;
  amountMin?: number;
  amountMax?: number;
  dateFilter?: string;
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
      continue;
    }

    // status: filter
    if (lower.startsWith('status:')) {
      result.status = lower.slice(7);
      continue;
    }

    // in: folder filter
    if (lower.startsWith('in:')) {
      result.folder = part.slice(3);
      continue;
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

  if (parsed.folder) parts.push(`in:${parsed.folder}`);

  if (parsed.docType) {
    const typeMap: Record<string, string> = {
      bank_statement: 'type:bank',
      invoice_out: 'type:out',
      invoice_in: 'type:in',
    };
    if (typeMap[parsed.docType]) parts.push(typeMap[parsed.docType]);
  }

  if (parsed.status) parts.push(`status:${parsed.status}`);

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

  if (parsed.text.trim()) parts.push(parsed.text.trim());

  return parts.join(' ');
}
