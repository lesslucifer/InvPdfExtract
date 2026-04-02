import { Notification } from 'electron';
import { eventBus } from '../core/event-bus';
import { getFileById } from '../core/db/files';
import { APP_NAME } from '../shared/constants';

export class NotificationManager {
  init(): void {
    eventBus.on('extraction:completed', ({ batchId, fileId, recordCount, confidence }) => {
      const file = getFileById(fileId);
      const filename = file?.relative_path || 'unknown';
      const pct = Math.round(confidence * 100);

      this.show(
        'Extraction Complete',
        `${recordCount} record(s) extracted from ${filename} (confidence: ${pct}%)`
      );
    });

    eventBus.on('extraction:error', ({ fileId, error }) => {
      const file = getFileById(fileId);
      const filename = file?.relative_path || 'unknown';

      this.show(
        'Extraction Error',
        `Failed to process ${filename}: ${error}`
      );
    });

    eventBus.on('review:needed', ({ fileId, recordCount }) => {
      const file = getFileById(fileId);
      const filename = file?.relative_path || 'unknown';

      this.show(
        'Review Needed',
        `${recordCount} record(s) in ${filename} need review (low confidence)`
      );
    });

    eventBus.on('file:deleted', ({ relativePath }) => {
      this.show(
        'File Removed',
        `${relativePath} removed — records archived`
      );
    });

    eventBus.on('vault:initialized', ({ path }) => {
      this.show(
        'Vault Initialized',
        `New vault created at ${path}`
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
