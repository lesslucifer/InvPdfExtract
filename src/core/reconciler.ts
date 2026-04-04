import { createHash } from 'crypto';
import {
  DocType, ExtractionResult, ExtractionFileResult, ExtractionRecord,
  ExtractionInvoiceData, ExtractionBankStatementData, BatchStatus, LogLevel,
} from '../shared/types';
import { computeMissingTaxField, normalizeTaxRate } from '../shared/tax-utils';
import {
  createBatch, insertRecord, updateRecord, getRecordsByFileId,
  getRecordByFingerprint, softDeleteRecord, upsertBankStatementData,
  upsertInvoiceData, insertLineItem, deleteLineItemsByRecord,
  getLineItemsByRecord, updateLineItem, deleteUnlockedLineItemsByRecord,
  updateFtsIndex, addLog, getLockedFieldsForRecord, setFieldConflict,
} from './db/records';
import { getFileByPath, updateFileStatus, updateFileDocType } from './db/files';
import { getDatabase } from './db/database';
import { eventBus } from './event-bus';
import { FileStatus } from '../shared/types';

export class Reconciler {
  private confidenceThreshold: number;

  constructor(confidenceThreshold: number = 0.8) {
    this.confidenceThreshold = confidenceThreshold;
  }

  reconcileResults(extraction: ExtractionResult, sessionLog: string): void {
    const db = getDatabase();

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
    const file = getFileByPath(fileResult.relative_path);
    if (!file) {
      console.warn(`[Reconciler] File not found in DB: ${fileResult.relative_path}`);
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
            extractedRecord.ngay, extractedRecord.field_confidence,
            extractedRecord
          );
          this.upsertExtensionData(existing.id, fileResult.doc_type, extractedRecord);
        } else {
          // Insert new record
          const newRecord = insertRecord(
            batch.id, file.id, fileResult.doc_type as DocType, fingerprint,
            extractedRecord.confidence, extractedRecord.ngay,
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

    txn();

    // Determine file status based on confidence
    const needsReview = records.some(r => r.confidence < this.confidenceThreshold);
    updateFileStatus(file.id, needsReview ? FileStatus.Review : FileStatus.Done);

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
    ).get(file.id) as any;

    if (conflictCount?.cnt > 0) {
      eventBus.emit('conflicts:detected', { fileId: file.id, conflictCount: conflictCount.cnt });
    }
  }

  private upsertExtensionData(recordId: string, docType: string, extractedRecord: ExtractionRecord): void {
    const data = extractedRecord.data;
    const lockedFields = getLockedFieldsForRecord(recordId);

    if (docType === DocType.BankStatement) {
      const bsd = data as ExtractionBankStatementData;
      const fields: Record<string, any> = {
        ten_ngan_hang: bsd.ten_ngan_hang ?? null,
        stk: bsd.stk ?? null,
        mo_ta: bsd.mo_ta ?? null,
        so_tien: bsd.so_tien ?? null,
        ten_doi_tac: bsd.ten_doi_tac ?? null,
      };

      // Respect locked fields
      this.applyLockedFields(recordId, 'bank_statement_data', fields, lockedFields);

      upsertBankStatementData(recordId, { record_id: recordId, ...fields });

      updateFtsIndex(recordId, {
        ten_ngan_hang: fields.ten_ngan_hang,
        stk: fields.stk,
        mo_ta: fields.mo_ta,
        ten_doi_tac: fields.ten_doi_tac,
      });
    } else {
      const inv = data as ExtractionInvoiceData;
      const fields: Record<string, any> = {
        so_hoa_don: inv.so_hoa_don ?? null,
        tong_tien_truoc_thue: inv.tong_tien_truoc_thue ?? null,
        tong_tien: inv.tong_tien ?? null,
        mst: inv.mst ?? null,
        ten_doi_tac: inv.ten_doi_tac ?? null,
        dia_chi_doi_tac: inv.dia_chi_doi_tac ?? null,
      };

      // Respect locked fields
      this.applyLockedFields(recordId, 'invoice_data', fields, lockedFields);

      upsertInvoiceData(recordId, { record_id: recordId, ...fields });

      // Reconcile line items: respect locked fields, detect conflicts
      this.reconcileLineItems(recordId, extractedRecord.line_items || []);

      updateFtsIndex(recordId, {
        so_hoa_don: fields.so_hoa_don,
        mst: fields.mst,
        ten_doi_tac: fields.ten_doi_tac,
        dia_chi_doi_tac: fields.dia_chi_doi_tac,
      });
    }
  }

  private reconcileLineItems(recordId: string, newLineItems: ExtractionRecord['line_items']): void {
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
      const normalizedRate = normalizeTaxRate(items[i].thue_suat);

      // Compute missing before/after-tax amounts from available fields
      const computed = computeMissingTaxField({
        beforeTax: items[i].thanh_tien_truoc_thue,
        afterTax: items[i].thanh_tien,
        taxRate: normalizedRate,
      });

      const newData = {
        mo_ta: items[i].mo_ta ?? null,
        don_gia: items[i].don_gia ?? null,
        so_luong: items[i].so_luong ?? null,
        thue_suat: normalizedRate,
        thanh_tien_truoc_thue: computed.beforeTax,
        thanh_tien: computed.afterTax,
      };

      if (existing && hasLockedFields(existing.id)) {
        // Apply locked field logic: keep user values, detect conflicts
        const lockedFields = getLockedFieldsForRecord(existing.id);
        const fields: Record<string, any> = { ...newData };
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
  }

  private applyLockedFields(
    recordId: string,
    tableName: string,
    fields: Record<string, any>,
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
          normalize(bsd.stk) + '|' +
          normalize(record.ngay) + '|' +
          normalize(String(bsd.so_tien))
        );
        break;
      }
      case DocType.InvoiceOut:
      case DocType.InvoiceIn: {
        const inv = data as ExtractionInvoiceData;
        hash.update(
          normalize(inv.so_hoa_don) + '|' +
          normalize(inv.mst) + '|' +
          normalize(record.ngay)
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
