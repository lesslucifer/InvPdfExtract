import { Database } from 'better-sqlite3';
import type { SortField, SortDirection, ParsedQuery } from '../parse-query';

// === Enums ===

export enum DocType {
  BankStatement = 'bank_statement',
  InvoiceOut = 'invoice_out',
  InvoiceIn = 'invoice_in',
  Unknown = 'unknown',
}

export enum FileStatus {
  Unfiltered = 'unfiltered',
  Pending = 'pending',
  Processing = 'processing',
  Done = 'done',
  Review = 'review',
  Error = 'error',
  Skipped = 'skipped',
}

export enum BatchStatus {
  Success = 'success',
  Partial = 'partial',
  Error = 'error',
}

export enum OverrideStatus {
  Locked = 'locked',
  Conflict = 'conflict',
}

export enum LogLevel {
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

export enum TrayState {
  Idle = 'idle',
  Processing = 'processing',
  Review = 'review',
  Error = 'error',
}

export enum OverlayState {
  NoVault = 'no-vault',
  DbError = 'db-error',
  Home = 'home',
  Search = 'search',
  PathSearch = 'path-search',
  PresetSearch = 'preset-search',
  Settings = 'settings',
  ProcessingStatus = 'processing-status',
  Cheatsheet = 'cheatsheet',
}

// === Spotlight UX Types ===

export interface FolderInfo {
  path: string;           // relative to vault root
  recordCount: number;
  lastActive: string;     // ISO datetime
}

export interface SearchFilters {
  text?: string;
  folder?: string;
  filePath?: string;
  docType?: string;
  status?: string;
  taxId?: string;
  invoiceCode?: string;
  amountMin?: number;
  amountMax?: number;
  dateFilter?: string;
  sortField?: SortField;
  sortDirection?: SortDirection;
}

export interface AggregateStats {
  totalRecords: number;
  totalAmount: number;
}

// === Database Row Types ===

export interface VaultFile {
  id: string;
  relative_path: string;
  file_hash: string;
  file_type: string;
  file_size: number;
  doc_type: DocType | null;
  status: FileStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  retry_count: number;
  filter_score: number | null;
  filter_reason: string | null;
  filter_layer: number | null;
  processing_started_at: string | null;
}

export interface ExtractionBatch {
  id: string;
  file_id: string;
  status: BatchStatus;
  record_count: number;
  overall_confidence: number;
  claude_session_log: string | null;
  script_id: string | null;
  processed_at: string;
}

export interface DbRecord {
  id: string;
  batch_id: string;
  file_id: string;
  doc_type: DocType;
  fingerprint: string;
  confidence: number;
  doc_date: string | null;
  field_confidence: string; // JSON
  raw_extraction: string; // JSON
  je_status: JEGenerationStatus | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankStatementData {
  record_id: string;
  bank_name: string | null;
  account_number: string | null;
  invoice_code: string | null;
  invoice_number: string | null;
  description: string | null;
  amount: number | null;
  counterparty_name: string | null;
}

export interface InvoiceData {
  record_id: string;
  invoice_code: string | null;
  invoice_number: string | null;
  total_before_tax: number | null;
  total_amount: number | null;
  fee_amount: number | null;
  fee_description: string | null;
  tax_id: string | null;
  counterparty_name: string | null;
  counterparty_address: string | null;
}

export interface InvoiceLineItem {
  id: string;
  record_id: string;
  line_number: number;
  description: string | null;
  unit_price: number | null;
  quantity: number | null;
  tax_rate: number | null;
  subtotal: number | null;
  total_with_tax: number | null;
  deleted_at: string | null;
}

export interface ExtractionScript {
  id: string;
  name: string;
  doc_type: DocType;
  script_path: string;
  matcher_path: string;
  matcher_description: string | null;
  times_used: number;
  created_at: string;
  last_used_at: string;
}

export interface FileScriptAssignment {
  file_id: string;
  script_id: string;
  assigned_at: string;
}

export interface FieldOverride {
  id: string;
  record_id: string;
  table_name: string;
  field_name: string;
  user_value: string;
  ai_value_at_lock: string;
  ai_value_latest: string | null;
  status: OverrideStatus;
  locked_at: string;
  conflict_at: string | null;
  resolved_at: string | null;
}

export interface ProcessingLog {
  id: string;
  batch_id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

// === Vault Config ===

export interface VaultConfig {
  version: number;
  created_at: string;
  confidence_threshold: number;
  extractionBatchSize?: number;
  maxRetryCount?: number;
}

export interface VaultHandle {
  rootPath: string;
  dotPath: string;
  dbPath: string;
  config: VaultConfig;
  db: Database;
}

// === Model Configuration ===

export type ModelTier = 'fast' | 'medium' | 'heavy';

export const MODEL_TIER_MAP: Dict<string> = {
  fast: 'haiku',
  medium: 'sonnet',
  heavy: 'opus',
};

export interface ClaudeModelConfig {
  pdfExtraction: ModelTier;
  scriptGeneration: ModelTier;
}

// === App Config (persisted in userData) ===

export interface AppConfig {
  lastVaultPath: string | null;
  claudeCliPath: string | null;
  vaultPaths: string[];
  autoStart: boolean;
  claudeModels: ClaudeModelConfig;
  locale: 'en' | 'vi';
}

// === Claude CLI Extraction Types ===

export interface ParsingError {
  row: number;
  field: string;
  rawValue: unknown;
  error: string;
}

export interface ExtractionFileResult {
  relative_path: string;
  doc_type: DocType;
  records: ExtractionRecord[];
  error?: string;
  skipped?: boolean;
  skip_reason?: string;
  _parsing_errors?: ParsingError[];
}

export interface ExtractionRecord {
  fingerprint?: string;
  confidence: number;
  field_confidence: { [field: string]: number };
  doc_date: string | null;
  data: ExtractionRecordData;
  line_items?: ExtractionLineItem[];
}

export type ExtractionRecordData = ExtractionBankStatementData | ExtractionInvoiceData;

export interface ExtractionBankStatementData {
  bank_name?: string;
  account_number?: string;
  invoice_code?: string;
  invoice_number?: string;
  description?: string;
  amount?: number;
  counterparty_name?: string;
}

export interface ExtractionInvoiceData {
  invoice_code?: string;
  invoice_number?: string;
  total_before_tax?: number;
  total_amount?: number;
  fee_amount?: number;
  fee_description?: string;
  tax_id?: string;
  counterparty_name?: string;
  counterparty_address?: string;
}

export interface ExtractionLineItem {
  description?: string;
  unit_price?: number;
  quantity?: number;
  tax_rate?: number;
  subtotal?: number;
  total_with_tax?: number;
}

export interface ExtractionResult {
  results: ExtractionFileResult[];
}

// === Spreadsheet Metadata Types ===

export interface ColumnTypeInfo {
  header: string;
  inferredType: 'string' | 'number' | 'date' | 'boolean' | 'mixed' | 'empty';
  sampleValues: unknown[];
  emptyRate: number;
}

export interface SheetMetadata {
  name: string;
  headers: string[];
  rowCount: number;
  colCount: number;
  columnTypes: ColumnTypeInfo[];
  sampleRows: Dict<unknown>[];
}

export interface SpreadsheetMetadata {
  fileName: string;
  fileType: 'xlsx' | 'csv';
  sheets: SheetMetadata[];
  totalRows: number;
}

// === Script Generation Types ===

export interface GeneratedScripts {
  parserPath: string;
  matcherPath: string;
  name: string;
  docType: DocType;
}

export interface VerificationResult {
  success: boolean;
  output?: ExtractionFileResult;
  error?: string;
}

// === Deduplication Types ===

export interface DuplicateSourceRow {
  id: string;
  canonical_record_id: string;
  source_file_id: string;
  source_record_id: string;
  relative_path: string;
  created_at: string;
}

// === Search Result Types ===

export interface SearchResult {
  id: string;
  doc_type: DocType;
  confidence: number;
  doc_date: string | null;
  relative_path: string;
  file_status: FileStatus;
  // Bank statement fields
  bank_name: string;
  account_number: string;
  amount: number;
  // Invoice fields
  invoice_code: string;
  invoice_number: string;
  total_before_tax: number;
  total_amount: number;
  fee_amount: number;
  fee_description: string;
  tax_id: string;
  // Computed: sum of line item total_with_tax (null if no line items)
  line_item_sum: number | null;
  // Computed: sum of line item subtotal (null if no line items)
  line_item_sum_before_tax: number | null;
  // Shared
  counterparty_name: string;
  description: string;
  counterparty_address: string;
  je_status: JEGenerationStatus | null;
  has_duplicates: boolean;
  // Line items (populated on detail expand)
  line_items?: InvoiceLineItem[];
}

// === Field Override Types ===

export interface FieldOverrideInput {
  recordId: string;
  tableName: string;
  fieldName: string;
  userValue: string;
}

export interface ProcessedFileInfo {
  id: string;
  relative_path: string;
  status: string;
  doc_type: string | null;
  updated_at: string;
  processing_started_at: string | null;
  record_count: number;
  overall_confidence: number;
}

export interface ErrorLogEntry {
  id: string;
  batch_id: string | null;
  level: LogLevel;
  message: string;
  detail: string | null;
  timestamp: string;
  relative_path: string | null;
}

export interface LineItemFieldInput {
  lineItemId: string;
  fieldName: string;
  userValue: string;
}

export interface FieldOverrideInfo {
  field_name: string;
  status: OverrideStatus;
  user_value: string;
  ai_value_at_lock: string;
  ai_value_latest: string | null;
}

// === Filter Presets ===

export interface FilterPreset {
  id: string;
  name: string;
  filtersJson: string; // JSON of PresetFilters
  createdAt: string;
}

export interface PresetFilters {
  query: string;
  filters: ParsedQuery;
  folderScope: string | null;
  fileScope: string | null;
}

// === Journal Entry Types ===

export type JEEntryType = 'line' | 'tax' | 'settlement' | 'bank' | 'invoice';
export type JESource = 'similarity' | 'ai' | 'user' | 'auto';
export type JEGenerationStatus = 'pending' | 'processing' | 'done' | 'error';
export type CashFlowType = 'operating' | 'investing' | 'financing';

export interface JournalEntry {
  id: string;
  record_id: string;
  line_item_id: string | null;
  entry_type: JEEntryType;
  account: string | null;
  contra_account: string | null;
  cash_flow: CashFlowType | null;
  source: JESource;
  similarity_score: number | null;
  matched_description: string | null;
  user_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface JournalEntryInput {
  recordId: string;
  lineItemId?: string;
  entryType: JEEntryType;
  account: string;
  contraAccount?: string | null;
  cashFlow?: CashFlowType;
}

export interface JEClassificationResult {
  lineItemId?: string;
  account: string;
  contraAccount?: string | null;
  cashFlow?: CashFlowType;
}

// === JE Queue Types ===

export interface JeQueueItem {
  record_id: string;
  je_status: JEGenerationStatus;
  doc_type: DocType;
  description: string; // invoice_code + invoice_number or description
  relative_path: string;
  created_at: string;
  je_processing_started_at: string | null;
}

export interface JeErrorItem {
  record_id: string;
  doc_type: DocType;
  description: string;
  relative_path: string;
  updated_at: string;
  je_processing_started_at: string | null;
}

// === Preload API ===

export interface InvoiceVaultAPI {
  search: (query: string, offset?: number, folder?: string | null, filePath?: string | null) => Promise<SearchResult[]>;
  getSearchResult: (recordId: string) => Promise<SearchResult | null>;
  locateFile: (relativePath: string) => Promise<void>;
  getLineItems: (recordId: string) => Promise<InvoiceLineItem[]>;
  saveFieldOverride: (input: FieldOverrideInput) => Promise<void>;
  getFieldOverrides: (recordId: string) => Promise<FieldOverrideInfo[]>;
  resolveConflict: (recordId: string, fieldName: string, action: 'keep' | 'accept') => Promise<void>;
  resolveAllConflicts: (recordId: string, action: 'keep' | 'accept') => Promise<void>;
  saveLineItemField: (input: LineItemFieldInput) => Promise<void>;
  getLineItemOverrides: (lineItemIds: string[]) => Promise<{ [lineItemId: string]: FieldOverrideInfo[] }>;
  // Spotlight UX additions
  getAppConfig: () => Promise<AppConfig>;
  getLocale: () => Promise<'en' | 'vi'>;
  setLocale: (locale: 'en' | 'vi') => Promise<void>;
  initVault: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  switchVault: (vaultPath: string) => Promise<{ success: boolean }>;
  removeVault: (vaultPath: string) => Promise<void>;
  clearVaultData: (vaultPath: string) => Promise<void>;
  backupVault: (vaultPath: string) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  pickFolder: () => Promise<string | null>;
  locateFolder: (relativePath: string) => Promise<void>;
  listRecentFolders: (limit?: number) => Promise<FolderInfo[]>;
  listTopFolders: () => Promise<FolderInfo[]>;
  getAggregates: (filters: SearchFilters) => Promise<AggregateStats>;
  exportFiltered: (filters: SearchFilters) => Promise<{ filePath: string | null }>;
  showItemInFolder: (absolutePath: string) => Promise<void>;
  checkClaudeCli: () => Promise<{ available: boolean; version?: string }>;
  getAppVersion: () => Promise<string>;
  reprocessAll: () => Promise<{ count: number }>;
  reprocessFile: (relativePath: string) => Promise<{ count: number }>;
  reprocessFolder: (folderPrefix: string) => Promise<{ count: number }>;
  countFolderFiles: (folderPrefix: string) => Promise<{ count: number }>;
  hideOverlay: () => Promise<void>;
  windowlize: (serializedState?: string) => Promise<void>;
  getInitialState: () => Promise<string | null>;
  closeWindow: () => Promise<void>;
  quitApp: () => Promise<void>;
  listVaultPaths: (query: string, scope?: string) => Promise<Array<{ name: string; relativePath: string; isDir: boolean }>>;
  // Processing status
  getFilesByStatuses: (statuses: FileStatus[]) => Promise<VaultFile[]>;
  getErrorLogsWithPath: () => Promise<ErrorLogEntry[]>;
  getProcessedFilesWithStats: () => Promise<ProcessedFileInfo[]>;
  getFileStatusesByPaths: (paths: string[]) => Promise<{ [path: string]: FileStatus }>;
  getFolderStatuses: () => Promise<{ [folder: string]: FileStatus }>;
  onFileStatusChanged: (callback: (data: { fileIds: string[]; status: FileStatus }) => void) => () => void;
  // Queue cancellation
  cancelQueueItem: (fileId: string) => Promise<{ success: boolean }>;
  clearPendingQueue: () => Promise<{ count: number }>;
  // Filter presets
  listPresets: () => Promise<FilterPreset[]>;
  savePreset: (name: string, filtersJson: string) => Promise<FilterPreset>;
  deletePreset: (id: string) => Promise<void>;
  // Journal entries
  getJournalEntries: (recordId: string) => Promise<JournalEntry[]>;
  saveJournalEntry: (input: JournalEntryInput) => Promise<JournalEntry>;
  deleteJournalEntry: (id: string) => Promise<void>;
  regenerateJE: (recordId: string) => Promise<void>;
  regenerateJEAIOnly: (recordId: string) => Promise<void>;
  regenerateJEFiltered: (filters: SearchFilters, aiOnly: boolean) => Promise<{ count: number }>;
  getJEInstructions: () => Promise<string>;
  saveJEInstructions: (content: string) => Promise<void>;
  getExtractionPrompt: () => Promise<string>;
  exportInstructions: () => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
  openInstructionFile: (file: 'extraction-prompt' | 'je-instructions' | 'config') => Promise<void>;
  // JE generation status
  getJeQueueItems: () => Promise<JeQueueItem[]>;
  getJeErrorItems: () => Promise<JeErrorItem[]>;
  onJeStatusChanged: (callback: (data: { recordIds: string[]; status: JEGenerationStatus }) => void) => () => void;
  getDuplicateSources: (recordId: string) => Promise<DuplicateSourceRow[]>;
  onDbError: (callback: (error: string) => void) => () => void;
  onFileDeleted: (callback: (data: { relativePath: string }) => void) => () => void;
  getDbError: () => Promise<string | null>;
  // Debug / session logs
  getSessionLogForFile: (fileId: string) => Promise<string | null>;
  readCliSessionLog: (sessionLogPath: string) => Promise<string | null>;
  // Window state persistence
  saveOverlayUIState: (state: PersistedUIState) => Promise<void>;
  getOverlayUIState: () => Promise<PersistedUIState | null>;
  saveSpawnedWindowUIState: (state: PersistedUIState) => Promise<void>;
  saveSpawnedWindowUIStateSync: (state: PersistedUIState) => void;
}

export interface PersistedUIState {
  overlayState: OverlayState;
  query: string;
  filters: ParsedQuery;
  folderScope: string | null;
  fileScope: string | null;
  expandedId: string | null;
}

// === Relevance Filter Types ===

export interface FilterKeyword {
  term: string;
  weight: number;
  category: 'invoice' | 'bank_statement' | 'general_accounting';
}

export interface RelevanceFilterConfig {
  skipThreshold: number;
  processThreshold: number;
  customKeywords: FilterKeyword[];
  customPathPatterns: string[];
  sizeMinBytes: number;
  sizeMaxBytes: number;
  sizePenalty: number;
  aiTriageEnabled: boolean;
  aiTriageBatchSize: number;
}

export interface FilterResult {
  score: number;
  reason: string;
  layer: 1 | 2 | 3;
  decision: 'skip' | 'process' | 'uncertain';
  category?: 'invoice' | 'bank_statement' | 'irrelevant';
}

// === Event Types ===

export interface AppEvents {
  'file:added': { relativePath: string; fullPath: string };
  'file:changed': { relativePath: string; fullPath: string };
  'file:deleted': { relativePath: string };
  'extraction:started': { fileIds: string[] };
  'extraction:completed': { batchId: string; fileId: string; recordCount: number; confidence: number };
  'extraction:error': { fileId: string; error: string };
  'review:needed': { fileId: string; recordCount: number };
  'conflicts:detected': { fileId: string; conflictCount: number };
  'vault:initialized': { path: string };
  'vault:opened': { path: string };
  'vault:db-error': { error: string };
  'je:generated': { recordId: string; count: number; source: JESource };
  'je:updated': { recordId: string };
  'je:status-changed': { recordIds: string[]; status: JEGenerationStatus };
  'je:instructions-changed': Record<string, never>;
  'instructions:changed': { file: string };
  'file:filtered': { fileId: string; relativePath: string; score: number; reason: string };
}
