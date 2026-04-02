# Phase 4 — Search Overlay UI

> **Goal:** A Spotlight-style floating search panel that queries the SQLite database and displays extracted records.
> **Output:** Press `Cmd+Shift+I` → overlay appears → type a query → see matching invoice/bank records with key fields.

---

## Tasks

### 4.1 Overlay window setup
- Frameless `BrowserWindow` with:
  - `transparent: true`, `alwaysOnTop: true`, `frame: false`
  - Centered on screen, fixed width (~700px), dynamic height
  - Show/hide on global hotkey (`Cmd+Shift+I` / `Ctrl+Shift+I`)
  - Dismiss on `Escape` or click-outside (blur event)
- Register global shortcut via `globalShortcut.register()`

### 4.2 React overlay component
- Stack: React + CSS (no heavy UI framework)
- Components:
  - `SearchOverlay` — root container
  - `SearchInput` — auto-focused text input with clear button
  - `ResultList` — scrollable list of matched records
  - `ResultRow` — single record display showing:
    - Doc type icon (bank/invoice-out/invoice-in)
    - Key fields: số hóa đơn or bank name, counterparty, amount, date
    - Source file path (relative)
    - Confidence indicator (color-coded)
  - `ResultDetail` — expanded view on click (read-only for now, edit in Phase 6)

### 4.3 IPC bridge for search
- Preload script exposes: `window.api.search(query: string): Promise<SearchResult[]>`
- Main process handler:
  - Parse query string for simple text matching
  - Query SQLite using FTS5 (`records_fts MATCH ?`)
  - Join with extension tables for full field data
  - Return results sorted by relevance (FTS5 rank)

### 4.4 Basic search implementation
- MVP search: free text across all FTS5-indexed fields
- Query pipeline:
  1. User types in search box (debounced 200ms)
  2. IPC call to main process
  3. FTS5 query against `records_fts`
  4. Join `records` → `bank_statement_data` / `invoice_data`
  5. Return top 50 results
- No structured filters yet (type:, status:, amount ranges — deferred to Phase 6)

### 4.5 Result actions
- Click record → expand inline to show all fields
- `Enter` on a file reference → `shell.openPath()` to open source file
- `Cmd+C` / `Ctrl+C` on a record → copy key fields to clipboard

### 4.6 Overlay styling
- Dark/light mode following OS preference (`nativeTheme`)
- Smooth show/hide animation (fade + slide)
- Keyboard navigation: arrow keys to move between results, Enter to expand/open

---

## Acceptance Criteria
- [ ] `Cmd+Shift+I` toggles the search overlay on/off
- [ ] Overlay is frameless, centered, and floats above all windows
- [ ] Typing a query returns matching records within 200ms
- [ ] Results display doc type, key fields, file path, and confidence
- [ ] Clicking a result expands it to show all fields
- [ ] `Escape` or click-outside dismisses the overlay
- [ ] Keyboard navigation works (arrows + Enter)
- [ ] FTS5 searches across invoice numbers, MST, counterparty names, descriptions
