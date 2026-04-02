import { createHash } from 'crypto';
import {
  DocType, ExtractionResult, ExtractionFileResult, ExtractionRecord,
  ExtractionInvoiceData, ExtractionBankStatementData, BatchStatus, LogLevel,
} from '../shared/types';
import {
  createBatch, insertRecord, updateRecord, getRecordsByFileId,
  getRecordByFingerprint, softDeleteRecord, upsertBankStatementData,
  upsertInvoiceData, insertLineItem, deleteLineItemsByRecord,
  updateFtsIndex, addLog,
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
  }

  private upsertExtensionData(recordId: string, docType: string, extractedRecord: ExtractionRecord): void {
    const data = extractedRecord.data;

    if (docType === DocType.BankStatement) {
      const bsd = data as ExtractionBankStatementData;
      upsertBankStatementData(recordId, {
        record_id: recordId,
        ten_ngan_hang: bsd.ten_ngan_hang ?? null,
        stk: bsd.stk ?? null,
        mo_ta: bsd.mo_ta ?? null,
        so_tien: bsd.so_tien ?? null,
        ten_doi_tac: bsd.ten_doi_tac ?? null,
      });

      updateFtsIndex(recordId, {
        ten_ngan_hang: bsd.ten_ngan_hang,
        stk: bsd.stk,
        mo_ta: bsd.mo_ta,
        ten_doi_tac: bsd.ten_doi_tac,
      });
    } else {
      const inv = data as ExtractionInvoiceData;
      upsertInvoiceData(recordId, {
        record_id: recordId,
        so_hoa_don: inv.so_hoa_don ?? null,
        tong_tien: inv.tong_tien ?? null,
        mst: inv.mst ?? null,
        ten_doi_tac: inv.ten_doi_tac ?? null,
        dia_chi_doi_tac: inv.dia_chi_doi_tac ?? null,
      });

      // Replace line items (delete old, insert new)
      deleteLineItemsByRecord(recordId);
      const lineItems = extractedRecord.line_items || [];
      for (let i = 0; i < lineItems.length; i++) {
        insertLineItem(recordId, i + 1, {
          mo_ta: lineItems[i].mo_ta ?? null,
          don_gia: lineItems[i].don_gia ?? null,
          so_luong: lineItems[i].so_luong ?? null,
          thue_suat: lineItems[i].thue_suat ?? null,
          thanh_tien: lineItems[i].thanh_tien ?? null,
        });
      }

      updateFtsIndex(recordId, {
        so_hoa_don: inv.so_hoa_don,
        mst: inv.mst,
        ten_doi_tac: inv.ten_doi_tac,
        dia_chi_doi_tac: inv.dia_chi_doi_tac,
      });
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
