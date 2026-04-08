import { describe, it, expect } from 'vitest';
import { parseSearchQuery, buildQueryString } from './parse-query';

describe('parseSearchQuery', () => {
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

    it('parses >Ntr suffix', () => {
      const result = parseSearchQuery('>3tr');
      expect(result.amountMin).toBe(3_000_000);
    });

    it('parses <Ntr suffix', () => {
      const result = parseSearchQuery('<5tr');
      expect(result.amountMax).toBe(5_000_000);
    });

    it('parses plain number range (N-M)', () => {
      const result = parseSearchQuery('300000-500000');
      expect(result.amountMin).toBe(300_000);
      expect(result.amountMax).toBe(500_000);
    });

    it('parses k suffix (thousands)', () => {
      expect(parseSearchQuery('>100k').amountMin).toBe(100_000);
      expect(parseSearchQuery('<500k').amountMax).toBe(500_000);
      expect(parseSearchQuery('100k-500k').amountMin).toBe(100_000);
      expect(parseSearchQuery('100k-500k').amountMax).toBe(500_000);
    });

    it('parses m suffix (millions)', () => {
      expect(parseSearchQuery('>10m').amountMin).toBe(10_000_000);
      expect(parseSearchQuery('<5m').amountMax).toBe(5_000_000);
    });

    it('parses b suffix (billions)', () => {
      expect(parseSearchQuery('>1b').amountMin).toBe(1_000_000_000);
      expect(parseSearchQuery('<2b').amountMax).toBe(2_000_000_000);
    });

    it('parses t suffix (tỷ = billions)', () => {
      expect(parseSearchQuery('>1t').amountMin).toBe(1_000_000_000);
      expect(parseSearchQuery('1t-5t').amountMin).toBe(1_000_000_000);
      expect(parseSearchQuery('1t-5t').amountMax).toBe(5_000_000_000);
    });

    it('supports mixed suffixes in ranges', () => {
      const result = parseSearchQuery('500k-2m');
      expect(result.amountMin).toBe(500_000);
      expect(result.amountMax).toBe(2_000_000);
    });

    it('supports decimal with suffix', () => {
      expect(parseSearchQuery('>1.5tr').amountMin).toBe(1_500_000);
      expect(parseSearchQuery('>2.5b').amountMin).toBe(2_500_000_000);
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
    it('parses status:uncertain', () => {
      expect(parseSearchQuery('status:uncertain').status).toBe('uncertain');
    });

    it('parses status:mismatch', () => {
      expect(parseSearchQuery('status:mismatch').status).toBe('mismatch');
    });

    it('parses status:ok', () => {
      expect(parseSearchQuery('status:ok').status).toBe('ok');
    });
  });

  describe('taxId filters', () => {
    it('parses taxId:<value>', () => {
      expect(parseSearchQuery('taxId:0123456789').taxId).toBe('0123456789');
    });

    it('preserves original case', () => {
      expect(parseSearchQuery('taxId:ABC123').taxId).toBe('ABC123');
    });
  });

  describe('invoice code filters', () => {
    it('parses code:<value>', () => {
      expect(parseSearchQuery('code:C26TAA').invoiceCode).toBe('C26TAA');
    });

    it('parses invoiceCode:<value>', () => {
      expect(parseSearchQuery('invoiceCode:AA/26E').invoiceCode).toBe('AA/26E');
    });
  });

  describe('sort filters', () => {
    it('parses sort:date', () => {
      const result = parseSearchQuery('sort:date');
      expect(result.sortField).toBe('date');
      expect(result.sortDirection).toBeUndefined();
    });

    it('parses sort:amount-desc', () => {
      const result = parseSearchQuery('sort:amount-desc');
      expect(result.sortField).toBe('amount');
      expect(result.sortDirection).toBe('desc');
    });

    it('parses sort:amount-asc', () => {
      const result = parseSearchQuery('sort:amount-asc');
      expect(result.sortField).toBe('amount');
      expect(result.sortDirection).toBe('asc');
    });

    it('parses sort:processed as sort:time', () => {
      const result = parseSearchQuery('sort:processed');
      expect(result.sortField).toBe('time');
    });

    it('parses sort:confidence', () => {
      const result = parseSearchQuery('sort:confidence');
      expect(result.sortField).toBe('confidence');
    });

    it('parses sort:path-desc', () => {
      const result = parseSearchQuery('sort:path-desc');
      expect(result.sortField).toBe('path');
      expect(result.sortDirection).toBe('desc');
    });

    it('parses sort:shd', () => {
      const result = parseSearchQuery('sort:shd');
      expect(result.sortField).toBe('shd');
      expect(result.sortDirection).toBeUndefined();
    });

    it('treats sort:invalid as plain text', () => {
      const result = parseSearchQuery('sort:invalid');
      expect(result.sortField).toBeUndefined();
      expect(result.text).toBe('sort:invalid');
    });

    it('last sort: token wins when multiple present', () => {
      const result = parseSearchQuery('sort:date sort:amount');
      expect(result.sortField).toBe('amount');
    });
  });

  describe('combined queries', () => {
    it('parses complex query with all filters', () => {
      const result = parseSearchQuery('type:bank >5000000 2024-03 some text');
      expect(result.docType).toBe('bank_statement');
      expect(result.amountMin).toBe(5_000_000);
      expect(result.dateFilter).toBe('2024-03');
      expect(result.text).toBe('some text');
    });

    it('parses combined query with sort', () => {
      const result = parseSearchQuery('type:in sort:amount >5tr company');
      expect(result.docType).toBe('invoice_in');
      expect(result.sortField).toBe('amount');
      expect(result.amountMin).toBe(5_000_000);
      expect(result.text).toBe('company');
    });

    it('treats in: token as plain text (no longer parsed)', () => {
      const result = parseSearchQuery('in:2024/Q1 invoice');
      expect((result as any).folder).toBeUndefined();
      expect(result.text).toBe('in:2024/Q1 invoice');
    });
  });
});

describe('buildQueryString', () => {
  it('builds from text only', () => {
    expect(buildQueryString({ text: 'hello' })).toBe('hello');
  });

  it('builds from docType', () => {
    expect(buildQueryString({ text: '', docType: 'bank_statement' })).toBe('type:bank');
  });

  it('builds from invoice_out', () => {
    expect(buildQueryString({ text: '', docType: 'invoice_out' })).toBe('type:out');
  });

  it('builds from invoice_in', () => {
    expect(buildQueryString({ text: '', docType: 'invoice_in' })).toBe('type:in');
  });

  it('builds from status', () => {
    expect(buildQueryString({ text: '', status: 'uncertain' })).toBe('status:uncertain');
  });

  it('builds from taxId', () => {
    expect(buildQueryString({ text: '', taxId: '0123456789' })).toBe('taxId:0123456789');
  });

  it('builds from invoiceCode', () => {
    expect(buildQueryString({ text: '', invoiceCode: 'C26TAA' })).toBe('code:C26TAA');
  });

  it('builds from amount range (triệu shorthand)', () => {
    expect(buildQueryString({ text: '', amountMin: 5_000_000, amountMax: 10_000_000 }))
      .toBe('5tr-10tr');
  });

  it('builds from amount range (non-triệu)', () => {
    expect(buildQueryString({ text: '', amountMin: 1234, amountMax: 5678 }))
      .toBe('>1234 <5678');
  });

  it('builds from amountMin only', () => {
    expect(buildQueryString({ text: '', amountMin: 1000000 })).toBe('>1000000');
  });

  it('builds from amountMax only', () => {
    expect(buildQueryString({ text: '', amountMax: 5000000 })).toBe('<5000000');
  });

  it('builds from dateFilter', () => {
    expect(buildQueryString({ text: '', dateFilter: '2024-03' })).toBe('2024-03');
  });

  it('builds complex query with all fields', () => {
    const result = buildQueryString({
      text: 'some text',
      docType: 'bank_statement',
      status: 'uncertain',
      amountMin: 5_000_000,
      amountMax: 10_000_000,
      dateFilter: '2024-03',
    });
    expect(result).toBe('type:bank status:uncertain 5tr-10tr 2024-03 some text');
  });

  it('returns empty string for empty parsed query', () => {
    expect(buildQueryString({ text: '' })).toBe('');
  });

  it('builds sort with default direction (omits suffix)', () => {
    expect(buildQueryString({ text: '', sortField: 'amount' })).toBe('sort:amount');
  });

  it('builds sort with non-default direction (includes suffix)', () => {
    expect(buildQueryString({ text: '', sortField: 'date', sortDirection: 'asc' })).toBe('sort:date-asc');
  });

  it('builds sort with explicit default direction (omits suffix)', () => {
    expect(buildQueryString({ text: '', sortField: 'path', sortDirection: 'asc' })).toBe('sort:path');
  });

  describe('round-trip: parse → build → parse', () => {
    it('preserves text-only query', () => {
      const original = 'abc company';
      const parsed = parseSearchQuery(original);
      const rebuilt = buildQueryString(parsed);
      const reparsed = parseSearchQuery(rebuilt);
      expect(reparsed.text).toBe('abc company');
    });

    it('preserves complex query', () => {
      const original = 'type:bank >5000000 2024-03 some text';
      const parsed = parseSearchQuery(original);
      const rebuilt = buildQueryString(parsed);
      const reparsed = parseSearchQuery(rebuilt);
      expect(reparsed.docType).toBe('bank_statement');
      expect(reparsed.amountMin).toBe(5_000_000);
      expect(reparsed.dateFilter).toBe('2024-03');
      expect(reparsed.text).toBe('some text');
    });

    it('round-trips sort:amount', () => {
      const original = 'sort:amount some text';
      const parsed = parseSearchQuery(original);
      const rebuilt = buildQueryString(parsed);
      const reparsed = parseSearchQuery(rebuilt);
      expect(reparsed.sortField).toBe('amount');
      expect(reparsed.text).toBe('some text');
    });

    it('round-trips sort:date-asc', () => {
      const original = 'sort:date-asc';
      const parsed = parseSearchQuery(original);
      const rebuilt = buildQueryString(parsed);
      const reparsed = parseSearchQuery(rebuilt);
      expect(reparsed.sortField).toBe('date');
      expect(reparsed.sortDirection).toBe('asc');
    });

    it('round-trips filter removal correctly', () => {
      const original = 'ABC type:out 2024-03';
      const parsed = parseSearchQuery(original);
      // Remove docType
      delete parsed.docType;
      const rebuilt = buildQueryString(parsed);
      const reparsed = parseSearchQuery(rebuilt);
      expect(reparsed.text).toBe('ABC');
      expect(reparsed.dateFilter).toBe('2024-03');
      expect(reparsed.docType).toBeUndefined();
    });
  });
});
