// === Enums ===

export enum DocType {
  BankStatement = 'bank_statement',
  InvoiceOut = 'invoice_out',
  InvoiceIn = 'invoice_in',
  Unknown = 'unknown',
}

export enum FileStatus {
  Pending = 'pending',
  Processing = 'processing',
  Done = 'done',
  Review = 'review',
  Error = 'error',
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
  Home = 'home',
  Search = 'search',
  Settings = 'settings',
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
  docType?: string;
  status?: string;
  amountMin?: number;
  amountMax?: number;
  dateFilter?: string;
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

export interface Record {
  id: string;
  batch_id: string;
  file_id: string;
  doc_type: DocType;
  fingerprint: string;
  confidence: number;
  ngay: string | null;
  field_confidence: string; // JSON
  raw_extraction: string; // JSON
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankStatementData {
  record_id: string;
  ten_ngan_hang: string | null;
  stk: string | null;
  mo_ta: string | null;
  so_tien: number | null;
  ten_doi_tac: string | null;
}

export interface InvoiceData {
  record_id: string;
  so_hoa_don: string | null;
  tong_tien: number | null;
  mst: string | null;
  ten_doi_tac: string | null;
  dia_chi_doi_tac: string | null;
}

export interface InvoiceLineItem {
  id: string;
  record_id: string;
  line_number: number;
  mo_ta: string | null;
  don_gia: number | null;
  so_luong: number | null;
  thue_suat: number | null;
  thanh_tien: number | null;
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
}

export interface VaultHandle {
  rootPath: string;
  dotPath: string;
  dbPath: string;
  config: VaultConfig;
}

// === App Config (persisted in userData) ===

export interface AppConfig {
  lastVaultPath: string | null;
  claudeCliPath: string | null;
  vaultPaths: string[];
  autoStart: boolean;
}

// === Claude CLI Extraction Types ===

export interface ExtractionFileResult {
  relative_path: string;
  doc_type: DocType;
  records: ExtractionRecord[];
  error?: string;
}

export interface ExtractionRecord {
  fingerprint?: string;
  confidence: number;
  field_confidence: { [field: string]: number };
  ngay: string | null;
  data: ExtractionRecordData;
  line_items?: ExtractionLineItem[];
}

export type ExtractionRecordData = ExtractionBankStatementData | ExtractionInvoiceData;

export interface ExtractionBankStatementData {
  ten_ngan_hang?: string;
  stk?: string;
  mo_ta?: string;
  so_tien?: number;
  ten_doi_tac?: string;
}

export interface ExtractionInvoiceData {
  so_hoa_don?: string;
  tong_tien?: number;
  mst?: string;
  ten_doi_tac?: string;
  dia_chi_doi_tac?: string;
}

export interface ExtractionLineItem {
  mo_ta?: string;
  don_gia?: number;
  so_luong?: number;
  thue_suat?: number;
  thanh_tien?: number;
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
  sampleRows: Record<string, unknown>[];
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

// === Search Result Types ===

export interface SearchResult {
  id: string;
  doc_type: DocType;
  confidence: number;
  ngay: string | null;
  relative_path: string;
  // Bank statement fields
  ten_ngan_hang: string;
  stk: string;
  so_tien: number;
  // Invoice fields
  so_hoa_don: string;
  tong_tien: number;
  mst: string;
  // Shared
  ten_doi_tac: string;
  mo_ta: string;
  dia_chi_doi_tac: string;
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

export interface FieldOverrideInfo {
  field_name: string;
  status: OverrideStatus;
  user_value: string;
  ai_value_at_lock: string;
  ai_value_latest: string | null;
}

// === Preload API ===

export interface InvoiceVaultAPI {
  search: (query: string) => Promise<SearchResult[]>;
  openFile: (relativePath: string) => Promise<void>;
  getLineItems: (recordId: string) => Promise<InvoiceLineItem[]>;
  saveFieldOverride: (input: FieldOverrideInput) => Promise<void>;
  getFieldOverrides: (recordId: string) => Promise<FieldOverrideInfo[]>;
  resolveConflict: (recordId: string, fieldName: string, action: 'keep' | 'accept') => Promise<void>;
  resolveAllConflicts: (recordId: string, action: 'keep' | 'accept') => Promise<void>;
  // Spotlight UX additions
  getAppConfig: () => Promise<AppConfig>;
  initVault: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  switchVault: (vaultPath: string) => Promise<{ success: boolean }>;
  removeVault: (vaultPath: string) => Promise<void>;
  pickFolder: () => Promise<string | null>;
  openFolder: (relativePath: string) => Promise<void>;
  listRecentFolders: (limit?: number) => Promise<FolderInfo[]>;
  listTopFolders: () => Promise<FolderInfo[]>;
  getAggregates: (filters: SearchFilters) => Promise<AggregateStats>;
  exportFiltered: (filters: SearchFilters) => Promise<{ filePath: string | null }>;
  showItemInFolder: (absolutePath: string) => Promise<void>;
  checkClaudeCli: () => Promise<{ available: boolean; version?: string }>;
  reprocessAll: () => Promise<{ count: number }>;
  hideOverlay: () => Promise<void>;
  quitApp: () => Promise<void>;
  onStatusUpdate: (callback: (status: 'idle' | 'processing' | 'review' | 'error') => void) => () => void;
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
}
