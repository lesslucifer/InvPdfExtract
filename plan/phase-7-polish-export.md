# Phase 7 — Polish, Export & Multi-Vault

> **Goal:** Production-ready features: Excel export, multiple vault support, OS context menu integration, and reliability improvements.
> **Output:** Right-click a folder in Finder → "Search InvoiceVault". Export filtered records to Excel. Manage multiple vault folders.

---

## Tasks

### 7.1 Export to Excel/CSV
- Tray menu: "Export to Excel..." → native save dialog
- Export options:
  - All records or current search filter
  - Group by doc_type (separate sheets per type)
  - Include/exclude soft-deleted records
- Use `xlsx` library (already available from Phase 5)
- Export format:
  - Sheet 1: Bank statements (flat)
  - Sheet 2: Invoice headers (bảng kê)
  - Sheet 3: Invoice line items (chi tiết) with parent invoice reference
- CSV export as alternative (single flat file per doc_type)

### 7.2 Multiple vault support
- `app-config.json` stores array of vault paths instead of single path
- Tray menu additions:
  - "Initialize New Vault..." → folder picker
  - "Switch Vault" → submenu listing all vaults
  - "Remove Vault" → removes from config (does not delete `.invoicevault/`)
- Each vault has independent SQLite DB, watcher, and queue
- Only one vault active at a time (active = being watched + searchable)

### 7.3 Native OS context menu integration
- **macOS — Finder Extension (FinderSync API):**
  - Swift-based Finder Sync Extension
  - Right-click a folder → "Search InvoiceVault"
  - Communicates with main Electron app via XPC or local socket
  - Requires Apple Developer signing
- **Windows — Shell Extension:**
  - Registry-based context menu entry
  - Right-click folder → "Search InvoiceVault"
  - Launches overlay scoped to the selected folder
- Both pass the folder path to scope the search overlay

### 7.4 Auto-start on boot
- macOS: Login Items via `app.setLoginItemSettings()`
- Windows: Registry run key or Startup folder shortcut
- Configurable in Settings (default: off)

### 7.5 `.invoicevaultignore` support
- Gitignore-style file at vault root
- Patterns to exclude files/folders from watching
- Default ignores: `node_modules`, `.git`, `.DS_Store`, `Thumbs.db`
- Parsed by `FileWatcher` on startup and on file change

### 7.6 Batch reprocessing
- Tray menu: "Reprocess All Files" / "Reprocess Selected..."
- Resets status to `pending` for targeted files
- Respects field locks during re-extraction (Phase 6 logic)

### 7.7 Activity log window
- "View Recent Activity" in tray menu → small `BrowserWindow`
- Shows last N processing events from `processing_logs`
- Filterable by level (info/warn/error)
- Auto-scrolls, dismissable

### 7.8 Reliability & edge cases
- Graceful shutdown: flush queue, close DB, stop watcher
- Handle large vaults (10k+ files): chunked initial scan, progress indicator
- Handle Claude Code CLI unavailable: queue files, retry with backoff
- Handle corrupt/unreadable files: log error, skip, notify user
- Database WAL mode for concurrent read/write

---

## Acceptance Criteria
- [ ] "Export to Excel" produces a valid `.xlsx` with correct sheets and data
- [ ] Multiple vaults can be initialized and switched between
- [ ] macOS Finder right-click shows "Search InvoiceVault" on initialized folders
- [ ] Windows Explorer right-click shows "Search InvoiceVault" on initialized folders
- [ ] Auto-start toggle works on both platforms
- [ ] `.invoicevaultignore` patterns are respected by the watcher
- [ ] "Reprocess All" re-extracts files while preserving field locks
- [ ] Activity log window shows processing history
- [ ] App handles 10k+ files without hanging
- [ ] App shuts down cleanly without data loss
