import { getDatabase } from './db/database';
import { getLineItemsByRecord, getRecordsByFileId, updateJeStatus } from './db/records';
import {
  insertJournalEntry,
  deleteJournalEntriesByRecord,
  getJournalEntriesByRecord,
  findExistingEntry,
} from './db/journal-entries';
import { JESimilarityEngine } from './je-similarity';
import { classifyWithAI, UnclassifiedItem } from './je-ai-classifier';
import { eventBus } from './event-bus';
import { CashFlowType, DocType, BankStatementData, DbRecord } from '../shared/types';
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

    updateJeStatus([recordId], 'processing');
    eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'processing' });

    try {
      this.similarityEngine.refresh();
      const unmatched = this.classifyRecord(recordId);
      if (unmatched.length > 0) {
        await this.flushUnclassified(unmatched);
      }
      // Auto-generate tax + settlement after all line items are classified
      this.generateAutoEntries(recordId);
      const entries = getJournalEntriesByRecord(recordId);

      updateJeStatus([recordId], 'done');
      eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'done' });
      eventBus.emit('je:generated', { recordId, count: entries.length, source: 'ai' });
      return entries.length;
    } catch (err) {
      updateJeStatus([recordId], 'error');
      eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'error' });
      throw err;
    } finally {
      this.processing.delete(recordId);
    }
  }

  /**
   * Generate JEs for a single record using AI only — skips similarity matching.
   * All items are sent directly to AI regardless of similarity cache hits.
   */
  async generateForRecordAIOnly(recordId: string): Promise<number> {
    if (this.processing.has(recordId)) return 0;
    this.processing.add(recordId);

    updateJeStatus([recordId], 'processing');
    eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'processing' });

    try {
      const unmatched = this.collectAllItemsForAI(recordId);
      if (unmatched.length > 0) {
        await this.flushUnclassified(unmatched);
      }
      this.generateAutoEntries(recordId);
      const entries = getJournalEntriesByRecord(recordId);

      updateJeStatus([recordId], 'done');
      eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'done' });
      eventBus.emit('je:generated', { recordId, count: entries.length, source: 'ai' });
      return entries.length;
    } catch (err) {
      updateJeStatus([recordId], 'error');
      eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'error' });
      throw err;
    } finally {
      this.processing.delete(recordId);
    }
  }

  async generateBatchAIOnly(recordIds: string[]): Promise<number> {
    let total = 0;
    for (const recordId of recordIds) {
      total += await this.generateForRecordAIOnly(recordId);
    }
    return total;
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
    const activeIds = recordIds.filter(id => !this.processing.has(id));
    if (activeIds.length === 0) return 0;

    // Mark all as processing
    updateJeStatus(activeIds, 'processing');
    eventBus.emit('je:status-changed', { recordIds: activeIds, status: 'processing' });

    this.similarityEngine.refresh();

    for (const recordId of activeIds) {
      this.processing.add(recordId);
      try {
        const unmatched = this.classifyRecord(recordId);
        allUnmatched.push(...unmatched);
      } catch {
        updateJeStatus([recordId], 'error');
        eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'error' });
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
    for (const recordId of activeIds) {
      if (!this.processing.has(recordId)) continue; // skip errored
      try {
        this.generateAutoEntries(recordId);
        const entries = getJournalEntriesByRecord(recordId);
        totalCount += entries.length;

        updateJeStatus([recordId], 'done');
        eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'done' });
        eventBus.emit('je:generated', { recordId, count: entries.length, source: 'ai' });
      } catch {
        updateJeStatus([recordId], 'error');
        eventBus.emit('je:status-changed', { recordIds: [recordId], status: 'error' });
      } finally {
        this.processing.delete(recordId);
      }
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
      LEFT JOIN invoice_data id2 ON r.id = id2.record_id
      WHERE r.deleted_at IS NULL
        AND (ili.id IS NOT NULL OR bsd.record_id IS NOT NULL OR id2.record_id IS NOT NULL)
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
    const invoiceData = db.prepare('SELECT * FROM invoice_data WHERE record_id = ?').get(record.id) as {
      counterparty_name?: string;
      tax_id?: string;
      total_before_tax?: number;
      total_amount?: number;
    } | undefined;
    const unmatched: UnclassifiedItem[] = [];

    for (const item of lineItems) {
      const rawDescription = item.description?.trim() ?? '';
      let effectiveDescription: string;

      if (rawDescription.length <= 3) {
        const parts: string[] = [];
        if (invoiceData?.counterparty_name) parts.push(invoiceData.counterparty_name);
        parts.push(record.doc_type);
        if (item.subtotal != null) parts.push(`${item.subtotal.toLocaleString()} VND`);
        else if (invoiceData?.total_before_tax != null) parts.push(`${invoiceData.total_before_tax.toLocaleString()} VND`);
        effectiveDescription = parts.join(' - ') || record.doc_type;
      } else {
        effectiveDescription = rawDescription;
      }

      // Skip if user already has a manually edited JE for this line item
      const existingUserEdited = db.prepare(
        "SELECT id FROM journal_entries WHERE line_item_id = ? AND user_edited = 1"
      ).get(item.id);
      if (existingUserEdited) continue;

      const match = this.similarityEngine.findMatch(effectiveDescription);
      if (match) {
        insertJournalEntry(
          record.id, item.id, 'line',
          match.account,
          (match.cashFlow ?? 'operating') as CashFlowType,
          'similarity', match.score, match.matchedDescription,
          match.contraAccount ?? null,
        );
      } else {
        unmatched.push({
          id: item.id,
          recordId: record.id,
          docType: record.doc_type,
          description: effectiveDescription,
          counterpartyName: invoiceData?.counterparty_name ?? undefined,
          taxId: invoiceData?.tax_id ?? undefined,
          taxRate: item.tax_rate ?? undefined,
          totalWithTax: item.total_with_tax ?? undefined,
          subtotal: item.subtotal ?? undefined,
        });
      }
    }

    if (lineItems.length === 0) {
      const existingUserEdited = db.prepare(
        "SELECT id FROM journal_entries WHERE record_id = ? AND line_item_id IS NULL AND entry_type = 'invoice' AND user_edited = 1"
      ).get(record.id);
      if (!existingUserEdited) {
        const parts: string[] = [];
        if (invoiceData?.counterparty_name) parts.push(invoiceData.counterparty_name);
        parts.push(record.doc_type);
        if (invoiceData?.total_before_tax != null) parts.push(`${invoiceData.total_before_tax.toLocaleString()} VND`);
        else if (invoiceData?.total_amount != null) parts.push(`${invoiceData.total_amount.toLocaleString()} VND`);
        const syntheticDescription = parts.join(' - ') || record.doc_type;

        const match = this.similarityEngine.findMatch(syntheticDescription);
        if (match) {
          insertJournalEntry(
            record.id, null, 'invoice',
            match.account,
            (match.cashFlow ?? 'operating') as CashFlowType,
            'similarity', match.score, match.matchedDescription,
            match.contraAccount ?? null,
          );
        } else {
          unmatched.push({
            id: record.id,
            recordId: record.id,
            docType: record.doc_type,
            description: syntheticDescription,
            counterpartyName: invoiceData?.counterparty_name ?? undefined,
            taxId: invoiceData?.tax_id ?? undefined,
            totalWithTax: invoiceData?.total_amount ?? undefined,
            subtotal: invoiceData?.total_before_tax ?? undefined,
          });
        }
      }
    }

    return unmatched;
  }

  private classifyBankRecord(record: DbRecord): UnclassifiedItem[] {
    const db = getDatabase();
    const bankData = db.prepare('SELECT * FROM bank_statement_data WHERE record_id = ?').get(record.id) as BankStatementData | undefined;
    if (!bankData || !bankData.description) return [];

    const existingUserEdited = db.prepare(
      "SELECT id FROM journal_entries WHERE record_id = ? AND line_item_id IS NULL AND entry_type = 'bank' AND user_edited = 1"
    ).get(record.id);
    if (existingUserEdited) return [];

    const match = this.similarityEngine.findMatch(bankData.description);
    if (match) {
      insertJournalEntry(
        record.id, null, 'bank',
        match.account,
        (match.cashFlow ?? 'operating') as CashFlowType,
        'similarity', match.score, match.matchedDescription,
        match.contraAccount ?? null,
      );
      return [];
    }

    return [{
      id: record.id,
      recordId: record.id,
      docType: record.doc_type,
      description: bankData.description,
      totalWithTax: bankData.amount ?? undefined,
    }];
  }

  /**
   * Collect all classifiable items for a record, skipping similarity matching.
   * Used by AI-only regeneration.
   */
  private collectAllItemsForAI(recordId: string): UnclassifiedItem[] {
    const db = getDatabase();
    const record = db.prepare('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL').get(recordId) as DbRecord | undefined;
    if (!record) return [];

    deleteJournalEntriesByRecord(recordId, true);

    const isInvoice = record.doc_type === DocType.InvoiceIn || record.doc_type === DocType.InvoiceOut;
    const isBank = record.doc_type === DocType.BankStatement;

    if (isInvoice) {
      const lineItems = getLineItemsByRecord(record.id);
      const invoiceData = db.prepare('SELECT * FROM invoice_data WHERE record_id = ?').get(record.id) as {
        counterparty_name?: string;
        tax_id?: string;
        total_before_tax?: number;
        total_amount?: number;
      } | undefined;

      return lineItems
        .filter(item => !db.prepare("SELECT id FROM journal_entries WHERE line_item_id = ? AND user_edited = 1").get(item.id))
        .map(item => {
          const rawDescription = item.description?.trim() ?? '';
          let effectiveDescription: string;
          if (rawDescription.length <= 3) {
            const parts: string[] = [];
            if (invoiceData?.counterparty_name) parts.push(invoiceData.counterparty_name);
            parts.push(record.doc_type);
            if (item.subtotal != null) parts.push(`${item.subtotal.toLocaleString()} VND`);
            else if (invoiceData?.total_before_tax != null) parts.push(`${invoiceData.total_before_tax.toLocaleString()} VND`);
            effectiveDescription = parts.join(' - ') || record.doc_type;
          } else {
            effectiveDescription = rawDescription;
          }
          return {
            id: item.id,
            recordId: record.id,
            docType: record.doc_type,
            description: effectiveDescription,
            counterpartyName: invoiceData?.counterparty_name ?? undefined,
            taxId: invoiceData?.tax_id ?? undefined,
            taxRate: item.tax_rate ?? undefined,
            totalWithTax: item.total_with_tax ?? undefined,
            subtotal: item.subtotal ?? undefined,
          };
        });
    } else if (isBank) {
      const bankData = db.prepare('SELECT * FROM bank_statement_data WHERE record_id = ?').get(record.id) as BankStatementData | undefined;
      if (!bankData?.description) return [];
      const existingUserEdited = db.prepare(
        "SELECT id FROM journal_entries WHERE record_id = ? AND line_item_id IS NULL AND entry_type = 'bank' AND user_edited = 1"
      ).get(record.id);
      if (existingUserEdited) return [];
      return [{ id: record.id, recordId: record.id, docType: record.doc_type, description: bankData.description, totalWithTax: bankData.amount ?? undefined }];
    }

    return [];
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
      const isSyntheticInvoice = !isBank && item.id === item.recordId;
      const entryType = isBank ? 'bank' : isSyntheticInvoice ? 'invoice' : 'line';
      const lineItemId = (isBank || isSyntheticInvoice) ? null : item.id;

      insertJournalEntry(
        item.recordId, lineItemId, entryType,
        classification.account,
        classification.cashFlow ?? 'operating',
        'ai', null, null,
        classification.contraAccount ?? null,
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

    // Tax entry — combined across all taxable line items
    const existingTax = findExistingEntry(recordId, null, 'tax');
    if (!existingTax || !existingTax.user_edited) {
      let hasTaxableItems: boolean;
      if (lineItems.length > 0) {
        hasTaxableItems = lineItems.some(li => li.tax_rate != null && li.tax_rate > 0);
      } else {
        const invData = db.prepare('SELECT total_before_tax, total_amount FROM invoice_data WHERE record_id = ?')
          .get(recordId) as { total_before_tax?: number; total_amount?: number } | undefined;
        const beforeTax = invData?.total_before_tax ?? 0;
        const total = invData?.total_amount ?? 0;
        hasTaxableItems = beforeTax > 0 && total > beforeTax;
      }
      if (hasTaxableItems) {
        // Delete stale auto tax entry if exists
        if (existingTax) {
          db.prepare('DELETE FROM journal_entries WHERE id = ?').run(existingTax.id);
        }
        const taxAccount = getDefaultAccount(record.doc_type as DocType, 'tax');
        const taxContra = getDefaultAccount(record.doc_type as DocType, 'settlement');
        insertJournalEntry(recordId, null, 'tax', taxAccount, 'operating', 'auto', null, null, taxContra);
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
      // Derive contra from classified line/invoice entries — use common account if all agree, else null
      const classifiedAccounts = (db.prepare(
        "SELECT DISTINCT account FROM journal_entries WHERE record_id = ? AND entry_type IN ('line', 'invoice') AND account IS NOT NULL"
      ).all(recordId) as Array<{ account: string }>).map(r => r.account);
      const settlementContra = classifiedAccounts.length === 1 ? classifiedAccounts[0] : null;
      insertJournalEntry(recordId, null, 'settlement', settlementAccount, 'operating', 'auto', null, null, settlementContra);
    }
  }
}
