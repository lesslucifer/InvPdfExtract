# Phase 4 — Aggregation Footer, Filtered Export & Escape Cascade

## Goal

Add the sticky footer with live aggregate stats (record count + total amount), contextual CSV export, and the full Escape cascade behavior. This completes all search/browse features.

## Practical Value

After this phase, the user can:
- See at a glance how many records and what total amount matches their current filters
- Export only the filtered results to CSV (folder-scoped, type-filtered, etc.)
- Use Escape naturally to progressively undo: collapse detail → clear text → remove pill → clear folder → hide overlay
- Use `Cmd+E` / `Ctrl+E` shortcut to quickly export current view

This is the "daily workflow" phase — everything a user needs to search, browse, and export is complete.

## Tasks

### 4.1 Aggregation Query (`src/core/db/records.ts`)

Add:

```typescript
export function getAggregates(filters: SearchFilters): AggregateStats {
  // Build same WHERE clause as searchRecords
  // SELECT COUNT(*) AS totalRecords, SUM(COALESCE(id2.tong_tien, bsd.so_tien, 0)) AS totalAmount
  // FROM records r JOIN files f ... LEFT JOIN invoice_data id2 ... LEFT JOIN bank_statement_data bsd ...
  // WHERE <same conditions>
}
```

This reuses the WHERE-clause building logic from `searchRecords`. Refactor: extract a shared `buildFilterConditions(parsed: ParsedQuery): { sql: string, params: any[] }` helper used by both `searchRecords` and `getAggregates`.

### 4.2 Filtered Export (`src/core/export.ts`)

Modify `gatherExportData` to accept `SearchFilters`:

```typescript
export function gatherExportData(options: ExportOptions & { filters?: SearchFilters } = {}): ExportData {
  // If filters provided, add WHERE conditions to each query
  // Reuse buildFilterConditions from records.ts
}
```

Export flow:
1. IPC handler receives `SearchFilters` + destination path
2. Calls `gatherExportData({ filters })` → `exportToCsv(data)`
3. Writes CSV files with BOM to destination
4. Returns `{ filesWritten: ['bank_statements.csv', 'invoices.csv', 'line_items.csv'] }`

### 4.3 IPC Handlers (`src/main/overlay-window.ts`)

Wire up:
- `get-aggregates` → `getAggregates(filters)` — runs in parallel with search
- `export-filtered` → `gatherExportData({ filters })` → `exportToCsv()` → write files → return paths

### 4.4 Preload (`src/preload.ts`)

Add `getAggregates` and `exportFiltered` to the bridge.

### 4.5 Sticky Footer Component (`src/components/AggregateFooter.tsx`)

New component. Renders:

```
  24 records | ₫128,500,000 total | [Export CSV ↓]
```

Props:
- `stats: AggregateStats | null` — null while loading
- `onExport()` — triggers export flow
- `isExporting: boolean` — shows spinner/disabled state during export

Behavior:
- Shows placeholder while loading (e.g., `"—"`)
- Amount formatted with `Intl.NumberFormat('vi-VN')` and `₫` prefix
- Export button is disabled when `isExporting` or when `stats.totalRecords === 0`

### 4.6 Export Toast

After successful export, show an inline toast in the footer for ~5 seconds:

```
  Exported 24 records to ~/Desktop/export/  [📂 Open]
```

Clicking `[📂 Open]` calls `shell.openPath(destPath)`.

Implementation: the footer component manages a `toastMessage` state with a `setTimeout` to clear it.

### 4.7 Wire Aggregates into SearchScreen

After each search/filter change:
1. Run `window.api.search(query)` (existing)
2. Run `window.api.getAggregates(filters)` in parallel
3. Update both results and footer stats

The `SearchFilters` object is built from `parsedFilters` + `folderScope`:
```typescript
const filters: SearchFilters = {
  text: parsed.text,
  folder: folderScope ?? parsed.folder,
  docType: parsed.docType,
  status: parsed.status,
  amountMin: parsed.amountMin,
  amountMax: parsed.amountMax,
  dateFilter: parsed.dateFilter,
};
```

### 4.8 Export Flow in SearchScreen

When user clicks `[Export CSV ↓]`:
1. Call `window.api.pickFolder()` → get destination path
2. If cancelled, do nothing
3. Call `window.api.exportFiltered(currentFilters, destPath)`
4. On success, show toast with file count and `[📂 Open]` link

`Cmd+E` / `Ctrl+E` shortcut triggers the same flow.

### 4.9 Escape Cascade

Rewrite the `Escape` handler in `SearchScreen` with priority cascade:

```typescript
function handleEscape() {
  // 1. Collapse expanded detail
  if (expandedId) { setExpandedId(null); return; }
  // 2. Clear search text
  if (query.trim()) { setQuery(''); doSearch(''); return; }
  // 3. Remove most recent filter pill
  if (hasActivePills(parsedFilters)) { removeLastPill(); return; }
  // 4. Clear folder scope
  if (folderScope) { setFolderScope(null); return; }
  // 5. If in search state with nothing to undo, go to Home
  // 6. If in Home, hide overlay (handled by blur on window level)
}
```

Note: step 6 is tricky because hiding the window is done by `window.blur()` which triggers the `blur` event in the main process. The renderer can send an IPC message `hide-overlay` or just not prevent the default blur behavior.

### 4.10 CSS (`src/index.css`)

Add styles for:
- `.aggregate-footer` — sticky bottom bar, border-top, flex row
- `.aggregate-stat` — muted text, tabular-nums
- `.aggregate-separator` — vertical bar `|`
- `.export-btn` — accent-colored button, small
- `.export-toast` — inline notification with slide-in animation
- `.export-toast-open` — [📂 Open] link

## Files Changed

| File | Change |
|------|--------|
| `src/core/db/records.ts` | Add `getAggregates()`, extract `buildFilterConditions()` helper |
| `src/core/export.ts` | Add `SearchFilters` support to `gatherExportData()` |
| `src/main/overlay-window.ts` | Add `get-aggregates`, `export-filtered` IPC handlers |
| `src/preload.ts` | Add `getAggregates`, `exportFiltered` |
| `src/components/AggregateFooter.tsx` | **New file** |
| `src/components/SearchOverlay.tsx` | Wire aggregates, export flow, Escape cascade |
| `src/index.css` | Footer, toast styles |

## Tests

### Unit Tests

- **`src/core/db/__tests__/records-aggregates.test.ts`** — seed DB with known records → call `getAggregates({})` → verify total count and sum. Test with folder filter, docType filter, amount range, date filter. Verify deleted records are excluded.
- **`src/core/export/__tests__/export-filtered.test.ts`** — seed DB → call `gatherExportData({ filters: { folder: '2024/Q1' } })` → verify only records in that folder are included. Test with doc type filter, combined filters.
- **`src/components/__tests__/AggregateFooter.test.tsx`** — render with stats, verify count and amount display. Verify export button calls handler. Verify disabled when exporting. Verify toast appears and auto-hides.

### Integration Tests

- **`src/__tests__/escape-cascade.test.ts`** — simulate the full Escape cascade sequence: set search text + folder + expanded row → first Escape collapses → second clears text → third clears folder → fourth would hide. Verify state at each step.
- **`src/__tests__/export-flow.test.ts`** — mock IPC → set filters → call export → verify `gatherExportData` receives correct filters → verify CSV output → verify toast message.

## Acceptance Criteria

- [ ] Sticky footer visible whenever results exist
- [ ] Footer shows record count and total amount formatted in VND
- [ ] Aggregate stats update within 100ms of filter change
- [ ] `[Export CSV ↓]` button opens folder picker, then exports filtered records
- [ ] Export only includes records matching current filters (folder, type, date, amount, status)
- [ ] After export, toast shows "Exported N records to path" with `[📂 Open]` link
- [ ] Toast auto-hides after 5 seconds
- [ ] `Cmd+E` / `Ctrl+E` triggers export
- [ ] Escape cascade works in correct priority order (detail → text → pill → folder → hide)
- [ ] Footer shows `0 records` and disabled export when no results match
- [ ] All unit and integration tests pass
