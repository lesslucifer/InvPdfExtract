# Phase 5 — Structured File Extraction & Script Caching

> **Goal:** XML, Excel, and CSV files are extracted via Claude-generated parser scripts, which are cached and reused for similar files.
> **Output:** Drop a Vietcombank `.xlsx` statement → Claude generates a parser + matcher script → second Vietcombank file reuses the cached script automatically.

---

## Tasks

### 5.1 Script generation pipeline
- Extend `ClaudeCodeRunner` to handle structured files (XML/Excel/CSV)
- New prompt template for script generation:
  - Inspect file structure (headers, sheets, XML tags)
  - Generate a standalone Node.js parser script that outputs JSON matching the InvoiceVault schema
  - Generate a matcher function that returns `true` for files with the same structure
- Scripts are saved to `.invoicevault/scripts/` with naming: `{name}-parser.js`, `{name}-matcher.js`

### 5.2 Script registry
- Service: `ScriptRegistry`
  - Register new scripts in `extraction_scripts` table
  - Load all matchers on startup
  - `findMatchingScript(filePath)` — run each matcher against the file, return first match
  - Track usage: increment `times_used`, update `last_used_at`
  - Record file→script assignments in `file_script_assignments`

### 5.3 Matcher evaluation
- For each new structured file:
  1. Run all cached matchers (sandboxed, with timeout per matcher: 5s)
  2. If match found → execute cached parser script
  3. If no match → invoke Claude to generate new parser + matcher
- Matcher functions receive the file path and return `boolean`
- Handle matcher errors gracefully (log and skip, don't block)

### 5.4 Script execution sandbox
- Execute parser scripts via `child_process.fork()` or `vm` module
- Timeout: 30s per script execution
- Capture stdout as JSON result
- If script fails or produces low-confidence results → fall back to Claude extraction
- Install common dependencies available to scripts: `xlsx`, `csv-parse`, `xml2js`

### 5.5 Multi-record file handling
- Excel files with multiple sheets (bảng kê + chi tiết):
  - Parser must handle sheet linking (e.g., invoice number links header to detail rows)
  - Return both invoice-level records and their line items
- CSV with inline detail rows:
  - Parser identifies header vs. detail rows
  - Groups line items under their parent invoice
- XML e-invoices:
  - Parse namespace-aware XML
  - Handle single and multi-invoice XML files

### 5.6 Enhanced reconciler
- Upgrade `Reconciler` from Phase 2 to handle:
  - Multi-record files: fingerprint-based diff (insert/update/soft-delete per record)
  - Line item updates: cascade from parent record changes
  - Partial re-extraction: only update records whose fingerprints changed

### 5.7 Validation rules
- Implement doc_type-specific validation (PRD §3):
  - `invoice_out`: sequential order of số hóa đơn — flag gaps
  - `invoice_out` + `invoice_in`: Σ chi tiết thành tiền = bảng kê tổng tiền
  - `invoice_out`: flag missing số hóa đơn
  - `bank_statement`: normalize Dr./Cr. direction
- Validation warnings stored in extraction batch and surfaced in notifications

### 5.8 Rename/move detection
- On `file:deleted` + `file:added` with same hash → treat as rename/move
- Update `files.relative_path`, preserve all linked records
- Implementation: buffer delete events for 2s, check if a matching hash appears

---

## Acceptance Criteria
- [ ] An `.xlsx` bank statement triggers Claude to generate parser + matcher scripts
- [ ] Scripts are saved to `.invoicevault/scripts/` and registered in DB
- [ ] A second file with the same structure reuses the cached script (no Claude call for extraction)
- [ ] Multi-sheet Excel files with bảng kê + chi tiết are correctly parsed and linked
- [ ] XML e-invoices are parsed with line items
- [ ] CSV files with inline detail rows are correctly grouped
- [ ] Re-processing a modified multi-record file correctly inserts/updates/soft-deletes per fingerprint
- [ ] Sequential order validation flags gaps in số hóa đơn
- [ ] Total validation flags mismatches between chi tiết sum and bảng kê total
- [ ] File renames are detected and path is updated without data loss
