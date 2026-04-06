import { describe, it, expect } from 'vitest';
import {
  BUILTIN_KEYWORDS,
  getMergedKeywords,
  createKeywordMatcher,
} from './keyword-bank';
import { DEFAULT_FILTER_CONFIG } from '../../shared/constants';
import type { FilterKeyword } from '../../shared/types';

describe('getMergedKeywords', () => {
  it('returns builtins when no custom keywords', () => {
    const result = getMergedKeywords({ ...DEFAULT_FILTER_CONFIG, customKeywords: [] });
    expect(result).toEqual(BUILTIN_KEYWORDS);
  });

  it('overrides existing builtin keyword with same term', () => {
    const custom: FilterKeyword = { term: 'invoice', weight: 0.99, category: 'invoice' };
    const result = getMergedKeywords({ ...DEFAULT_FILTER_CONFIG, customKeywords: [custom] });
    const invoiceEntry = result.find(k => k.term === 'invoice');
    expect(invoiceEntry?.weight).toBe(0.99);
    expect(result.length).toBe(BUILTIN_KEYWORDS.length);
  });

  it('adds new custom keyword not in builtins', () => {
    const custom: FilterKeyword = { term: 'bespoke term xyz', weight: 0.7, category: 'general_accounting' };
    const result = getMergedKeywords({ ...DEFAULT_FILTER_CONFIG, customKeywords: [custom] });
    expect(result.length).toBe(BUILTIN_KEYWORDS.length + 1);
    expect(result.find(k => k.term === 'bespoke term xyz')).toBeDefined();
  });

  it('is case-insensitive when matching existing terms for override', () => {
    const custom: FilterKeyword = { term: 'INVOICE', weight: 0.5, category: 'invoice' };
    const result = getMergedKeywords({ ...DEFAULT_FILTER_CONFIG, customKeywords: [custom] });
    expect(result.length).toBe(BUILTIN_KEYWORDS.length);
  });
});

describe('createKeywordMatcher', () => {
  const matcher = createKeywordMatcher(BUILTIN_KEYWORDS);

  it('Vietnamese invoice text scores high (> 0.8)', () => {
    const text = 'hoa don GTGT so hoa don MST nha cung cap tong tien truoc thue';
    const { score } = matcher(text);
    expect(score).toBeGreaterThan(0.8);
  });

  it('English invoice text scores moderate (> 0.5)', () => {
    const text = 'invoice total VAT billing amount subtotal payment';
    const { score } = matcher(text);
    expect(score).toBeGreaterThan(0.5);
  });

  it('irrelevant text scores low (< 0.2)', () => {
    const text = 'family vacation photos summer beach holiday trip';
    const { score } = matcher(text);
    expect(score).toBeLessThan(0.2);
  });

  it('fuzzy OCR typo still matches (> 0.4)', () => {
    // 'invoise' is a common OCR typo for 'invoice'
    const text = 'invoise tottal VAT bilding';
    const { score } = matcher(text);
    expect(score).toBeGreaterThan(0.4);
  });

  it('bank statement text scores high (> 0.7)', () => {
    const text = 'sao ke ngan hang tai khoan chuyen khoan so du giao dich';
    const { score } = matcher(text);
    expect(score).toBeGreaterThan(0.7);
  });

  it('returns matched terms list', () => {
    const text = 'invoice VAT';
    const { matchedTerms } = matcher(text);
    expect(matchedTerms.length).toBeGreaterThan(0);
    const terms = matchedTerms.map(m => m.term.toLowerCase());
    expect(terms).toContain('invoice');
  });

  it('returns score 0 and empty terms for empty text', () => {
    const { score, matchedTerms } = matcher('');
    expect(score).toBe(0);
    expect(matchedTerms).toHaveLength(0);
  });

  it('score is clamped to max 1.0', () => {
    const text = Array(20).fill('hoa don GTGT invoice VAT MST sao ke ngan hang ke toan').join(' ');
    const { score } = matcher(text);
    expect(score).toBeLessThanOrEqual(1.0);
  });
});
