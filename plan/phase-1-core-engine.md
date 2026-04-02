# Phase 1 — Core Engine: Vault Init, File Watcher, SQLite

> **Goal:** The app can initialize a vault folder, watch it for file changes, and persist file metadata to SQLite.
> **Output:** Drop a PDF into an initialized vault folder → file appears in `vault.db` `files` table with hash and status `pending`.

---

## Tasks

### 1.1 Vault initialization
- Create `.invoicevault/` directory structure:
  ```
  .invoicevault/
  ├── config.json       ← { version, created_at, vault_root }
  ├── vault.db          ← SQLite database
  ├── logs/
  ├── scripts/
  └── queue/
  ```
- Service: `VaultManager` — `init(folderPath)`, `isVault(folderPath)`, `getConfig()`
- Validate folder is not already a vault, not inside another vault

### 1.2 SQLite database setup
- Install `better-sqlite3` + `@types/better-sqlite3`
- Service: `DatabaseManager` — manages connection lifecycle, migrations
- **Migration 001:** Create all core tables from PRD §9:
  - `files`, `extraction_batches`, `records`
  - `bank_statement_data`, `invoice_data`, `invoice_line_items`
  - `extraction_scripts`, `file_script_assignments`
  - `field_overrides`, `processing_logs`
- **Migration 002:** Create all indexes from PRD §9.2
- **Migration 003:** Create FTS5 virtual table `records_fts`
- Use a simple sequential migration runner (no heavy ORM)

### 1.3 File watcher
- Install `chokidar`
- Service: `FileWatcher` — wraps chokidar with:
  - Recursive watching of vault root
  - Ignore `.invoicevault/` directory
  - Ignore patterns from `.invoicevaultignore` (if exists)
  - Debounced events (300ms)
  - File extension filter: `.pdf`, `.xml`, `.xlsx`, `.csv`, `.jpg`, `.png`
- Emit events: `file:added`, `file:changed`, `file:deleted`

### 1.4 File sync engine
- Service: `SyncEngine` — connects watcher events to DB:
  - **New file:** Compute SHA-256 hash, insert into `files` table with status `pending`
  - **Modified file:** Recompute hash, update `files.file_hash` and `files.updated_at`, set status `pending`
  - **Deleted file:** Set `files.deleted_at = now()`, cascade soft-delete to linked records
- Hash computation: stream-based SHA-256 for large files

### 1.5 Integration wiring
- Main process on app ready:
  1. Load vault config (or prompt for init — later phases)
  2. Open SQLite connection
  3. Start file watcher
  4. Wire watcher events → SyncEngine

---

## Acceptance Criteria
- [ ] `VaultManager.init("/some/folder")` creates `.invoicevault/` with valid `config.json` and `vault.db`
- [ ] All tables and indexes exist in `vault.db` after init
- [ ] Dropping a `.pdf` file into the vault → row appears in `files` table within 1 second
- [ ] Modifying the file → `file_hash` updates, status resets to `pending`
- [ ] Deleting the file → `deleted_at` is set (not removed from DB)
- [ ] `.invoicevault/` directory itself is not watched
