# Phase 2 — PDF Extraction Pipeline (Claude Code CLI)

> **Goal:** PDF files in the vault are automatically classified and extracted via Claude Code CLI, with results stored in SQLite.
> **Output:** Drop a Vietnamese VAT invoice PDF → extracted fields appear in `records` + `invoice_data` + `invoice_line_items` tables with confidence scores.

---

## Tasks

### 2.1 Claude Code CLI spawner
- Service: `ClaudeCodeRunner`
  - Spawn `claude` as child process via `child_process.spawn`
  - Use `--print` mode for non-interactive output
  - Pass system prompt from `.invoicevault/extraction-prompt.md`
  - Handle stdout/stderr streaming, timeout (configurable, default 120s)
  - Parse JSON output with error recovery (strip markdown fences if present)
  - Validate `claude` is installed on startup (`claude --version`)

### 2.2 Extraction prompt engineering
- Create `.invoicevault/extraction-prompt.md` template covering:
  - Document classification rules (bank_statement, invoice_out, invoice_in)
  - Vietnamese-specific field extraction (hóa đơn GTGT, MST, etc.)
  - Output JSON contract matching PRD §10.4
  - Per-field confidence scoring instructions
  - Fingerprint computation rules per doc_type (PRD §3)
- The prompt must handle both single-file and batch-file inputs

### 2.3 Extraction queue processor
- Service: `ExtractionQueue`
  - Poll `files` table for status `pending`
  - Batch files (configurable batch size, default 5)
  - For each batch: invoke `ClaudeCodeRunner`
  - Update `files.status` to `processing` during extraction
  - On success: status → `done` (or `review` if confidence < threshold)
  - On failure: status → `error`, log to `processing_logs`

### 2.4 Result reconciler (basic)
- Service: `Reconciler`
  - Parse Claude Code JSON output
  - For each file result:
    1. Create `extraction_batches` row
    2. Compute fingerprint per record
    3. Upsert records: insert new, update existing (by fingerprint), soft-delete missing
    4. Insert into extension tables (`bank_statement_data` or `invoice_data`)
    5. Insert `invoice_line_items` for invoice types
    6. Update FTS5 index
  - Handle partial results (some files succeed, some fail)

### 2.5 Confidence scoring & flagging
- Overall confidence = weighted average of field confidences
- Configurable threshold (default 0.8 from PRD §11.2)
- Records below threshold: file status → `review`
- Store per-field confidence in `records.field_confidence` JSON

### 2.6 End-to-end wiring
- Watcher detects new PDF → SyncEngine creates file row → ExtractionQueue picks it up → ClaudeCodeRunner extracts → Reconciler stores results
- Full pipeline should work automatically with no user interaction

---

## Acceptance Criteria
- [ ] `ClaudeCodeRunner` spawns `claude --print` and returns parsed JSON
- [ ] A Vietnamese hóa đơn GTGT PDF is correctly classified as `invoice_out` or `invoice_in`
- [ ] Extracted fields (số hóa đơn, MST, tổng tiền, ngày, line items) are stored in correct tables
- [ ] Fingerprints are computed and stored
- [ ] Re-extracting the same file updates existing records (not duplicates)
- [ ] Low-confidence records get status `review`
- [ ] Errors are logged to `processing_logs`
- [ ] Bank statement PDFs are classified and extracted with flat records (no line items)
