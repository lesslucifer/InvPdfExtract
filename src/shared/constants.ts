import { DocType } from './types';

export const APP_NAME = 'InvoiceVault';

export const INVOICEVAULT_DIR = '.invoicevault';
export const CONFIG_FILE = 'config.json';
export const DB_FILE = 'vault.db';

export const VAULT_SUBDIRS = ['logs', 'scripts', 'queue'];

export const WATCHED_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.xml', '.xlsx', '.csv',
]);

export const IGNORED_DIRS = [
  INVOICEVAULT_DIR,
  'node_modules',
  '.git',
];

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;
export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_CLI_TIMEOUT = 120_000; // 2 minutes
export const WATCHER_DEBOUNCE_MS = 300;

export const METADATA_SAMPLE_ROWS = 5;
export const METADATA_SAMPLE_VALUES = 5;
export const SCRIPT_VERIFY_MAX_RETRIES = 3;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  [DocType.BankStatement]: 'Sao kê ngân hàng',
  [DocType.InvoiceOut]: 'Hóa đơn đầu ra',
  [DocType.InvoiceIn]: 'Hóa đơn đầu vào',
  [DocType.Unknown]: 'Chưa phân loại',
};

export const FILE_TYPE_MAP: Record<string, string> = {
  '.pdf': 'pdf',
  '.jpg': 'jpg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.xml': 'xml',
  '.xlsx': 'xlsx',
  '.csv': 'csv',
};
