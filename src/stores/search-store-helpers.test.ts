import { describe, expect, it } from 'vitest';
import { DocType, FileStatus, type SearchResult } from '../shared/types';
import { replaceSearchResult } from './search-store-helpers';

function makeResult(id: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id,
    doc_type: DocType.InvoiceIn,
    confidence: 0.9,
    doc_date: '2026-04-08',
    relative_path: `${id}.pdf`,
    file_status: FileStatus.Done,
    bank_name: '',
    account_number: '',
    amount: 0,
    invoice_code: 'AA/26E',
    invoice_number: '0001',
    total_before_tax: 100,
    total_amount: 110,
    tax_id: '1234567890',
    line_item_sum: 110,
    line_item_sum_before_tax: 100,
    counterparty_name: 'Vendor',
    description: '',
    counterparty_address: '',
    je_status: null,
    has_duplicates: false,
    ...overrides,
  };
}

describe('replaceSearchResult', () => {
  it('replaces only the matching result', () => {
    const original = [makeResult('one'), makeResult('two')];
    const updated = makeResult('two', {
      invoice_number: '0099',
      tax_id: '9999999999',
      counterparty_name: 'Updated Vendor',
    });

    const next = replaceSearchResult(original, updated);

    expect(next[0]).toEqual(original[0]);
    expect(next[1]).toEqual(updated);
  });

  it('leaves the list unchanged when the result is missing', () => {
    const original = [makeResult('one')];
    const updated = makeResult('two', { invoice_number: '0099' });

    const next = replaceSearchResult(original, updated);

    expect(next).toEqual(original);
  });
});
