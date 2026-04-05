import { getDatabase } from './db/database';
import { getLineItemsByRecord, getRecordsByFileId } from './db/records';
import {
  insertJournalEntry,
  deleteJournalEntriesByRecord,
  getJournalEntriesByRecord,
} from './db/journal-entries';
import { JESimilarityEngine } from './je-similarity';
import { classifyWithAI, UnclassifiedItem } from './je-ai-classifier';
import { eventBus } from './event-bus';
import { DocType, InvoiceLineItem, BankStatementData, DbRecord } from '../shared/types';
import { JE_AI_BATCH_SIZE } from '../shared/constants';

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
   * Flushes unmatched items to AI immediately (user expects instant result).
   */
  async generateForRecord(recordId: string): Promise<number> {
    if (this.processing.has(recordId)) return 0;
    this.processing.add(recordId);

    try {
      const unmatched = this.classifyRecord(recordId);
      if (unmatched.length > 0) {
        await this.flushUnclassified(unmatched);
      }
      const entries = getJournalEntriesByRecord(recordId);
      eventBus.emit('je:generated', { recordId, count: entries.length, source: 'ai' });
      return entries.length;
    } finally {
      this.processing.delete(recordId);
    }
  }

  /**
   * Generate JEs for all records in a file. Used by auto-trigger after extraction.
   * Accumulates unmatched items across records, then flushes in batches.
   */
  async generateForFile(fileId: string): Promise<number> {
    const records = getRecordsByFileId(fileId);
    if (records.length === 0) return 0;
    return this.generateBatch(records.map(r => r.id));
  }

  /**
   * Generate JEs for multiple records. Used by regenerateAll and bulk operations.
   * Accumulates unmatched items, flushes in batches of JE_AI_BATCH_SIZE.
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

    // Count total JEs and emit events
    for (const recordId of recordIds) {
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
   * Inserts matched JEs and tax entries immediately.
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

      // Check if user already has a manually edited JE for this line item
      const existingUserEdited = db.prepare(
        "SELECT id FROM journal_entries WHERE line_item_id = ? AND user_edited = 1"
      ).get(item.id);
      if (existingUserEdited) continue; // Skip — preserved by deleteJournalEntriesByRecord

      const match = this.similarityEngine.findMatch(item.mo_ta);
      if (match) {
        insertJournalEntry(
          record.id, item.id, 'line',
          match.tkNo, match.tkCo,
          item.thanh_tien_truoc_thue ?? item.thanh_tien,
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

      // Tax entry for items with tax rate
      if (item.thue_suat != null && item.thue_suat > 0) {
        const taxAmount = this.computeTaxAmount(item);
        if (taxAmount > 0) {
          const isInput = record.doc_type === DocType.InvoiceIn;
          insertJournalEntry(
            record.id, item.id, 'tax',
            isInput ? '1331' : '3331',
            isInput ? '331' : '33311',
            taxAmount,
            'operating',
            'similarity', null, null,
          );
        }
      }
    }

    return unmatched;
  }

  private classifyBankRecord(record: DbRecord): UnclassifiedItem[] {
    const db = getDatabase();
    const bankData = db.prepare('SELECT * FROM bank_statement_data WHERE record_id = ?').get(record.id) as BankStatementData | undefined;
    if (!bankData || !bankData.mo_ta) return [];

    // Check for existing user-edited JE
    const existingUserEdited = db.prepare(
      "SELECT id FROM journal_entries WHERE record_id = ? AND line_item_id IS NULL AND entry_type = 'bank' AND user_edited = 1"
    ).get(record.id);
    if (existingUserEdited) return [];

    const match = this.similarityEngine.findMatch(bankData.mo_ta);
    if (match) {
      insertJournalEntry(
        record.id, null, 'bank',
        match.tkNo, match.tkCo,
        bankData.so_tien,
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

      // Determine if this is a line item or bank record
      const isBank = item.docType === DocType.BankStatement;
      const entryType = isBank ? 'bank' : 'line';
      const lineItemId = isBank ? null : item.id;

      insertJournalEntry(
        item.recordId, lineItemId, entryType,
        classification.tkNo, classification.tkCo,
        item.thanhTienTruocThue ?? item.thanhTien ?? null,
        classification.cashFlow ?? 'operating',
        'ai', null, null,
      );
    }
  }

  private computeTaxAmount(item: InvoiceLineItem): number {
    const beforeTax = item.thanh_tien_truoc_thue;
    const afterTax = item.thanh_tien;
    if (beforeTax != null && afterTax != null) {
      return afterTax - beforeTax;
    }
    if (beforeTax != null && item.thue_suat != null) {
      return beforeTax * (item.thue_suat / 100);
    }
    return 0;
  }
}
