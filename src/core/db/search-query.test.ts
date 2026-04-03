import { describe, it, expect } from 'vitest';

/**
 * Tests for the search query parser logic.
 *
 * Extracted from records.ts parseSearchQuery to test as a pure function.
 * This validates that browse mode (folder-only, no text) is correctly parsed.
 */

interface ParsedQuery {
  text: string;
  docType?: string;
  status?: string;
  folder?: string;
  amountMin?: number;
  amountMax?: number;
  dateFilter?: string;
}

function parseSearchQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = { text: '' };
  const tokens: string[] = [];

  const parts = raw.split(/\s+/);
  for (const part of parts) {
    const lower = part.toLowerCase();

    if (lower.startsWith('type:')) {
      const val = lower.slice(5);
      if (val === 'bank' || val === 'saoke') result.docType = 'bank_statement';
      else if (val === 'hdra' || val === 'out') result.docType = 'invoice_out';
      else if (val === 'hdv' || val === 'in') result.docType = 'invoice_in';
      continue;
    }

    if (lower.startsWith('status:')) {
      result.status = lower.slice(7);
      continue;
    }

    if (lower.startsWith('in:')) {
      result.folder = part.slice(3);
      continue;
    }

    const trMatch = lower.match(/^(\d+)tr-(\d+)tr$/);
    if (trMatch) {
      result.amountMin = parseInt(trMatch[1]) * 1_000_000;
      result.amountMax = parseInt(trMatch[2]) * 1_000_000;
      continue;
    }
    if (lower.startsWith('>') && !isNaN(Number(lower.slice(1)))) {
      result.amountMin = Number(lower.slice(1));
      continue;
    }
    if (lower.startsWith('<') && !isNaN(Number(lower.slice(1)))) {
      result.amountMax = Number(lower.slice(1));
      continue;
    }

    if (/^\d{4}-\d{2}(-\d{2})?$/.test(part)) {
      result.dateFilter = part;
      continue;
    }

    tokens.push(part);
  }

  result.text = tokens.join(' ');
  return result;
}

describe('parseSearchQuery', () => {
  describe('browse mode (folder-only queries)', () => {
    it('parses folder-only query with no text', () => {
      const result = parseSearchQuery('in:2024/Q1');
      expect(result.folder).toBe('2024/Q1');
      expect(result.text).toBe('');
    });

    it('parses folder with text search', () => {
      const result = parseSearchQuery('in:2024/Q1 invoice');
      expect(result.folder).toBe('2024/Q1');
      expect(result.text).toBe('invoice');
    });

    it('parses folder with type filter', () => {
      const result = parseSearchQuery('in:2024 type:bank');
      expect(result.folder).toBe('2024');
      expect(result.docType).toBe('bank_statement');
      expect(result.text).toBe('');
    });
  });

  describe('text search', () => {
    it('parses plain text', () => {
      const result = parseSearchQuery('abc company');
      expect(result.text).toBe('abc company');
      expect(result.folder).toBeUndefined();
    });

    it('handles empty query', () => {
      const result = parseSearchQuery('');
      expect(result.text).toBe('');
    });
  });

  describe('type filters', () => {
    it('parses type:bank', () => {
      expect(parseSearchQuery('type:bank').docType).toBe('bank_statement');
    });

    it('parses type:saoke', () => {
      expect(parseSearchQuery('type:saoke').docType).toBe('bank_statement');
    });

    it('parses type:hdra', () => {
      expect(parseSearchQuery('type:hdra').docType).toBe('invoice_out');
    });

    it('parses type:out', () => {
      expect(parseSearchQuery('type:out').docType).toBe('invoice_out');
    });

    it('parses type:hdv', () => {
      expect(parseSearchQuery('type:hdv').docType).toBe('invoice_in');
    });

    it('parses type:in', () => {
      expect(parseSearchQuery('type:in').docType).toBe('invoice_in');
    });
  });

  describe('amount filters', () => {
    it('parses Vietnamese triệu range (Ntr-Mtr)', () => {
      const result = parseSearchQuery('5tr-10tr');
      expect(result.amountMin).toBe(5_000_000);
      expect(result.amountMax).toBe(10_000_000);
    });

    it('parses greater than', () => {
      expect(parseSearchQuery('>1000000').amountMin).toBe(1_000_000);
    });

    it('parses less than', () => {
      expect(parseSearchQuery('<5000000').amountMax).toBe(5_000_000);
    });
  });

  describe('date filters', () => {
    it('parses YYYY-MM', () => {
      expect(parseSearchQuery('2024-01').dateFilter).toBe('2024-01');
    });

    it('parses YYYY-MM-DD', () => {
      expect(parseSearchQuery('2024-01-15').dateFilter).toBe('2024-01-15');
    });
  });

  describe('status filters', () => {
    it('parses status:conflict', () => {
      expect(parseSearchQuery('status:conflict').status).toBe('conflict');
    });

    it('parses status:review', () => {
      expect(parseSearchQuery('status:review').status).toBe('review');
    });
  });

  describe('combined queries', () => {
    it('parses complex query with all filters', () => {
      const result = parseSearchQuery('in:2024/Q1 type:bank >5000000 2024-03 some text');
      expect(result.folder).toBe('2024/Q1');
      expect(result.docType).toBe('bank_statement');
      expect(result.amountMin).toBe(5_000_000);
      expect(result.dateFilter).toBe('2024-03');
      expect(result.text).toBe('some text');
    });
  });
});
