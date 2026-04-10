import { createHash } from 'crypto';
import {
  DocType, ExtractionResult, ExtractionFileResult, ExtractionRecord,
  ExtractionInvoiceData, ExtractionBankStatementData, BatchStatus, LogLevel,
} from '../shared/types';
import { computeMissingTaxField, normalizeTaxRate } from '../shared/tax-utils';
import {
  createBatch, insertRecord, updateRecord, getRecordsByFileId,
  softDeleteRecord, upsertBankStatementData,
  upsertInvoiceData, insertLineItem,
  getLineItemsByRecord, updateLineItem,
  updateFtsIndex, addLog, getLockedFieldsForRecord, setFieldConflict, getFtsIndexData,
} from './db/records';
import { getFileByPath, updateFileStatus, updateFileDocType, updateFileFilterResult } from './db/files';
import { getDatabase } from './db/database';
import { rebuildDuplicatesForFingerprints } from './db/dedup';
import { eventBus } from './event-bus';
import { FileStatus } from '../shared/types';

type ReconciledFieldValue = string | number | null;
type ReconciledFields = Record<string, ReconciledFieldValue>;

export class Reconciler {
  private confidenceThreshold: number;

  constructor(confidenceThreshold: number = 0.8) {
    this.confidenceThreshold = confidenceThreshold;
  }

  reconcileResults(extraction: ExtractionResult, sessionLog: string): void {
    for (const fileResult of extraction.results) {
      try {
        this.reconcileFileResult(fileResult, sessionLog);
      } catch (err) {
        console.error(`[Reconciler] Error reconciling ${fileResult.relative_path}:`, err);
        const file = getFileByPath(fileResult.relative_path);
        if (file) {
          updateFileStatus(file.id, FileStatus.Error);
          eventBus.emit('extraction:error', { fileId: file.id, error: (err as Error).message });
        }
      }
    }
  }

  private reconcileFileResult(fileResult: ExtractionFileResult, sessionLog: string): void {
    const reconcileT0 = performance.now();
    const file = getFileByPath(fileResult.relative_path);
    if (!file) {
      console.warn(`[Reconciler] File not found in DB: ${fileResult.relative_path}`);
      return;
    }

    if (fileResult.skipped) {
      const reason = fileResult.skip_reason ?? 'Irrelevant: not an accounting document';
      updateFileFilterResult(file.id, FileStatus.Skipped, 0.1, reason, 4);
      addLog(null, LogLevel.Info, `Skipped (irrelevant) at extraction stage: ${fileResult.relative_path} — ${reason}`);
      eventBus.emit('file:filtered', { fileId: file.id, relativePath: fileResult.relative_path, score: 0.1, reason });
      return;
    }

    if (fileResult.error) {
      updateFileStatus(file.id, FileStatus.Error);
      addLog(null, LogLevel.Error, `Extraction error for ${fileResult.relative_path}: ${fileResult.error}`);
      eventBus.emit('extraction:error', { fileId: file.id, error: fileResult.error });
      return;
    }

    // Update doc_type on file
    updateFileDocType(file.id, fileResult.doc_type);

    const records = fileResult.records || [];
    const overallConfidence = records.length > 0
      ? records.reduce((sum, r) => sum + r.confidence, 0) / records.length
      : 0;

    // Create extraction batch
    const batch = createBatch(
      file.id,
      records.length > 0 ? BatchStatus.Success : BatchStatus.Error,
      records.length,
      overallConfidence,
      sessionLog,
      null
    );

    addLog(batch.id, LogLevel.Info, `Extracted ${records.length} records from ${fileResult.relative_path}`);

    // Get existing records for this file
    const existingRecords = getRecordsByFileId(file.id);
    const existingByFingerprint = new Map(existingRecords.map(r => [r.fingerprint, r]));
    const newFingerprints = new Set<string>();

    const db = getDatabase();
    const txn = db.transaction(() => {
      for (const extractedRecord of records) {
        const fingerprint = this.computeFingerprint(fileResult.doc_type, extractedRecord);
        newFingerprints.add(fingerprint);

        const existing = existingByFingerprint.get(fingerprint);

        if (existing) {
          // Update existing record
          updateRecord(
            existing.id, batch.id, extractedRecord.confidence,
            extractedRecord.doc_date, extractedRecord.field_confidence,
            extractedRecord
          );
          this.upsertExtensionData(existing.id, fileResult.doc_type, extractedRecord);
        } else {
          // Insert new record
          const newRecord = insertRecord(
            batch.id, file.id, fileResult.doc_type as DocType, fingerprint,
            extractedRecord.confidence, extractedRecord.doc_date,
            extractedRecord.field_confidence, extractedRecord
          );
          this.upsertExtensionData(newRecord.id, fileResult.doc_type, extractedRecord);
        }
      }

      // Soft-delete records with fingerprints no longer present
      for (const [fp, existing] of existingByFingerprint) {
        if (!newFingerprints.has(fp)) {
          softDeleteRecord(existing.id);
          addLog(batch.id, LogLevel.Info, `Soft-deleted record ${existing.id} (fingerprint no longer in extraction)`);
        }
      }
    });

    const txnT0 = performance.now();
    txn();
    const txnMs = performance.now() - txnT0;

    // Rebuild cross-file duplicate status for invoice records in this file
    const isInvoice = fileResult.doc_type === DocType.InvoiceIn || fileResult.doc_type === DocType.InvoiceOut;
    const dedupT0 = performance.now();
    if (isInvoice && newFingerprints.size > 0) {
      rebuildDuplicatesForFingerprints(Array.from(newFingerprints));
    }
    const dedupMs = performance.now() - dedupT0;

    // Determine file status based on confidence
    const needsReview = records.some(r => r.confidence < this.confidenceThreshold);
    updateFileStatus(file.id, needsReview ? FileStatus.Review : FileStatus.Done);

    const totalLineItems = records.reduce((sum, r) => sum + (r.line_items?.length ?? 0), 0);
    console.log(`[Reconciler] reconcileFileResult: ${fileResult.relative_path} — ${records.length} records, ${totalLineItems} lineItems, txn=${txnMs.toFixed(0)}ms, dedup=${dedupMs.toFixed(0)}ms, total=${(performance.now() - reconcileT0).toFixed(0)}ms`);

    eventBus.emit('extraction:completed', {
      batchId: batch.id,
      fileId: file.id,
      recordCount: records.length,
      confidence: overallConfidence,
    });

    if (needsReview) {
      const reviewCount = records.filter(r => r.confidence < this.confidenceThreshold).length;
      eventBus.emit('review:needed', { fileId: file.id, recordCount: reviewCount });
    }

    // Check for conflicts after reconciliation
    const conflictCount = getDatabase().prepare(
      "SELECT COUNT(*) as cnt FROM field_overrides fo JOIN records r ON fo.record_id = r.id WHERE r.file_id = ? AND fo.status = 'conflict' AND fo.resolved_at IS NULL"
    ).get(file.id) as { cnt: number } | undefined;

    if (conflictCount?.cnt && conflictCount?.cnt > 0) {
      eventBus.emit('conflicts:detected', { fileId: file.id, conflictCount: conflictCount.cnt });
    }
  }

  private upsertExtensionData(recordId: string, docType: string, extractedRecord: ExtractionRecord): void {
    const data = extractedRecord.data;
    const lockedFields = getLockedFieldsForRecord(recordId);
    const previousFtsData = getFtsIndexData(recordId);

    if (docType === DocType.BankStatement) {
      const bsd = data as ExtractionBankStatementData;
      const fields: ReconciledFields = {
        bank_name: bsd.bank_name ?? null,
        account_number: bsd.account_number ?? null,
        invoice_code: bsd.invoice_code ?? null,
        invoice_number: bsd.invoice_number ?? null,
        description: bsd.description ?? null,
        amount: bsd.amount ?? null,
        counterparty_name: bsd.counterparty_name ?? null,
      };

      // Respect locked fields
      this.applyLockedFields(recordId, 'bank_statement_data', fields, lockedFields);

      upsertBankStatementData(recordId, { record_id: recordId, ...fields });

      updateFtsIndex(recordId, {
        bank_name: fields.bank_name != null ? String(fields.bank_name) : undefined,
        account_number: fields.account_number != null ? String(fields.account_number) : undefined,
        invoice_code: fields.invoice_code != null ? String(fields.invoice_code) : undefined,
        invoice_number: fields.invoice_number != null ? String(fields.invoice_number) : undefined,
        description: fields.description != null ? String(fields.description) : undefined,
        counterparty_name: fields.counterparty_name != null ? String(fields.counterparty_name) : undefined,
      }, previousFtsData);
    } else {
      const inv = data as ExtractionInvoiceData;
      const fields: ReconciledFields = {
        invoice_code: inv.invoice_code ?? null,
        invoice_number: inv.invoice_number ?? null,
        total_before_tax: inv.total_before_tax ?? null,
        total_amount: inv.total_amount ?? null,
        tax_id: inv.tax_id ?? null,
        counterparty_name: inv.counterparty_name ?? null,
        counterparty_address: inv.counterparty_address ?? null,
      };

      // Respect locked fields
      this.applyLockedFields(recordId, 'invoice_data', fields, lockedFields);

      upsertInvoiceData(recordId, { record_id: recordId, ...fields });

      // Reconcile line items: respect locked fields, detect conflicts
      this.reconcileLineItems(recordId, extractedRecord.line_items || []);

      updateFtsIndex(recordId, {
        invoice_code: fields.invoice_code != null ? String(fields.invoice_code) : undefined,
        invoice_number: fields.invoice_number != null ? String(fields.invoice_number) : undefined,
        tax_id: fields.tax_id != null ? String(fields.tax_id) : undefined,
        counterparty_name: fields.counterparty_name != null ? String(fields.counterparty_name) : undefined,
        counterparty_address: fields.counterparty_address != null ? String(fields.counterparty_address) : undefined,
      }, previousFtsData);
    }
  }

  private reconcileLineItems(recordId: string, newLineItems: ExtractionRecord['line_items']): void {
    const t0 = performance.now();
    const existingItems = getLineItemsByRecord(recordId);
    const existingByLineNumber = new Map(existingItems.map(item => [item.line_number, item]));
    const items = newLineItems || [];

    // Check which existing items have locked fields
    const hasLockedFields = (lineItemId: string): boolean => {
      const locks = getLockedFieldsForRecord(lineItemId);
      return locks.size > 0;
    };

    const processedLineNumbers = new Set<number>();

    for (let i = 0; i < items.length; i++) {
      const lineNumber = i + 1;
      processedLineNumbers.add(lineNumber);
      const existing = existingByLineNumber.get(lineNumber);

      // Normalize decimal tax rates (0.08 → 8) before any computation
      const normalizedRate = normalizeTaxRate(items[i].tax_rate);

      // Compute missing before/after-tax amounts from available fields
      const computed = computeMissingTaxField({
        beforeTax: items[i].subtotal,
        afterTax: items[i].total_with_tax,
        taxRate: normalizedRate,
      });

      const newData = {
        description: items[i].description ?? null,
        unit_price: items[i].unit_price ?? null,
        quantity: items[i].quantity ?? null,
        tax_rate: normalizedRate,
        subtotal: computed.beforeTax,
        total_with_tax: computed.afterTax,
      };

      if (existing && hasLockedFields(existing.id)) {
        // Apply locked field logic: keep user values, detect conflicts
        const lockedFields = getLockedFieldsForRecord(existing.id);
        const fields: ReconciledFields = { ...newData };
        this.applyLockedFields(existing.id, 'invoice_line_items', fields, lockedFields);
        updateLineItem(existing.id, fields);
      } else if (existing) {
        // No locks — update freely
        updateLineItem(existing.id, newData);
      } else {
        // New line item
        insertLineItem(recordId, lineNumber, newData);
      }
    }

    // Handle existing items not in new extraction
    for (const [lineNumber, existing] of existingByLineNumber) {
      if (!processedLineNumbers.has(lineNumber)) {
        if (hasLockedFields(existing.id)) {
          // Keep user-edited items that AI no longer returns
        } else {
          // Delete items with no locks
          const db = getDatabase();
          db.prepare('DELETE FROM invoice_line_items WHERE id = ?').run(existing.id);
        }
      }
    }
    if (items.length > 50) {
      console.log(`[Reconciler] reconcileLineItems: ${recordId.slice(0, 8)} — ${items.length} items, took ${(performance.now() - t0).toFixed(0)}ms`);
    }
  }

  private applyLockedFields(
    recordId: string,
    tableName: string,
    fields: ReconciledFields,
    lockedFields: Map<string, { tableName: string; userValue: string; aiValueAtLock: string }>
  ): void {
    for (const [fieldName, lock] of lockedFields) {
      if (lock.tableName !== tableName) continue;
      if (!(fieldName in fields)) continue;

      const newAiValue = String(fields[fieldName] ?? '');

      // Keep user value
      fields[fieldName] = lock.userValue;

      // Check for conflict: AI now disagrees with what it said when the user locked the field
      if (newAiValue !== lock.aiValueAtLock) {
        setFieldConflict(recordId, tableName, fieldName, newAiValue);
      }
    }
  }

  private computeFingerprint(docType: string, record: ExtractionRecord): string {
    const hash = createHash('sha256');
    const data = record.data;

    switch (docType) {
      case DocType.BankStatement: {
        const bsd = data as ExtractionBankStatementData;
        hash.update(
          normalize(bsd.account_number) + '|' +
          normalize(record.doc_date) + '|' +
          normalize(String(bsd.amount))
        );
        break;
      }
      case DocType.InvoiceOut:
      case DocType.InvoiceIn: {
        const inv = data as ExtractionInvoiceData;
        hash.update(
          normalize(inv.invoice_number) + '|' +
          normalize(inv.tax_id) + '|' +
          normalize(record.doc_date)
        );
        break;
      }
      default:
        // For unknown types, hash all data
        hash.update(JSON.stringify(data));
    }

    return hash.digest('hex');
  }
}

function normalize(value: string | undefined | null): string {
  return (value || '').toString().trim().toLowerCase();
}
