import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase, setActiveDatabase, getDatabase } from '../../core/db/database';
import { insertFile } from '../../core/db/files';
import { softDeleteRecord } from '../../core/db/records';
import { rebuildDuplicatesForFingerprints, cleanupDuplicatesForRecord, getDuplicateSourcesForRecord } from '../../core/db/dedup';
import { DocType, ExtractionResult } from '../../shared/types';
import { Reconciler } from '../../core/reconciler';
import { parseXmlInvoice } from '../../core/parsers/xml-invoice-parser';
import { XML_FILES } from '../helpers/fixtures';

function ensureBatch(fileId: string): string {
  const db = getDatabase();
  const batchId = `batch-${fileId}`;
  const existing = db.prepare('SELECT id FROM extraction_batches WHERE id = ?').get(batchId);
  if (!existing) {
    db.prepare(`
      INSERT INTO extraction_batches (id, file_id, status, record_count, overall_confidence, processed_at)
      VALUES (?, ?, 'success', 0, 1.0, datetime('now'))
    `).run(batchId, fileId);
  }
  return batchId;
}

let _recSeq = 0;
function insertInvoiceRecord(fileId: string, fingerprint: string, docType = DocType.InvoiceIn): string {
  const db = getDatabase();
  const batchId = ensureBatch(fileId);
  const id = `rec-${Math.random().toString(36).slice(2)}`;
  // Use incrementing timestamps to ensure deterministic ordering
  _recSeq++;
  const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, _recSeq)).toISOString();
  db.prepare(`
    INSERT INTO records (id, batch_id, file_id, doc_type, fingerprint, confidence, field_confidence, raw_extraction, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1.0, '{}', '{}', ?, ?)
  `).run(id, batchId, fileId, docType, fingerprint, ts, ts);
  return id;
}

function getDupSources(canonicalId: string) {
  return getDatabase().prepare(
    'SELECT * FROM record_duplicate_sources WHERE canonical_record_id = ?'
  ).all(canonicalId) as any[];
}

describe('Integration: Cross-file deduplication', () => {
  beforeEach(() => {
    _recSeq = 0;
    closeDatabase();
    const db = openDatabase(':memory:');
    setActiveDatabase(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('single file with single invoice — no duplicate sources created', () => {
    const file = insertFile('folder/a.xml', 'hash-a', 'xml', 100);
    const recId = insertInvoiceRecord(file.id, 'fp-unique');

    rebuildDuplicatesForFingerprints(['fp-unique']);

    expect(getDupSources(recId)).toHaveLength(0);
  });

  it('two files with same fingerprint — earlier record is canonical, source row created', () => {
    const fileA = insertFile('folder/a.xml', 'hash-a', 'xml', 100);
    const fileB = insertFile('folder/b.xml', 'hash-b', 'xml', 100);

    // insertInvoiceRecord uses incrementing timestamps — A is older than B
    const recA = insertInvoiceRecord(fileA.id, 'fp-shared');
    const recB = insertInvoiceRecord(fileB.id, 'fp-shared');

    rebuildDuplicatesForFingerprints(['fp-shared']);

    const sources = getDupSources(recA);
    expect(sources).toHaveLength(1);
    expect(sources[0].source_record_id).toBe(recB);
    expect(sources[0].source_file_id).toBe(fileB.id);
  });

  it('rebuild is idempotent — no duplicate rows created on second call', () => {
    const fileA = insertFile('folder/a.xml', 'hash-a', 'xml', 100);
    const fileB = insertFile('folder/b.xml', 'hash-b', 'xml', 100);

    const recA = insertInvoiceRecord(fileA.id, 'fp-idempotent');
    insertInvoiceRecord(fileB.id, 'fp-idempotent');

    rebuildDuplicatesForFingerprints(['fp-idempotent']);
    rebuildDuplicatesForFingerprints(['fp-idempotent']);

    expect(getDupSources(recA)).toHaveLength(1);
  });

  it('three files with same fingerprint — two source rows, both point to earliest canonical', () => {
    const fileA = insertFile('folder/a.xml', 'hash-a', 'xml', 100);
    const fileB = insertFile('folder/b.xml', 'hash-b', 'xml', 100);
    const fileC = insertFile('folder/c.xml', 'hash-c', 'xml', 100);

    const recA = insertInvoiceRecord(fileA.id, 'fp-three');
    const recB = insertInvoiceRecord(fileB.id, 'fp-three');
    const recC = insertInvoiceRecord(fileC.id, 'fp-three');

    rebuildDuplicatesForFingerprints(['fp-three']);

    const sources = getDupSources(recA);
    expect(sources).toHaveLength(2);
    const sourceRecIds = sources.map((s: any) => s.source_record_id);
    expect(sourceRecIds).toContain(recB);
    expect(sourceRecIds).toContain(recC);
  });

  it('cleanupDuplicatesForRecord removes entries when canonical is deleted', () => {
    const db = getDatabase();
    const fileA = insertFile('folder/a.xml', 'hash-a', 'xml', 100);
    const fileB = insertFile('folder/b.xml', 'hash-b', 'xml', 100);

    const recA = insertInvoiceRecord(fileA.id, 'fp-cleanup');
    insertInvoiceRecord(fileB.id, 'fp-cleanup');

    rebuildDuplicatesForFingerprints(['fp-cleanup']);
    expect(getDupSources(recA)).toHaveLength(1);

    cleanupDuplicatesForRecord(recA);

    expect(getDupSources(recA)).toHaveLength(0);
    // No auto-promotion: recB is not canonical for anything
    const allSources = db.prepare('SELECT * FROM record_duplicate_sources').all() as any[];
    expect(allSources).toHaveLength(0);
  });

  it('softDeleteRecord cleans up dup sources automatically', () => {
    const db = getDatabase();
    const fileA = insertFile('folder/a.xml', 'hash-a', 'xml', 100);
    const fileB = insertFile('folder/b.xml', 'hash-b', 'xml', 100);

    const recA = insertInvoiceRecord(fileA.id, 'fp-softdel');
    insertInvoiceRecord(fileB.id, 'fp-softdel');

    rebuildDuplicatesForFingerprints(['fp-softdel']);
    expect(getDupSources(recA)).toHaveLength(1);

    softDeleteRecord(recA);

    const allSources = db.prepare('SELECT * FROM record_duplicate_sources').all() as any[];
    expect(allSources).toHaveLength(0);
  });

  it('bank statement records are excluded from dedup', () => {
    const fileA = insertFile('folder/a.xml', 'hash-a', 'xml', 100);
    const fileB = insertFile('folder/b.xml', 'hash-b', 'xml', 100);

    const recA = insertInvoiceRecord(fileA.id, 'fp-bank', DocType.BankStatement);
    const recB = insertInvoiceRecord(fileB.id, 'fp-bank', DocType.BankStatement);
    void recB;

    rebuildDuplicatesForFingerprints(['fp-bank']);

    expect(getDupSources(recA)).toHaveLength(0);
  });

  it('getDuplicateSourcesForRecord returns file path in result', () => {
    const fileA = insertFile('invoices/a.xml', 'hash-a', 'xml', 100);
    const fileB = insertFile('invoices/b.xml', 'hash-b', 'xml', 100);

    const recA = insertInvoiceRecord(fileA.id, 'fp-path');
    const recB = insertInvoiceRecord(fileB.id, 'fp-path');

    rebuildDuplicatesForFingerprints(['fp-path']);

    const sources = getDuplicateSourcesForRecord(recA);
    expect(sources).toHaveLength(1);
    expect(sources[0].relative_path).toBe('invoices/b.xml');
    expect(sources[0].canonical_record_id).toBe(recA);
    expect(sources[0].source_record_id).toBe(recB);
  });

  it('end-to-end: reconciler triggers dedup after processing invoice file', () => {
    const db = getDatabase();
    const relativePath = 'xml/0310989626_1_C26TAA_911_31012026_congtytnhhinkythuatso.xml';
    const relativePathB = 'xml/copy/invoice_911_copy.xml';

    const fileA = insertFile(relativePath, 'hash-a', 'xml', 1024);
    const fileB = insertFile(relativePathB, 'hash-b', 'xml', 1024);

    const fileResult = parseXmlInvoice(XML_FILES.inKyThuatSo911, relativePath);
    fileResult.file_id = fileA.id;
    const reconciler = new Reconciler(0.8);

    // Process file A
    reconciler.reconcileResults({ results: [fileResult] } as ExtractionResult, 'log-1');

    const recA = db.prepare('SELECT id FROM records WHERE file_id = ? AND deleted_at IS NULL').get(fileA.id) as any;
    expect(recA).toBeTruthy();

    // Initially no duplicates
    expect(getDupSources(recA.id)).toHaveLength(0);

    // Process same invoice from file B
    const fileResultB = { ...fileResult, file_id: fileB.id, relative_path: relativePathB };
    reconciler.reconcileResults({ results: [fileResultB] } as ExtractionResult, 'log-2');

    const recB = db.prepare('SELECT id FROM records WHERE file_id = ? AND deleted_at IS NULL').get(fileB.id) as any;
    expect(recB).toBeTruthy();

    // Now file A's record should be canonical with file B as duplicate source
    const sources = getDupSources(recA.id);
    expect(sources).toHaveLength(1);
    expect(sources[0].source_file_id).toBe(fileB.id);
  });
});
