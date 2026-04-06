# PREP.md -- Quick Filter Irrelevant Files

## Strategy Selection

**Primary strategy: Bottom-Up Layered Build**
Build from foundational types and data layer upward through business logic to integration and UI. Each phase produces testable, independently verifiable units. This avoids forward references and ensures every phase compiles and passes tests before proceeding.

**Secondary strategy: Test-Alongside**
Every phase includes its corresponding test file. Tests are written immediately after (or during) the implementation of each module, not deferred to a later phase.

**Rationale:** The feature is a pipeline of three layers with clear data flow boundaries. Building bottom-up (types -> DB -> pure logic -> orchestrator -> integration -> UI) matches the dependency graph exactly. Each layer can be tested in isolation before wiring them together.

---

## Phase Overview

| Phase | Focus | New Files | Modified Files | Est. Complexity |
|-------|-------|-----------|----------------|-----------------|
| 1 | Types, enums, config constants | -- | 2 | Low |
| 2 | DB migration + file DB functions | -- | 2 | Low |
| 3 | Dependencies + filter config loader | 1 | 2 | Low |
| 4 | Keyword bank + fuzzy matcher | 2 | -- | Medium |
| 5 | Layer 1: filename/path filter | 2 | -- | Medium |
| 6 | Layer 2: content sniffer | 2 | -- | Medium-High |
| 7 | Layer 3: AI triage | 2 | -- | Medium |
| 8 | Orchestrator (RelevanceFilter class) | 2 | -- | High |
| 9 | Event bus + main.ts integration | -- | 3 | High |
| 10 | UI: StatusDot, FilterPills, ProcessingStatusPanel, IPC | -- | 5+ | Medium |
| 11 | Final validation + regression check | -- | -- | Low |

---

## Phase 1 -- Types, Enums, and Config Constants

**Goal:** Establish all shared type definitions so subsequent phases can import them without circular dependencies.

### Step 1.1 -- Add `Skipped` to FileStatus enum
- **File:** `src/shared/types/index.ts`
- **Action:** Add `Skipped = 'skipped'` to the `FileStatus` enum after `Error = 'error'`
- **Validation:** TypeScript compiles without error

### Step 1.2 -- Add filter-related types to shared types
- **File:** `src/shared/types/index.ts`
- **Action:** Add the following interfaces/types:
  - `FilterKeyword` (term, weight, category)
  - `RelevanceFilterConfig` (thresholds, custom keywords, size limits, AI triage settings)
  - `FilterResult` (score, reason, layer, decision, category)
- **Action:** Extend `VaultFile` interface with nullable fields: `filter_score`, `filter_reason`, `filter_layer`
- **Action:** Add `'file:filtered'` event to `AppEvents` interface with payload `{ fileId: string; relativePath: string; score: number; reason: string }`
- **Validation:** TypeScript compiles; no existing tests break

### Step 1.3 -- Add default config constants
- **File:** `src/shared/constants.ts`
- **Action:** Add `FILTER_CONFIG_FILE = 'filter-config.json'` constant
- **Action:** Add `DEFAULT_FILTER_CONFIG` object with all default values from PR Section 3.2
- **Validation:** Import works from other modules; `pnpm test` passes (no regressions)

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 2 -- Database Migration and File DB Functions

**Goal:** Schema supports filter metadata; DB helper functions are ready for use by the filter pipeline.

### Step 2.1 -- Add Migration 009
- **File:** `src/core/db/schema.ts`
- **Action:** Append a new migration string to the `MIGRATIONS` array:
  ```
  ALTER TABLE files ADD COLUMN filter_score REAL;
  ALTER TABLE files ADD COLUMN filter_reason TEXT;
  ALTER TABLE files ADD COLUMN filter_layer INTEGER;
  CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
  ```
- **Risk:** Migration must be appended (not inserted) to preserve ordering. Check current migration count first.
- **Validation:** App starts without DB errors; new columns visible in vault.db

### Step 2.2 -- Add filter DB functions
- **File:** `src/core/db/files.ts`
- **Action:** Add `updateFileFilterResult(id, status, filterScore, filterReason, filterLayer)` function
- **Action:** Add `getSkippedFiles()` function
- **Action:** Update `STATUS_PRIORITY` map to include `[FileStatus.Skipped]: 5`
- **Validation:** Existing `files.test.ts` still passes; new functions are callable

### Step 2.3 -- Write tests for new DB functions
- **File:** `src/core/db/files.test.ts` (modify existing)
- **Action:** Add test cases for:
  - `updateFileFilterResult` correctly sets all filter columns
  - `getSkippedFiles` returns only skipped, non-deleted files
  - `STATUS_PRIORITY` includes `skipped` at lowest priority
- **Validation:** `pnpm test src/core/db/files.test.ts` passes

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 3 -- Dependencies and Filter Config Loader

**Goal:** Install runtime dependencies; create the config loader module so filter modules can read user settings.

### Step 3.1 -- Install dependencies
- **Action:** Run `pnpm add fuse.js pdf-parse && pnpm add -D @types/pdf-parse`
- **Validation:** `pnpm ls fuse.js pdf-parse` shows both installed
- **Risk:** Verify pdf-parse has no native bindings that would complicate Electron packaging (PR confirms it is pure JS)

### Step 3.2 -- Create filter config loader
- **File:** `src/core/filters/config.ts` (NEW)
- **Action:** Create the `filters/` directory under `src/core/`
- **Action:** Implement `loadFilterConfig(dotPath)` -- reads `.invoicevault/filter-config.json`, merges with defaults
- **Action:** Implement `saveFilterConfig(dotPath, config)` -- writes config to disk
- **Validation:** Unit test loading from a temp directory with and without config file

### Step 3.3 -- Write default filter config on vault init
- **File:** `src/core/vault.ts`
- **Action:** In `initVault()`, after writing `config.json`, write `filter-config.json` with `DEFAULT_FILTER_CONFIG`
- **Validation:** Creating a new vault produces `.invoicevault/filter-config.json` with correct defaults

### Step 3.4 -- Write tests for config loader
- **File:** `src/core/filters/config.test.ts` (NEW)
- **Action:** Test cases:
  - Returns defaults when no config file exists
  - Returns merged config when file exists with partial overrides
  - Returns defaults when config file is corrupted JSON
  - `saveFilterConfig` round-trips correctly
- **Validation:** `pnpm test src/core/filters/config.test.ts` passes

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 4 -- Keyword Bank and Fuzzy Matcher

**Goal:** The keyword bank and Fuse.js-based matcher are self-contained and fully tested before any filter layer uses them.

### Step 4.1 -- Create keyword bank module
- **File:** `src/core/filters/keyword-bank.ts` (NEW)
- **Action:** Implement:
  - `BUILTIN_KEYWORDS` array (all entries from PR Section 4.1)
  - `RELEVANT_PATH_PATTERNS` array
  - `RELEVANT_FILENAME_PATTERNS` regex array
  - `getMergedKeywords(config)` function
  - `createKeywordMatcher(keywords)` function returning a scoring function
- **Key detail:** The matcher uses sliding window n-grams over input text, plus exact substring fallback. Score formula: `1 - product(1 - weight * (1 - fuseScore))` for diminishing returns.
- **Validation:** All exports are importable; types align with Phase 1 definitions

### Step 4.2 -- Write keyword bank tests
- **File:** `src/core/filters/keyword-bank.test.ts` (NEW)
- **Action:** Implement all 8 test cases from PR Section 9.1:
  - getMergedKeywords: returns builtins, overrides duplicates, adds new custom
  - createKeywordMatcher: Vietnamese invoice text > 0.8, English invoice > 0.5, irrelevant < 0.2, fuzzy OCR typo > 0.5, bank statement > 0.7
- **Validation:** `pnpm test src/core/filters/keyword-bank.test.ts` -- all pass

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 5 -- Layer 1: Filename and Path Filter

**Goal:** Pure, synchronous filename/path/size heuristic scoring. No I/O, no async, no dependencies beyond keyword-bank.

### Step 5.1 -- Create filename filter module
- **File:** `src/core/filters/filename-filter.ts` (NEW)
- **Action:** Implement `filenameFilter(relativePath, fileSize, config)` returning `FilterResult`
- **Key scoring logic:**
  - Path pattern match: +0.3
  - Filename regex match: +0.35
  - Filename keyword substring match: +0.4
  - Size penalty (too small or too large): -config.sizePenalty
  - Score clamped to [0, 1]
  - Decision: score > processThreshold -> 'process'; else -> 'uncertain' (Layer 1 never skips)
- **Validation:** Function returns correct FilterResult shape

### Step 5.2 -- Write filename filter tests
- **File:** `src/core/filters/filename-filter.test.ts` (NEW)
- **Action:** Implement all 7 test cases from PR Section 9.2:
  - Accounting folder path scores > 0.3
  - Vietnamese invoice filename scores > 0.6 (process decision)
  - Generic filename scores 0
  - Size penalty for tiny files
  - Size penalty for huge files
  - Invoice number patterns detected
  - Custom path patterns honored
- **Validation:** `pnpm test src/core/filters/filename-filter.test.ts` -- all pass

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 6 -- Layer 2: Content Sniffer

**Goal:** Async content extraction from PDF/XLSX/CSV/XML files, combined with keyword scoring.

### Step 6.1 -- Create content sniffer module
- **File:** `src/core/filters/content-sniffer.ts` (NEW)
- **Action:** Implement:
  - `contentSniffer(fullPath, layer1Score, config)` -- main async function
  - `extractPdfText(fullPath)` -- uses pdf-parse, max 2 pages
  - `extractSpreadsheetText(fullPath)` -- uses xlsx (already a dep), sheet names + first 10 rows
  - `extractXmlText(fullPath)` -- reads first 8KB, extracts element names/attrs/text via regex
  - Image files (.jpg/.jpeg/.png) -- returns layer1Score passthrough with explanation
- **Key scoring logic:** Combined score = `1 - (1 - layer1Score) * (1 - contentScore)` (probability union)
- **Key detail:** Uses `require()` for pdf-parse and xlsx to avoid loading them when not needed
- **Risk:** pdf-parse and xlsx behavior in Electron bundled environment. Test with actual files if possible.
- **Validation:** Function handles all file types without throwing

### Step 6.2 -- Write content sniffer tests
- **File:** `src/core/filters/content-sniffer.test.ts` (NEW)
- **Action:** Implement all 5 test cases from PR Section 9.3:
  - Image files return fallback result
  - Extraction failure handled gracefully (no throw)
  - Spreadsheet text extraction captures sheet names and headers
  - XML text extraction captures element names and text
  - Score combination formula verified (combined > max of inputs)
- **Note:** Some tests may need mock/fixture files. Create minimal test fixtures or mock fs reads.
- **Validation:** `pnpm test src/core/filters/content-sniffer.test.ts` -- all pass

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 7 -- Layer 3: AI Triage

**Goal:** Claude Haiku batch classification for uncertain files. Fully mockable for testing.

### Step 7.1 -- Create AI triage module
- **File:** `src/core/filters/ai-triage.ts` (NEW)
- **Action:** Implement:
  - `TRIAGE_SYSTEM_PROMPT` constant
  - `aiTriageBatch(inputs, config, cliPath?)` -- batches files, calls ClaudeCodeRunner with 'fast' model, 30s timeout
  - `parseTriageResponse(raw, expectedCount)` -- extracts JSON array, handles markdown fences, returns null for missing indices
  - Types: `TriageInput`, `TriageOutput`
- **Key behavior:** On any AI failure, return `'process'` for all files (fail-open). Text samples truncated to 500 chars.
- **Validation:** Exports are importable

### Step 7.2 -- Write AI triage tests
- **File:** `src/core/filters/ai-triage.test.ts` (NEW)
- **Action:** Implement all 4 test cases from PR Section 9.4:
  - Valid JSON array parsed correctly
  - Markdown-wrapped JSON handled
  - Invalid JSON returns all nulls
  - Missing indices produce nulls at correct positions
- **Note:** Tests focus on `parseTriageResponse` (pure function). `aiTriageBatch` can be tested with mocked ClaudeCodeRunner.
- **Validation:** `pnpm test src/core/filters/ai-triage.test.ts` -- all pass

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 8 -- Orchestrator: RelevanceFilter Class

**Goal:** The main pipeline class that chains Layer 1 -> Layer 2 -> Layer 3 and updates the database.

### Step 8.1 -- Create relevance filter orchestrator
- **File:** `src/core/filters/relevance-filter.ts` (NEW)
- **Action:** Implement the `RelevanceFilter` class:
  - Constructor takes `VaultHandle` and optional `cliPath`
  - `reloadConfig()` method
  - `filterFiles(files: VaultFile[])` method implementing the full pipeline:
    1. For each file: run Layer 1. If process -> accept immediately (layer=1).
    2. If uncertain: run Layer 2. If process -> accept (layer=2). If skip -> reject (layer=2).
    3. Collect uncertain files for Layer 3 batch.
    4. Run Layer 3 in batches of `config.aiTriageBatchSize`.
    5. If AI triage disabled, default uncertain to process.
  - Emits `'file:filtered'` events for skipped files
  - Updates DB via `updateFileFilterResult` for every file
- **Validation:** Class instantiates without error

### Step 8.2 -- Write orchestrator integration tests
- **File:** `src/core/filters/relevance-filter.test.ts` (NEW)
- **Action:** Implement all 5 test cases from PR Section 9.5:
  - Low-relevance files are skipped (not in returned array)
  - Strong filename signals bypass content check (layer=1)
  - Uncertain files go to AI triage when enabled
  - Uncertain files default to process when AI disabled
  - Filter errors are fail-open (files still processed)
- **Note:** These tests require mocking DB functions, content sniffer, and AI triage. Use vi.mock() or dependency injection.
- **Validation:** `pnpm test src/core/filters/relevance-filter.test.ts` -- all pass

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 9 -- Event Bus Extension and main.ts Integration

**Goal:** Wire the RelevanceFilter into the actual application event flow. This is the highest-risk phase because it modifies `main.ts` which is the central coordination point.

### Step 9.1 -- Verify event bus types (already done in Phase 1)
- **File:** `src/shared/types/index.ts`
- **Action:** Confirm `'file:filtered'` is in `AppEvents` (should already be from Phase 1)
- **Validation:** No compilation errors

### Step 9.2 -- Wire RelevanceFilter in main.ts
- **File:** `src/main.ts`
- **Action:**
  1. Import `RelevanceFilter` from `./core/filters/relevance-filter`
  2. Add module-level `let relevanceFilter: RelevanceFilter | null = null`
  3. In `startVault()`: instantiate `relevanceFilter` after creating extraction queue
  4. In `stopVault()`: set `relevanceFilter = null`
  5. Replace direct `file:added` / `file:changed` -> `scheduleExtraction()` wiring with the filter accumulator pattern:
     - `pendingFilterFiles` array
     - `filterTimer` with 2s debounce
     - `scheduleFilter()` function that calls `relevanceFilter.filterFiles()` then `scheduleExtraction()` for accepted files
  6. On filter error: call `scheduleExtraction()` anyway (fail-open)
- **Risk:** This modifies critical event flow. Must verify existing behavior is preserved for non-filter paths.
- **Validation:** App starts, files detected by watcher go through filter, accepted files proceed to extraction

### Step 9.3 -- Update reprocess callbacks
- **File:** `src/main.ts`
- **Action:** In `onReprocessAll`, include skipped files in the reprocess set:
  - Add `const skippedFiles = getFilesByStatus('skipped');`
  - Include in the loop and count
- **Note:** `onReprocessFile` already bypasses filter (sets status to Pending, triggers extraction directly). No change needed.
- **Validation:** Reprocessing a skipped file works correctly

### Step 9.4 -- Update vault init
- **File:** `src/core/vault.ts`
- **Action:** Ensure `initVault()` writes `filter-config.json` (should be done in Phase 3.3, verify here)
- **Validation:** New vault has the config file

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 10 -- UI Updates

**Goal:** Users can see skipped files, filter by skipped status, and reprocess them.

### Step 10.1 -- StatusDot: add Skipped color
- **File:** `src/components/StatusDot.tsx`
- **Action:** Add a gray or light-yellow color mapping for `'skipped'` status
- **Validation:** StatusDot renders without error for all statuses including skipped

### Step 10.2 -- FilterPills: add Skipped option
- **File:** `src/components/FilterPills.tsx`
- **Action:** Add `Skipped` as a selectable status filter pill
- **Validation:** Clicking "Skipped" pill filters the file list to show only skipped files

### Step 10.3 -- ProcessingStatusPanel: show skipped files section
- **File:** `src/components/ProcessingStatusPanel.tsx`
- **Action:** Add a section/tab for skipped files showing:
  - `relative_path`
  - `filter_score` as percentage
  - `filter_reason`
  - `filter_layer` (which layer decided)
  - "Reprocess" button calling `api.reprocessFile(relativePath)`
- **Validation:** Skipped files appear in the panel with all metadata visible

### Step 10.4 -- IPC handler for filter stats
- **File:** `src/main/overlay-window.ts`
- **Action:** Add `ipcMain.handle('get-filter-stats', ...)` handler that queries aggregate stats (total, skipped count, avg score)
- **File:** `src/preload.ts`
- **Action:** Add `getFilterStats` to the preload API
- **File:** `src/shared/types/index.ts` (or relevant API type file)
- **Action:** Add `getFilterStats` to `InvoiceVaultAPI` interface
- **Validation:** Renderer can call `api.getFilterStats()` and receive correct data

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Phase 11 -- Final Validation and Regression Check

**Goal:** Confirm the entire feature works end-to-end and no existing functionality is broken.

### Step 11.1 -- Run full test suite
- **Action:** `pnpm test`
- **Validation:** All tests pass (both new and existing)
- **Expected new test files:**
  - `src/core/filters/config.test.ts`
  - `src/core/filters/keyword-bank.test.ts`
  - `src/core/filters/filename-filter.test.ts`
  - `src/core/filters/content-sniffer.test.ts`
  - `src/core/filters/ai-triage.test.ts`
  - `src/core/filters/relevance-filter.test.ts`

### Step 11.2 -- Manual smoke test
- **Action:** Start the app, open a vault containing a mix of relevant and irrelevant files
- **Validation checklist:**
  - [ ] Irrelevant files (marketing PDFs, photos) get status `Skipped`
  - [ ] Relevant files (invoices, bank statements) proceed to extraction
  - [ ] Skipped files appear in the UI with score, reason, and layer info
  - [ ] "Reprocess" button on a skipped file sends it to extraction
  - [ ] Filter is fail-open: killing the AI triage does not cause files to be silently lost
  - [ ] New vault has `filter-config.json` in `.invoicevault/`
  - [ ] Existing vaults get the new DB columns via migration

### Step 11.3 -- Verify validation criteria from PR Section 14
- **Checklist (from PR):**
  - [ ] `FileStatus.Skipped` added, migration runs without error
  - [ ] `filter_score`, `filter_reason`, `filter_layer` columns exist
  - [ ] `fuse.js` and `pdf-parse` installed
  - [ ] Filter config written on vault init, loaded on vault open
  - [ ] Layer 1 scores correctly on filename/path/size
  - [ ] Layer 2 extracts text from PDF/XLSX/CSV/XML and scores
  - [ ] Layer 3 calls Haiku for uncertain files
  - [ ] Skipped files have correct DB state
  - [ ] All new tests pass
  - [ ] Skipped files visible in ProcessingStatusPanel
  - [ ] Reprocess works for skipped files
  - [ ] Fail-open verified
  - [ ] No regression in existing tests

### Status: Pending
### Execution Notes:
_(Space for feedback during implementation)_

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Migration 009 breaks existing DBs | High | Test on existing vault.db before/after. Migration uses ALTER TABLE ADD COLUMN which is safe for SQLite. |
| pdf-parse fails in Electron packaged build | Medium | pdf-parse is pure JS (uses pdf.js). Test in packaged build during Phase 11. |
| Fuse.js performance on large text samples | Low | Content sniffer limits text extraction (2 PDF pages, 10 spreadsheet rows, 8KB XML). Keyword bank is small (~50 terms). |
| main.ts event flow change breaks existing extraction | High | Phase 9 is highest risk. Verify with manual test that files still reach extraction queue. The debounce pattern matches the existing extraction debounce. |
| AI triage cost accumulation | Low | Haiku is cheap. Batch size limits to 10 files per call. Only uncertain files (score 0.4-0.6) reach Layer 3. |
| Filter incorrectly skips legitimate files | Medium | Fail-open design. Users can reprocess skipped files. Positive matching approach means unknown files lean toward processing. |

---

## Dependency Graph

```
Phase 1 (Types/Constants)
  |
  +-- Phase 2 (DB Migration + Functions)
  |     |
  +-- Phase 3 (Dependencies + Config Loader)
  |     |
  +-- Phase 4 (Keyword Bank)
        |
        +-- Phase 5 (Layer 1: Filename Filter)
        |
        +-- Phase 6 (Layer 2: Content Sniffer)  [depends on Phase 3 for pdf-parse]
        |
        +-- Phase 7 (Layer 3: AI Triage)
              |
              +-- Phase 8 (Orchestrator)  [depends on Phases 2, 5, 6, 7]
                    |
                    +-- Phase 9 (main.ts Integration)  [depends on Phase 8]
                          |
                          +-- Phase 10 (UI)  [depends on Phase 9]
                                |
                                +-- Phase 11 (Validation)
```

Phases 5, 6, and 7 can be executed in parallel after Phase 4 is complete, as they are independent filter layers. Phase 8 (orchestrator) requires all three layers. Phase 9 requires the orchestrator. Phase 10 requires integration. Phase 11 is always last.

---

## File Inventory

### New files (11 total):
```
src/core/filters/config.ts
src/core/filters/config.test.ts
src/core/filters/keyword-bank.ts
src/core/filters/keyword-bank.test.ts
src/core/filters/filename-filter.ts
src/core/filters/filename-filter.test.ts
src/core/filters/content-sniffer.ts
src/core/filters/content-sniffer.test.ts
src/core/filters/ai-triage.ts
src/core/filters/ai-triage.test.ts
src/core/filters/relevance-filter.ts
src/core/filters/relevance-filter.test.ts
```

### Modified files (9 total):
```
package.json                              -- add fuse.js, pdf-parse, @types/pdf-parse
src/shared/types/index.ts                 -- FileStatus.Skipped, filter types, VaultFile fields, AppEvents
src/shared/constants.ts                   -- DEFAULT_FILTER_CONFIG, FILTER_CONFIG_FILE
src/core/db/schema.ts                     -- Migration 009
src/core/db/files.ts                      -- updateFileFilterResult, getSkippedFiles, STATUS_PRIORITY
src/core/vault.ts                         -- write filter-config.json on init
src/main.ts                               -- wire RelevanceFilter, modify event flow, update reprocess
src/components/ProcessingStatusPanel.tsx   -- skipped files section
src/components/FilterPills.tsx            -- add Skipped filter option
src/components/StatusDot.tsx              -- add Skipped color
src/main/overlay-window.ts               -- get-filter-stats IPC handler
src/preload.ts                            -- getFilterStats API
```
