import { Notification } from 'electron';
import { eventBus } from '../core/event-bus';
import { getFileById } from '../core/db/files';
import { APP_NAME } from '../shared/constants';
import { t } from '../lib/i18n';

export class NotificationManager {
  init(): void {
    eventBus.on('extraction:completed', ({ batchId, fileId, recordCount, confidence }) => {
      const file = getFileById(fileId);
      const filename = file?.relative_path || 'unknown';
      const pct = Math.round(confidence * 100);

      this.show(
        t('extraction_complete', 'Extraction Complete'),
        `${recordCount} ${t('records_extracted_from', 'record(s) extracted from')} ${filename} (${t('confidence', 'confidence')}: ${pct}%)`
      );
    });

    eventBus.on('extraction:error', ({ fileId, error }) => {
      const file = getFileById(fileId);
      const filename = file?.relative_path || 'unknown';

      this.show(
        t('extraction_error', 'Extraction Error'),
        `${t('failed_to_process', 'Failed to process')} ${filename}: ${error}`
      );
    });

    eventBus.on('review:needed', ({ fileId, recordCount }) => {
      const file = getFileById(fileId);
      const filename = file?.relative_path || 'unknown';

      this.show(
        t('review_needed', 'Review Needed'),
        `${recordCount} ${t('records_in', 'record(s) in')} ${filename} ${t('need_review_low_confidence', 'need review (low confidence)')}`
      );
    });

    eventBus.on('file:deleted', ({ relativePath }) => {
      this.show(
        t('file_removed', 'File Removed'),
        `${relativePath} ${t('removed_records_archived', 'removed — records archived')}`
      );
    });

    eventBus.on('conflicts:detected', ({ fileId, conflictCount }) => {
      const file = getFileById(fileId);
      const filename = file?.relative_path || 'unknown';

      this.show(
        t('field_conflicts', 'Field Conflicts'),
        `${conflictCount} ${t('field_conflicts_after_reprocessing', 'field conflict(s) after re-processing')} ${filename}`
      );
    });

    eventBus.on('vault:initialized', ({ path }) => {
      this.show(
        t('vault_initialized', 'Vault Initialized'),
        `${t('new_vault_created_at', 'New vault created at')} ${path}`
      );
    });
  }

  private show(title: string, body: string): void {
    if (!Notification.isSupported()) {
      console.log(`[Notification] ${title}: ${body}`);
      return;
    }

    const notification = new Notification({
      title: `${APP_NAME} — ${title}`,
      body,
      silent: false,
    });

    notification.show();
  }
}
