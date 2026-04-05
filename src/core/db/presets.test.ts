import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createInMemoryDb } from '../../__tests__/helpers/mock-db';

// Mock getDatabase to return our in-memory db
vi.mock('./database', () => ({
  getDatabase: () => _testDb,
}));

let _testDb: Database.Database;

// Import after mock is set up
import { listPresets, savePreset, deletePreset } from './presets';

describe('filter presets', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
  });

  afterEach(() => {
    _testDb.close();
  });

  it('starts with no presets', () => {
    expect(listPresets()).toHaveLength(0);
  });

  it('saves and lists a preset', () => {
    const filtersJson = JSON.stringify({ query: 'test', filters: { text: '', docType: 'bank_statement' }, folderScope: null, fileScope: null });
    const preset = savePreset('My Preset', filtersJson);

    expect(preset.id).toBeTruthy();
    expect(preset.name).toBe('My Preset');
    expect(preset.filters_json).toBe(filtersJson);
    expect(preset.created_at).toBeTruthy();

    const all = listPresets();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('My Preset');
  });

  it('lists all saved presets', () => {
    savePreset('First', '{}');
    savePreset('Second', '{}');
    savePreset('Third', '{}');

    const all = listPresets();
    expect(all).toHaveLength(3);
    const names = all.map(p => p.name);
    expect(names).toContain('First');
    expect(names).toContain('Second');
    expect(names).toContain('Third');
  });

  it('deletes a preset', () => {
    const p1 = savePreset('Keep', '{}');
    const p2 = savePreset('Delete', '{}');

    deletePreset(p2.id);

    const all = listPresets();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(p1.id);
  });

  it('deleting non-existent preset is a no-op', () => {
    savePreset('Exists', '{}');
    deletePreset('non-existent-id');
    expect(listPresets()).toHaveLength(1);
  });

  it('preserves full JSON filter state', () => {
    const filtersJson = JSON.stringify({
      query: 'ncc abc',
      filters: {
        text: '',
        docType: 'invoice_in',
        amountMin: 5000000,
        dateFilter: '2026-03',
        sortField: 'amount',
        sortDirection: 'desc',
      },
      folderScope: 'invoices/2026',
      fileScope: null,
    });

    savePreset('Q1 Invoices', filtersJson);
    const loaded = listPresets()[0];

    expect(JSON.parse(loaded.filters_json)).toEqual(JSON.parse(filtersJson));
  });
});
