export const MIGRATIONS: string[] = [
  // Migration 001: Core tables
  `
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    relative_path TEXT UNIQUE NOT NULL,
    file_hash TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    doc_type TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    deleted_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS extraction_batches (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id),
    status TEXT NOT NULL DEFAULT 'success',
    record_count INTEGER NOT NULL DEFAULT 0,
    overall_confidence REAL NOT NULL DEFAULT 0,
    claude_session_log TEXT,
    script_id TEXT,
    processed_at DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES extraction_batches(id),
    file_id TEXT NOT NULL REFERENCES files(id),
    doc_type TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    ngay DATE,
    field_confidence TEXT NOT NULL DEFAULT '{}',
    raw_extraction TEXT NOT NULL DEFAULT '{}',
    deleted_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bank_statement_data (
    record_id TEXT PRIMARY KEY REFERENCES records(id),
    ten_ngan_hang TEXT,
    stk TEXT,
    mo_ta TEXT,
    so_tien REAL,
    ten_doi_tac TEXT
  );

  CREATE TABLE IF NOT EXISTS invoice_data (
    record_id TEXT PRIMARY KEY REFERENCES records(id),
    so_hoa_don TEXT,
    tong_tien REAL,
    taxId TEXT,
    ten_doi_tac TEXT,
    dia_chi_doi_tac TEXT
  );

  CREATE TABLE IF NOT EXISTS invoice_line_items (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES records(id),
    line_number INTEGER NOT NULL,
    mo_ta TEXT,
    don_gia REAL,
    so_luong REAL,
    thue_suat REAL,
    thanh_tien REAL,
    deleted_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS extraction_scripts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    script_path TEXT NOT NULL,
    matcher_path TEXT NOT NULL,
    matcher_description TEXT,
    times_used INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    last_used_at DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS file_script_assignments (
    file_id TEXT NOT NULL REFERENCES files(id),
    script_id TEXT NOT NULL REFERENCES extraction_scripts(id),
    assigned_at DATETIME NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (file_id, script_id)
  );

  CREATE TABLE IF NOT EXISTS field_overrides (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES records(id),
    table_name TEXT NOT NULL,
    field_name TEXT NOT NULL,
    user_value TEXT NOT NULL,
    ai_value_at_lock TEXT NOT NULL,
    ai_value_latest TEXT,
    status TEXT NOT NULL DEFAULT 'locked',
    locked_at DATETIME NOT NULL DEFAULT (datetime('now')),
    conflict_at DATETIME,
    resolved_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS processing_logs (
    id TEXT PRIMARY KEY,
    batch_id TEXT REFERENCES extraction_batches(id),
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 002: Indexes
  `
  CREATE INDEX IF NOT EXISTS idx_files_relative_path ON files(relative_path);
  CREATE INDEX IF NOT EXISTS idx_files_file_hash ON files(file_hash);
  CREATE INDEX IF NOT EXISTS idx_files_doc_type ON files(doc_type);
  CREATE INDEX IF NOT EXISTS idx_records_fingerprint ON records(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_records_file_id ON records(file_id);
  CREATE INDEX IF NOT EXISTS idx_records_doc_type ON records(doc_type);
  CREATE INDEX IF NOT EXISTS idx_records_ngay ON records(ngay);
  CREATE INDEX IF NOT EXISTS idx_invoice_data_so_hoa_don ON invoice_data(so_hoa_don);
  CREATE INDEX IF NOT EXISTS idx_invoice_data_mst ON invoice_data(taxId);
  CREATE INDEX IF NOT EXISTS idx_invoice_line_items_record_id ON invoice_line_items(record_id);
  CREATE INDEX IF NOT EXISTS idx_bank_statement_data_stk ON bank_statement_data(stk);
  CREATE INDEX IF NOT EXISTS idx_field_overrides_record_id ON field_overrides(record_id);
  CREATE INDEX IF NOT EXISTS idx_field_overrides_status ON field_overrides(status);
  CREATE INDEX IF NOT EXISTS idx_extraction_scripts_doc_type ON extraction_scripts(doc_type);
  CREATE INDEX IF NOT EXISTS idx_file_script_assignments_file_id ON file_script_assignments(file_id);
  CREATE INDEX IF NOT EXISTS idx_file_script_assignments_script_id ON file_script_assignments(script_id);
  `,

  // Migration 003: FTS5 virtual table
  `
  CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
    so_hoa_don,
    taxId,
    ten_doi_tac,
    dia_chi_doi_tac,
    mo_ta,
    ten_ngan_hang,
    stk,
    content='',
    tokenize='unicode61'
  );
  `,

  // Migration 004: Add line_item_id to field_overrides for line-item-level overrides
  `
  ALTER TABLE field_overrides ADD COLUMN line_item_id TEXT REFERENCES invoice_line_items(id);
  CREATE INDEX IF NOT EXISTS idx_field_overrides_line_item_id ON field_overrides(line_item_id);
  `,

  // Migration 005: Add before-tax amount columns for tax rework
  `
  ALTER TABLE invoice_data ADD COLUMN tong_tien_truoc_thue REAL;
  ALTER TABLE invoice_line_items ADD COLUMN thanh_tien_truoc_thue REAL;
  `,

  // Migration 006: Filter presets
  `
  CREATE TABLE IF NOT EXISTS filter_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filters_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 007: Journal entries — single-sided double entry
  `
  CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES records(id),
    line_item_id TEXT REFERENCES invoice_line_items(id),
    entry_type TEXT NOT NULL DEFAULT 'line',
    account TEXT,
    cash_flow TEXT,
    source TEXT NOT NULL DEFAULT 'auto',
    similarity_score REAL,
    matched_description TEXT,
    user_edited INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_je_record_id ON journal_entries(record_id);
  CREATE INDEX IF NOT EXISTS idx_je_line_item_id ON journal_entries(line_item_id);
  `,

  // Migration 008: JE classification status on records
  `
  ALTER TABLE records ADD COLUMN je_status TEXT;
  CREATE INDEX IF NOT EXISTS idx_records_je_status ON records(je_status);
  `,

  // Migration 009: Rename columns to English; fix thanh_tien semantic inversion
  `
  ALTER TABLE records RENAME COLUMN ngay TO doc_date;

  ALTER TABLE bank_statement_data RENAME COLUMN ten_ngan_hang TO bank_name;
  ALTER TABLE bank_statement_data RENAME COLUMN stk TO account_number;
  ALTER TABLE bank_statement_data RENAME COLUMN mo_ta TO description;
  ALTER TABLE bank_statement_data RENAME COLUMN so_tien TO amount;
  ALTER TABLE bank_statement_data RENAME COLUMN ten_doi_tac TO counterparty_name;

  ALTER TABLE invoice_data RENAME COLUMN so_hoa_don TO invoice_number;
  ALTER TABLE invoice_data RENAME COLUMN tong_tien_truoc_thue TO total_before_tax;
  ALTER TABLE invoice_data RENAME COLUMN tong_tien TO total_amount;
  ALTER TABLE invoice_data RENAME COLUMN taxId TO tax_id;
  ALTER TABLE invoice_data RENAME COLUMN ten_doi_tac TO counterparty_name;
  ALTER TABLE invoice_data RENAME COLUMN dia_chi_doi_tac TO counterparty_address;

  ALTER TABLE invoice_line_items RENAME COLUMN mo_ta TO description;
  ALTER TABLE invoice_line_items RENAME COLUMN don_gia TO unit_price;
  ALTER TABLE invoice_line_items RENAME COLUMN so_luong TO quantity;
  ALTER TABLE invoice_line_items RENAME COLUMN thue_suat TO tax_rate;
  ALTER TABLE invoice_line_items RENAME COLUMN thanh_tien_truoc_thue TO subtotal;
  ALTER TABLE invoice_line_items RENAME COLUMN thanh_tien TO total_with_tax;

  DROP INDEX IF EXISTS idx_records_ngay;
  CREATE INDEX IF NOT EXISTS idx_records_doc_date ON records(doc_date);
  DROP INDEX IF EXISTS idx_invoice_data_so_hoa_don;
  CREATE INDEX IF NOT EXISTS idx_invoice_data_invoice_number ON invoice_data(invoice_number);
  DROP INDEX IF EXISTS idx_invoice_data_mst;
  CREATE INDEX IF NOT EXISTS idx_invoice_data_tax_id ON invoice_data(tax_id);
  DROP INDEX IF EXISTS idx_bank_statement_data_stk;
  CREATE INDEX IF NOT EXISTS idx_bank_statement_data_account_number ON bank_statement_data(account_number);

  UPDATE field_overrides SET field_name = 'invoice_number' WHERE field_name = 'so_hoa_don';
  UPDATE field_overrides SET field_name = 'total_before_tax' WHERE field_name = 'tong_tien_truoc_thue';
  UPDATE field_overrides SET field_name = 'total_amount' WHERE field_name = 'tong_tien';
  UPDATE field_overrides SET field_name = 'tax_id' WHERE field_name = 'taxId';
  UPDATE field_overrides SET field_name = 'counterparty_name' WHERE field_name = 'ten_doi_tac';
  UPDATE field_overrides SET field_name = 'counterparty_address' WHERE field_name = 'dia_chi_doi_tac';
  UPDATE field_overrides SET field_name = 'bank_name' WHERE field_name = 'ten_ngan_hang';
  UPDATE field_overrides SET field_name = 'account_number' WHERE field_name = 'stk';
  UPDATE field_overrides SET field_name = 'description' WHERE field_name = 'mo_ta';
  UPDATE field_overrides SET field_name = 'amount' WHERE field_name = 'so_tien';
  UPDATE field_overrides SET field_name = 'unit_price' WHERE field_name = 'don_gia';
  UPDATE field_overrides SET field_name = 'quantity' WHERE field_name = 'so_luong';
  UPDATE field_overrides SET field_name = 'tax_rate' WHERE field_name = 'thue_suat';
  UPDATE field_overrides SET field_name = 'subtotal' WHERE field_name = 'thanh_tien_truoc_thue';
  UPDATE field_overrides SET field_name = 'total_with_tax' WHERE field_name = 'thanh_tien';
  `,

  // Migration 010: Recreate FTS5 virtual table with English column names
  `
  DROP TABLE IF EXISTS records_fts;

  CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
    invoice_number,
    tax_id,
    counterparty_name,
    counterparty_address,
    description,
    bank_name,
    account_number,
    content='',
    tokenize='unicode61'
  );
  `,
  
  // Migration 010: Relevance filter metadata on files
  `
  ALTER TABLE files ADD COLUMN filter_score REAL;
  ALTER TABLE files ADD COLUMN filter_reason TEXT;
  ALTER TABLE files ADD COLUMN filter_layer INTEGER;
  CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
  `,

  // Migration 011: Structured error detail and file_id for processing_logs
  `
  ALTER TABLE processing_logs ADD COLUMN detail TEXT;
  ALTER TABLE processing_logs ADD COLUMN file_id TEXT;
  `,
];
