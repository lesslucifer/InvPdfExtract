import { DocType, JEEntryType } from './types';

/** Derive the debit/credit side from doc_type + entry_type (deterministic, not stored). */
export function getJeSide(
  docType: DocType,
  entryType: JEEntryType,
): 'debit' | 'credit' {
  if (entryType === 'bank') return 'debit';
  if (docType === DocType.InvoiceIn) {
    return entryType === 'settlement' ? 'credit' : 'debit';
  }
  // invoice_out
  return entryType === 'settlement' ? 'debit' : 'credit';
}

/** Default account codes for auto-generated tax and settlement entries. */
export function getDefaultAccount(
  docType: DocType,
  entryType: 'tax' | 'settlement',
): string {
  if (entryType === 'tax') {
    return docType === DocType.InvoiceIn ? '1331' : '3331';
  }
  // settlement
  return docType === DocType.InvoiceIn ? '331' : '131';
}
