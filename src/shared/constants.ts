import { DocType, ClaudeModelConfig, RelevanceFilterConfig } from './types';
import { t } from '../lib/i18n';

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

export const DEFAULT_CLAUDE_MODELS: ClaudeModelConfig = {
  pdfExtraction: 'medium',
  scriptGeneration: 'heavy',
};

export const METADATA_SAMPLE_ROWS = 5;
export const METADATA_SAMPLE_VALUES = 5;
export const SCRIPT_VERIFY_MAX_RETRIES = 3;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  [DocType.BankStatement]: t('bank_statement', 'Sao kê ngân hàng'),
  [DocType.InvoiceOut]:    t('invoice_out', 'Hóa đơn đầu ra'),
  [DocType.InvoiceIn]:     t('invoice_in', 'Hóa đơn đầu vào'),
  [DocType.Unknown]:       t('unclassified', 'Chưa phân loại'),
};

export const JE_INSTRUCTIONS_FILE = 'je-instructions.txt';
export const JE_SIMILARITY_THRESHOLD = 0.9;
export const JE_SIMILARITY_CACHE_SIZE = 10_000;
export const JE_AI_BATCH_SIZE = 100;

export const FILTER_CONFIG_FILE = 'filter-config.json';

export const DEFAULT_FILTER_CONFIG: RelevanceFilterConfig = {
  skipThreshold: 0.4,
  processThreshold: 0.6,
  customKeywords: [],
  customPathPatterns: [],
  sizeMinBytes: 1024,
  sizeMaxBytes: 52_428_800,
  sizePenalty: 0.15,
  aiTriageEnabled: true,
  aiTriageBatchSize: 10,
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
