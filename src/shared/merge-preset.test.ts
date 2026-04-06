import { describe, it, expect } from 'vitest';
import { mergePresetState, MergeInput } from './merge-preset';

const empty: MergeInput = {
  currentQuery: '',
  currentFilters: { text: '' },
  currentFolderScope: null,
  currentFileScope: null,
};

describe('mergePresetState', () => {
  it('applies preset to empty state', () => {
    const preset = JSON.stringify({
      query: 'abc',
      filters: { text: '', docType: 'bank_statement', amountMin: 5000000 },
      folderScope: 'invoices',
      fileScope: null,
    });

    const result = mergePresetState(empty, preset);
    expect(result.query).toBe('abc');
    expect(result.filters.docType).toBe('bank_statement');
    expect(result.filters.amountMin).toBe(5000000);
    expect(result.folderScope).toBe('invoices');
    expect(result.fileScope).toBeNull();
  });

  it('appends query text', () => {
    const current: MergeInput = { ...empty, currentQuery: 'abc' };
    const preset = JSON.stringify({
      query: 'xyz',
      filters: { text: '' },
      folderScope: null,
      fileScope: null,
    });

    const result = mergePresetState(current, preset);
    expect(result.query).toBe('abc xyz');
  });

  it('dedupes identical query', () => {
    const current: MergeInput = { ...empty, currentQuery: 'abc' };
    const preset = JSON.stringify({
      query: 'abc',
      filters: { text: '' },
      folderScope: null,
      fileScope: null,
    });

    const result = mergePresetState(current, preset);
    expect(result.query).toBe('abc');
  });

  it('keeps current filters when set, fills empty ones', () => {
    const current: MergeInput = {
      ...empty,
      currentFilters: { text: '', docType: 'bank_statement' },
    };
    const preset = JSON.stringify({
      query: '',
      filters: { text: '', docType: 'invoice_in', sortField: 'date', sortDirection: 'desc', amountMin: 5000000 },
      folderScope: null,
      fileScope: null,
    });

    const result = mergePresetState(current, preset);
    expect(result.filters.docType).toBe('bank_statement'); // kept
    expect(result.filters.sortField).toBe('date'); // filled
    expect(result.filters.sortDirection).toBe('desc'); // filled
    expect(result.filters.amountMin).toBe(5000000); // filled
  });

  it('keeps current scope, fills empty ones', () => {
    const current: MergeInput = {
      ...empty,
      currentFolderScope: 'my-folder',
    };
    const preset = JSON.stringify({
      query: '',
      filters: { text: '' },
      folderScope: 'preset-folder',
      fileScope: 'preset-file.pdf',
    });

    const result = mergePresetState(current, preset);
    expect(result.folderScope).toBe('my-folder'); // kept
    expect(result.fileScope).toBe('preset-file.pdf'); // filled
  });

  it('handles preset with empty query and no filters', () => {
    const current: MergeInput = { ...empty, currentQuery: 'existing' };
    const preset = JSON.stringify({
      query: '',
      filters: { text: '' },
      folderScope: null,
      fileScope: null,
    });

    const result = mergePresetState(current, preset);
    expect(result.query).toBe('existing');
  });

  it('fills taxId from preset when current has none', () => {
    const result = mergePresetState(empty, JSON.stringify({
      query: '',
      filters: { text: '', taxId: '0123456789' },
      folderScope: null,
      fileScope: null,
    }));
    expect(result.filters.taxId).toBe('0123456789');
  });

  it('keeps current taxId when already set', () => {
    const current: MergeInput = {
      ...empty,
      currentFilters: { text: '', taxId: '1111111111' },
    };
    const result = mergePresetState(current, JSON.stringify({
      query: '',
      filters: { text: '', taxId: '2222222222' },
      folderScope: null,
      fileScope: null,
    }));
    expect(result.filters.taxId).toBe('1111111111');
  });

  it('fills amountMax when current has amountMin only', () => {
    const current: MergeInput = {
      ...empty,
      currentFilters: { text: '', amountMin: 1000000 },
    };
    const preset = JSON.stringify({
      query: '',
      filters: { text: '', amountMin: 5000000, amountMax: 10000000 },
      folderScope: null,
      fileScope: null,
    });

    const result = mergePresetState(current, preset);
    expect(result.filters.amountMin).toBe(1000000); // kept
    expect(result.filters.amountMax).toBe(10000000); // filled
  });
});
