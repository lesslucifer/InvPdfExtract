import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';
import { DocType, DuplicateSourceRow } from '../../shared/types';
import { log, LogModule } from '../logger';

interface FingerprintRecord {
  id: string;
  file_id: string;
  created_at: string;
}

export function rebuildDuplicatesForFingerprints(fingerprints: string[]): void {
  if (fingerprints.length === 0) return;
  log.debug(LogModule.Dedup, `Rebuilding duplicates for ${fingerprints.length} fingerprints`);
  const db = getDatabase();

  const txn = db.transaction(() => {
    for (const fingerprint of fingerprints) {
      const records = db.prepare(`
        SELECT r.id, r.file_id, r.created_at
        FROM records r
        WHERE r.fingerprint = ?
          AND r.deleted_at IS NULL
          AND r.doc_type IN (?, ?)
        ORDER BY r.created_at ASC, r.id ASC
      `).all(fingerprint, DocType.InvoiceIn, DocType.InvoiceOut) as FingerprintRecord[];

      if (records.length < 2) {
        // No duplicate — clean up any stale entries for these records
        if (records.length === 1) {
          db.prepare(
            'DELETE FROM record_duplicate_sources WHERE canonical_record_id = ? OR source_record_id = ?'
          ).run(records[0].id, records[0].id);
        }
        continue;
      }

      const canonical = records[0];
      const nonCanonicals = records.slice(1);

      // Group non-canonical records by file_id, keeping earliest per file
      const byFile = new Map<string, FingerprintRecord>();
      for (const rec of nonCanonicals) {
        if (!byFile.has(rec.file_id)) {
          byFile.set(rec.file_id, rec);
        }
      }
      log.debug(LogModule.Dedup, `Found ${records.length} records for fingerprint, canonical=${canonical.id}, ${byFile.size} duplicate sources`);

      // Remove stale entries for this canonical that are no longer in byFile
      db.prepare(
        'DELETE FROM record_duplicate_sources WHERE canonical_record_id = ?'
      ).run(canonical.id);

      const now = new Date().toISOString();
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO record_duplicate_sources (id, canonical_record_id, source_file_id, source_record_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const [fileId, sourceRecord] of byFile) {
        insertStmt.run(uuid(), canonical.id, fileId, sourceRecord.id, now);
      }
    }
  });

  txn();
}

export function cleanupDuplicatesForRecord(recordId: string): void {
  const db = getDatabase();
  db.prepare(
    'DELETE FROM record_duplicate_sources WHERE canonical_record_id = ? OR source_record_id = ?'
  ).run(recordId, recordId);
  log.debug(LogModule.Dedup, `Cleaned up duplicate links`, { recordId });
}

export function getDuplicateSourcesForRecord(recordId: string): DuplicateSourceRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT rds.id, rds.canonical_record_id, rds.source_file_id, rds.source_record_id,
      f.relative_path, rds.created_at
    FROM record_duplicate_sources rds
    JOIN files f ON rds.source_file_id = f.id
    WHERE rds.canonical_record_id = ?
    ORDER BY rds.created_at ASC
  `).all(recordId) as DuplicateSourceRow[];
}
