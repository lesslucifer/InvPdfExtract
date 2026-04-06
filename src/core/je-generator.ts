import { getDatabase } from './db/database';
import { getLineItemsByRecord, getRecordsByFileId } from './db/records';
import {
  insertJournalEntry,
  deleteJournalEntriesByRecord,
  getJournalEntriesByRecord,
  findExistingEntry,
} from './db/journal-entries';
import { JESimilarityEngine } from './je-similarity';
import { classifyWithAI, UnclassifiedItem } from './je-ai-classifier';
import { eventBus } from './event-bus';
import { DocType, InvoiceLineItem, BankStatementData, DbRecord } from '../shared/types';
import { JE_AI_BATCH_SIZE } from '../shared/constants';
import { getDefaultAccount } from '../shared/je-utils';

export class JEGenerator {
  private similarityEngine: JESimilarityEngine;
  private vaultRoot: string;
  private cliPath?: string;
  private processing = new Set<string>();

  constructor(vaultRoot: string, similarityEngine: JESimilarityEngine, cliPath?: string) {
    this.vaultRoot = vaultRoot;
    this.similarityEngine = similarityEngine;
    this.cliPath = cliPath;
  }

  /**
   * Generate JEs for a single record. Used by manual UI trigger.
   * Flushes unmatched items to AI immediately.
   */
  async generateForRecord(recordId: string): Promise<number> {
    if (this.processing.has(recordId)) return 0;
    this.processing.add(recordId);

    try {
      const unmatched = this.classifyRecord(recordId);
      if (unmatched.length > 0) {
        await this.flushUnclassified(unmatched);
      }
      // Auto-generate tax + settlement after all line items are classified
      this.generateAutoEntries(recordId);
      const entries = getJournalEntriesByRecord(recordId);
      eventBus.emit('je:generated', { recordId, count: entries.length, source: 'ai' });
      return entries.length;
    } finally {
      this.processing.delete(recordId);
    }
  }

  /**
   * Generate JEs for all records in a file. Used by auto-trigger after extraction.
   */
  async generateForFile(fileId: string): Promise<number> {
    const records = getRecordsByFileId(fileId);
    if (records.length === 0) return 0;
    return this.generateBatch(records.map(r => r.id));
  }

  /**
   * Generate JEs for multiple records. Accumulates unmatched items, flushes in batches.
   */
  async generateBatch(recordIds: string[]): Promise<number> {
    const allUnmatched: UnclassifiedItem[] = [];
    let totalCount = 0;

    for (const recordId of recordIds) {
      if (this.processing.has(recordId)) continue;
      this.processing.add(recordId);
      try {
        const unmatched = this.classifyRecord(recordId);
        allUnmatched.push(...unmatched);
      } finally {
        this.processing.delete(recordId);
      }
    }

    // Flush in batches
    if (allUnmatched.length > 0) {
      for (let i = 0; i < allUnmatched.length; i += JE_AI_BATCH_SIZE) {
        const batch = allUnmatched.slice(i, i + JE_AI_BATCH_SIZE);
        await this.flushUnclassified(batch);
      }
    }

    // Generate auto entries and count
    for (const recordId of recordIds) {
      this.generateAutoEntries(recordId);
      const entries = getJournalEntriesByRecord(recordId);
      totalCount += entries.length;
      eventBus.emit('je:generated', { recordId, count: entries.length, source: 'ai' });
    }

    return totalCount;
  }

  /**
   * Regenerate all JEs. Used when instruction document changes.
   */
  async regenerateAll(): Promise<number> {
    const db = getDatabase();
    const recordIds = db.prepare(`
      SELECT DISTINCT r.id FROM records r
      LEFT JOIN invoice_line_items ili ON r.id = ili.record_id AND ili.deleted_at IS NULL
      LEFT JOIN bank_statement_data bsd ON r.id = bsd.record_id
      WHERE r.deleted_at IS NULL
        AND (ili.id IS NOT NULL OR bsd.record_id IS NOT NULL)
    `).all() as Array<{ id: string }>;

    return this.generateBatch(recordIds.map(r => r.id));
  }

  /**
   * Phase 1: Classify a single record using similarity matching.
   * Returns unmatched items for AI fallback.
   */
  private classifyRecord(recordId: string): UnclassifiedItem[] {
    const db = getDatabase();
    const record = db.prepare('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL').get(recordId) as DbRecord | undefined;
    if (!record) return [];

    // Delete existing non-user-edited JEs
    deleteJournalEntriesByRecord(recordId, true);

    const isInvoice = record.doc_type === DocType.InvoiceIn || record.doc_type === DocType.InvoiceOut;
    const isBank = record.doc_type === DocType.BankStatement;

    if (isInvoice) {
      return this.classifyInvoiceRecord(record);
    } else if (isBank) {
      return this.classifyBankRecord(record);
    }

    return [];
  }

  private classifyInvoiceRecord(record: DbRecord): UnclassifiedItem[] {
    const db = getDatabase();
    const lineItems = getLineItemsByRecord(record.id);
    const invoiceData = db.prepare('SELECT * FROM invoice_data WHERE record_id = ?').get(record.id) as { ten_doi_tac?: string; mst?: string } | undefined;
    const unmatched: UnclassifiedItem[] = [];

    for (const item of lineItems) {
      if (!item.mo_ta) continue;

      // Skip if user already has a manually edited JE for this line item
      const existingUserEdited = db.prepare(
        "SELECT id FROM journal_entries WHERE line_item_id = ? AND user_edited = 1"
      ).get(item.id);
      if (existingUserEdited) continue;

      const match = this.similarityEngine.findMatch(item.mo_ta);
      if (match) {
        insertJournalEntry(
          record.id, item.id, 'line',
          match.account,
          match.cashFlow as any ?? 'operating',
          'similarity', match.score, match.matchedDescription,
        );
      } else {
        unmatched.push({
          id: item.id,
          recordId: record.id,
          docType: record.doc_type,
          moTa: item.mo_ta,
          tenDoiTac: invoiceData?.ten_doi_tac ?? undefined,
          mst: invoiceData?.mst ?? undefined,
          thueSuat: item.thue_suat ?? undefined,
          thanhTien: item.thanh_tien ?? undefined,
          thanhTienTruocThue: item.thanh_tien_truoc_thue ?? undefined,
        });
      }
    }

    return unmatched;
  }

  private classifyBankRecord(record: DbRecord): UnclassifiedItem[] {
    const db = getDatabase();
    const bankData = db.prepare('SELECT * FROM bank_statement_data WHERE record_id = ?').get(record.id) as BankStatementData | undefined;
    if (!bankData || !bankData.mo_ta) return [];

    const existingUserEdited = db.prepare(
      "SELECT id FROM journal_entries WHERE record_id = ? AND line_item_id IS NULL AND entry_type = 'bank' AND user_edited = 1"
    ).get(record.id);
    if (existingUserEdited) return [];

    const match = this.similarityEngine.findMatch(bankData.mo_ta);
    if (match) {
      insertJournalEntry(
        record.id, null, 'bank',
        match.account,
        match.cashFlow as any ?? 'operating',
        'similarity', match.score, match.matchedDescription,
      );
      return [];
    }

    return [{
      id: record.id,
      recordId: record.id,
      docType: record.doc_type,
      moTa: bankData.mo_ta,
      thanhTien: bankData.so_tien ?? undefined,
    }];
  }

  /**
   * Phase 2: Send unmatched items to AI for classification.
   */
  private async flushUnclassified(items: UnclassifiedItem[]): Promise<void> {
    if (items.length === 0) return;

    const results = await classifyWithAI(items, this.vaultRoot, this.cliPath);

    for (const item of items) {
      const classification = results.get(item.id);
      if (!classification) continue;

      const isBank = item.docType === DocType.BankStatement;
      const entryType = isBank ? 'bank' : 'line';
      const lineItemId = isBank ? null : item.id;

      insertJournalEntry(
        item.recordId, lineItemId, entryType,
        classification.account,
        classification.cashFlow ?? 'operating',
        'ai', null, null,
      );
    }
  }

  /**
   * Auto-generate tax and settlement entries for invoice records.
   * Skips if user-edited entries already exist.
   */
  private generateAutoEntries(recordId: string): void {
    const db = getDatabase();
    const record = db.prepare('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL').get(recordId) as DbRecord | undefined;
    if (!record) return;

    const isInvoice = record.doc_type === DocType.InvoiceIn || record.doc_type === DocType.InvoiceOut;
    if (!isInvoice) return;

    const lineItems = getLineItemsByRecord(recordId);
    if (lineItems.length === 0) return;

    // Tax entry — combined across all taxable line items
    const existingTax = findExistingEntry(recordId, null, 'tax');
    if (!existingTax || !existingTax.user_edited) {
      const hasTaxableItems = lineItems.some(li => li.thue_suat != null && li.thue_suat > 0);
      if (hasTaxableItems) {
        // Delete stale auto tax entry if exists
        if (existingTax) {
          db.prepare('DELETE FROM journal_entries WHERE id = ?').run(existingTax.id);
        }
        const taxAccount = getDefaultAccount(record.doc_type as DocType, 'tax');
        insertJournalEntry(recordId, null, 'tax', taxAccount, 'operating', 'auto', null, null);
      }
    }

    // Settlement entry — total including tax
    const existingSettlement = findExistingEntry(recordId, null, 'settlement');
    if (!existingSettlement || !existingSettlement.user_edited) {
      // Delete stale auto settlement entry if exists
      if (existingSettlement) {
        db.prepare('DELETE FROM journal_entries WHERE id = ?').run(existingSettlement.id);
      }
      const settlementAccount = getDefaultAccount(record.doc_type as DocType, 'settlement');
      insertJournalEntry(recordId, null, 'settlement', settlementAccount, 'operating', 'auto', null, null);
    }
  }
}
