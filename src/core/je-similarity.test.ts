import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the DB layer and event bus
vi.mock('./db/journal-entries', () => ({
  getRecentClassifiedLineItems: vi.fn().mockReturnValue([]),
  getRecentClassifiedBankItems: vi.fn().mockReturnValue([]),
}));

vi.mock('./event-bus', () => ({
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));

import { JESimilarityEngine } from './je-similarity';
import { getRecentClassifiedLineItems, getRecentClassifiedBankItems } from './db/journal-entries';

const mockGetLineItems = vi.mocked(getRecentClassifiedLineItems);
const mockGetBankItems = vi.mocked(getRecentClassifiedBankItems);

describe('JESimilarityEngine', () => {
  let engine: JESimilarityEngine;

  beforeEach(() => {
    engine = new JESimilarityEngine(0.8, 1000); // Lower threshold for testing
    vi.clearAllMocks();
  });

  afterEach(() => {
    engine.destroy();
  });

  it('returns null when cache is empty', () => {
    mockGetLineItems.mockReturnValue([]);
    mockGetBankItems.mockReturnValue([]);
    engine.initialize();

    expect(engine.findMatch('Van phong pham')).toBeNull();
  });

  it('finds exact match with score 1.0', () => {
    mockGetLineItems.mockReturnValue([
      { mo_ta: 'Van phong pham', record_id: 'r1', line_item_id: 'li1', tk_no: '6422', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
    ]);
    mockGetBankItems.mockReturnValue([]);
    engine.initialize();

    const match = engine.findMatch('Van phong pham');
    expect(match).not.toBeNull();
    expect(match!.score).toBe(1.0);
    expect(match!.tkNo).toBe('6422');
    expect(match!.tkCo).toBe('331');
    expect(match!.matchedDescription).toBe('Van phong pham');
  });

  it('matches similar descriptions above threshold', () => {
    mockGetLineItems.mockReturnValue([
      { mo_ta: 'Dich vu tu van ke toan thang 3', record_id: 'r1', line_item_id: 'li1', tk_no: '642', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
    ]);
    mockGetBankItems.mockReturnValue([]);
    engine.initialize();

    // Very similar string
    const match = engine.findMatch('Dich vu tu van ke toan thang 4');
    expect(match).not.toBeNull();
    expect(match!.score).toBeGreaterThan(0.8);
    expect(match!.tkNo).toBe('642');
  });

  it('returns null for dissimilar descriptions', () => {
    mockGetLineItems.mockReturnValue([
      { mo_ta: 'Van phong pham', record_id: 'r1', line_item_id: 'li1', tk_no: '6422', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
    ]);
    mockGetBankItems.mockReturnValue([]);
    engine.initialize();

    const match = engine.findMatch('Thue mat bang van phong');
    // These are dissimilar enough to be below 0.8 threshold
    expect(match).toBeNull();
  });

  it('normalizes case for matching', () => {
    mockGetLineItems.mockReturnValue([
      { mo_ta: 'Van Phong Pham', record_id: 'r1', line_item_id: 'li1', tk_no: '6422', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
    ]);
    mockGetBankItems.mockReturnValue([]);
    engine.initialize();

    const match = engine.findMatch('van phong pham');
    expect(match).not.toBeNull();
    expect(match!.score).toBe(1.0);
  });

  it('returns null for very short strings (< 2 chars)', () => {
    mockGetLineItems.mockReturnValue([
      { mo_ta: 'A', record_id: 'r1', line_item_id: 'li1', tk_no: '156', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
    ]);
    mockGetBankItems.mockReturnValue([]);
    engine.initialize();

    expect(engine.findMatch('B')).toBeNull();
  });

  it('returns the best match when multiple candidates exist', () => {
    mockGetLineItems.mockReturnValue([
      { mo_ta: 'Dich vu internet thang 3', record_id: 'r1', line_item_id: 'li1', tk_no: '6427', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
      { mo_ta: 'Dich vu tu van thue thang 3', record_id: 'r2', line_item_id: 'li2', tk_no: '642', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
    ]);
    mockGetBankItems.mockReturnValue([]);
    engine.initialize();

    const match = engine.findMatch('Dich vu internet thang 4');
    expect(match).not.toBeNull();
    expect(match!.tkNo).toBe('6427'); // Should match internet, not tu van
  });

  it('reports cache size correctly', () => {
    mockGetLineItems.mockReturnValue([
      { mo_ta: 'Item 1', record_id: 'r1', line_item_id: 'li1', tk_no: '156', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
      { mo_ta: 'Item 2', record_id: 'r2', line_item_id: 'li2', tk_no: '642', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
    ]);
    mockGetBankItems.mockReturnValue([
      { mo_ta: 'Bank item', record_id: 'b1', line_item_id: null, tk_no: '112', tk_co: '131', cash_flow: 'operating', entry_type: 'bank' },
    ]);
    engine.initialize();

    expect(engine.getCacheSize()).toBe(3);
  });

  it('filters out empty descriptions', () => {
    mockGetLineItems.mockReturnValue([
      { mo_ta: '', record_id: 'r1', line_item_id: 'li1', tk_no: '156', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
      { mo_ta: '  ', record_id: 'r2', line_item_id: 'li2', tk_no: '642', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
      { mo_ta: 'Valid', record_id: 'r3', line_item_id: 'li3', tk_no: '156', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
    ]);
    mockGetBankItems.mockReturnValue([]);
    engine.initialize();

    expect(engine.getCacheSize()).toBe(1);
  });

  it('destroy clears cache and state', () => {
    mockGetLineItems.mockReturnValue([
      { mo_ta: 'Test', record_id: 'r1', line_item_id: 'li1', tk_no: '156', tk_co: '331', cash_flow: 'operating', entry_type: 'line' },
    ]);
    mockGetBankItems.mockReturnValue([]);
    engine.initialize();
    expect(engine.getCacheSize()).toBe(1);

    engine.destroy();
    expect(engine.getCacheSize()).toBe(0);
  });
});
