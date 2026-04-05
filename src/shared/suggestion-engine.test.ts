import { describe, it, expect } from 'vitest';
import { getActiveToken, getSuggestions, getPartialPrefixMatch } from './suggestion-engine';
import { ParsedQuery } from './parse-query';

const emptyFilters: ParsedQuery = { text: '' };

describe('getActiveToken', () => {
  it('extracts single token at end', () => {
    expect(getActiveToken('type:', 5)).toEqual({ text: 'type:', startIndex: 0 });
  });

  it('extracts last token after space', () => {
    expect(getActiveToken('hello type:', 11)).toEqual({ text: 'type:', startIndex: 6 });
  });

  it('extracts token at cursor in the middle', () => {
    expect(getActiveToken('type:bank sort:', 9)).toEqual({ text: 'type:bank', startIndex: 0 });
  });

  it('returns empty for cursor right after space', () => {
    expect(getActiveToken('type:bank ', 10)).toEqual({ text: '', startIndex: 10 });
  });

  it('handles empty input', () => {
    expect(getActiveToken('', 0)).toEqual({ text: '', startIndex: 0 });
  });
});

describe('getSuggestions', () => {
  describe('prefix-colon triggers', () => {
    it('shows type suggestions for "type:"', () => {
      const results = getSuggestions('type:', 5, emptyFilters);
      expect(results).toHaveLength(3);
      expect(results.map(r => r.label)).toEqual(['Bank Statement', 'Invoice Out', 'Invoice In']);
    });

    it('filters type suggestions by value "type:ba"', () => {
      const results = getSuggestions('type:ba', 7, emptyFilters);
      expect(results).toHaveLength(1);
      expect(results[0].label).toBe('Bank Statement');
    });

    it('matches Vietnamese alias "type:sao"', () => {
      const results = getSuggestions('type:sao', 8, emptyFilters);
      expect(results).toHaveLength(1);
      expect(results[0].label).toBe('Bank Statement');
    });

    it('shows status suggestions for "status:"', () => {
      const results = getSuggestions('status:', 7, emptyFilters);
      expect(results).toHaveLength(3);
      expect(results.map(r => r.label)).toEqual(['Conflict', 'Needs Review', 'Mismatch']);
    });

    it('shows sort suggestions for "sort:" (one per field)', () => {
      const results = getSuggestions('sort:', 5, emptyFilters);
      expect(results).toHaveLength(6); // 6 fields: date, time, amount, path, confidence, shd
    });

    it('filters sort suggestions by value "sort:dat"', () => {
      const results = getSuggestions('sort:dat', 8, emptyFilters);
      expect(results).toHaveLength(1);
      expect(results[0].label).toBe('Date');
    });

    it('returns empty for unknown prefix "foo:"', () => {
      const results = getSuggestions('foo:', 4, emptyFilters);
      expect(results).toHaveLength(0);
    });
  });

  describe('excludes categories with active pills', () => {
    it('excludes type suggestions when docType pill exists', () => {
      const filters: ParsedQuery = { text: '', docType: 'bank_statement' };
      const results = getSuggestions('type:', 5, filters);
      expect(results).toHaveLength(0);
    });

    it('excludes status suggestions when status pill exists', () => {
      const filters: ParsedQuery = { text: '', status: 'conflict' };
      const results = getSuggestions('status:', 7, filters);
      expect(results).toHaveLength(0);
    });

    it('excludes sort suggestions when sortField pill exists', () => {
      const filters: ParsedQuery = { text: '', sortField: 'date' };
      const results = getSuggestions('sort:', 5, filters);
      expect(results).toHaveLength(0);
    });
  });

  describe('sort by shd', () => {
    it('shows shd in sort suggestions for "sort:shd"', () => {
      const results = getSuggestions('sort:shd', 8, emptyFilters);
      expect(results).toHaveLength(1);
      expect(results[0].label).toBe('Invoice #');
    });
  });

  describe('multi-token input', () => {
    it('suggests for the active token after other text', () => {
      const input = 'company type:';
      const results = getSuggestions(input, input.length, emptyFilters);
      expect(results).toHaveLength(3); // all type suggestions
    });

    it('suggests when cursor is on a mid-input token', () => {
      const input = 'type:ba sort:date';
      // cursor at position 7 = end of "type:ba"
      const results = getSuggestions(input, 7, emptyFilters);
      expect(results).toHaveLength(1);
      expect(results[0].label).toBe('Bank Statement');
    });
  });

  describe('partial prefix matching', () => {
    it('suggests "type:" for input "ty"', () => {
      const results = getSuggestions('ty', 2, emptyFilters);
      expect(results).toHaveLength(1);
      expect(results[0].insertText).toBe('type:');
    });

    it('suggests "sort:" for input "sor"', () => {
      const results = getSuggestions('sor', 3, emptyFilters);
      expect(results).toHaveLength(1);
      expect(results[0].insertText).toBe('sort:');
    });

    it('suggests "status:" for input "sta"', () => {
      const results = getSuggestions('sta', 3, emptyFilters);
      expect(results).toHaveLength(1);
      expect(results[0].insertText).toBe('status:');
    });

    it('does not suggest "amount:" for input "am" (no longer a prefix hint)', () => {
      const results = getSuggestions('am', 2, emptyFilters);
      expect(results).toHaveLength(0);
    });

    it('does not suggest "date:" for input "da" (no longer a prefix hint)', () => {
      const results = getSuggestions('da', 2, emptyFilters);
      expect(results).toHaveLength(0);
    });

    it('does not suggest for single character "t"', () => {
      const results = getSuggestions('t', 1, emptyFilters);
      expect(results).toHaveLength(0);
    });

    it('does not suggest prefix when full prefix is typed', () => {
      // "type" without colon — should not match since prefix === token
      const results = getSuggestions('type', 4, emptyFilters);
      expect(results).toHaveLength(0);
    });

    it('excludes prefix hint when that filter is active', () => {
      const filters: ParsedQuery = { text: '', docType: 'bank_statement' };
      const results = getSuggestions('ty', 2, filters);
      expect(results).toHaveLength(0);
    });
  });

  describe('amount suggestions', () => {
    it('shows amount options for "amount:"', () => {
      const results = getSuggestions('amount:', 7, emptyFilters);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].category).toBe('amount');
    });

    it('filters amount options by value "amount:>5"', () => {
      const results = getSuggestions('amount:>5', 9, emptyFilters);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every(r => r.label.includes('5'))).toBe(true);
    });

    it('excludes amount suggestions when amountMin is active', () => {
      const filters: ParsedQuery = { text: '', amountMin: 1000000 };
      const results = getSuggestions('amount:', 7, filters);
      expect(results).toHaveLength(0);
    });
  });

  describe('date suggestions', () => {
    it('shows date options for "date:"', () => {
      const results = getSuggestions('date:', 5, emptyFilters);
      expect(results.length).toBe(4); // today, this month, last month, this year
      expect(results[0].category).toBe('date');
    });

    it('filters date options by label "date:to"', () => {
      const results = getSuggestions('date:to', 7, emptyFilters);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].label).toBe('Today');
    });

    it('excludes date suggestions when dateFilter is active', () => {
      const filters: ParsedQuery = { text: '', dateFilter: '2026-04' };
      const results = getSuggestions('date:', 5, filters);
      expect(results).toHaveLength(0);
    });
  });

  describe('empty / no-match cases', () => {
    it('returns empty for empty input', () => {
      expect(getSuggestions('', 0, emptyFilters)).toHaveLength(0);
    });

    it('returns empty for plain text', () => {
      expect(getSuggestions('company name', 12, emptyFilters)).toHaveLength(0);
    });

    it('returns empty for amount expressions', () => {
      expect(getSuggestions('>5tr', 4, emptyFilters)).toHaveLength(0);
    });

    it('returns empty for date expressions', () => {
      expect(getSuggestions('2024-03', 7, emptyFilters)).toHaveLength(0);
    });
  });
});

describe('getPartialPrefixMatch', () => {
  it('matches "ty" to type prefix', () => {
    const result = getPartialPrefixMatch('ty', emptyFilters);
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('type');
  });

  it('matches "sor" to sort prefix', () => {
    const result = getPartialPrefixMatch('sor', emptyFilters);
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('sort');
  });

  it('does not match "am" (amount removed from prefix hints)', () => {
    const result = getPartialPrefixMatch('am', emptyFilters);
    expect(result).toBeNull();
  });

  it('does not match "da" (date removed from prefix hints)', () => {
    const result = getPartialPrefixMatch('da', emptyFilters);
    expect(result).toBeNull();
  });

  it('returns null for single char', () => {
    expect(getPartialPrefixMatch('t', emptyFilters)).toBeNull();
  });

  it('returns null for exact prefix match', () => {
    expect(getPartialPrefixMatch('type', emptyFilters)).toBeNull();
  });

  it('returns null when filter is already active', () => {
    const filters: ParsedQuery = { text: '', sortField: 'date' };
    expect(getPartialPrefixMatch('sor', filters)).toBeNull();
  });

});
