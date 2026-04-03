# Phase 3 — Filter Pills & Breadcrumb Bar

## Goal

Make search filters visual and interactive. Parsed filters become removable pills. Folder scope gets a breadcrumb bar with clickable path segments. Result rows gain clickable paths and doc-type icons for quick filtering.

## Practical Value

After this phase, the user can:
- See active filters as visual pills (type, date, amount, status) and remove them individually
- Click any folder segment on a result row to scope search to that folder
- Click a doc type icon on a result row to filter by that type
- Navigate folder hierarchy via breadcrumb segments (click parent to widen scope)
- Discover filter syntax naturally by seeing how typed filters become pills

This is the "power user unlock" — search goes from text-only to visual + interactive.

## Tasks

### 3.1 Filter Extraction from Search Text

Currently `parseSearchQuery` in `records.ts` runs on the backend only. We need the same parsing on the frontend to:
1. Extract structured filters from the text input
2. Show them as pills
3. Remove the filter text from the input (leaving free text)

**Approach**: Extract `parseSearchQuery` into a shared utility (`src/shared/parse-query.ts`) importable by both main and renderer processes. The backend continues to use it for SQL building; the frontend uses it for pill rendering.

```typescript
// src/shared/parse-query.ts
export interface ParsedQuery {
  text: string;
  docType?: string;
  status?: string;
  folder?: string;
  amountMin?: number;
  amountMax?: number;
  dateFilter?: string;
}

export function parseSearchQuery(raw: string): ParsedQuery { ... }
export function buildQueryString(parsed: ParsedQuery): string { ... } // Reconstruct from structured filters
```

### 3.2 Filter Pills Component (`src/components/FilterPills.tsx`)

New component. Renders active filters as removable capsules.

Props:
- `filters: ParsedQuery` — current parsed filters
- `onRemoveFilter(key: keyof ParsedQuery)` — removes one filter

Each active filter renders a pill:
| Filter | Pill | Icon |
|--------|------|------|
| `docType: 'bank_statement'` | `🏦 Bank Statement ✕` | 🏦 |
| `docType: 'invoice_out'` | `📤 Invoice Out ✕` | 📤 |
| `docType: 'invoice_in'` | `📥 Invoice In ✕` | 📥 |
| `dateFilter: '2024-03'` | `📅 2024-03 ✕` | 📅 |
| `amountMin: 10000000` | `💰 >10,000,000 ✕` | 💰 |
| `amountMax: 50000000` | `💰 <50,000,000 ✕` | 💰 |
| `amountMin + amountMax` | `💰 10tr-50tr ✕` | 💰 |
| `status: 'conflict'` | `⚠️ Conflicts ✕` | ⚠️ |
| `status: 'review'` | `🔍 Review ✕` | 🔍 |

Clicking `✕` calls `onRemoveFilter`, which:
1. Removes that key from `ParsedQuery`
2. Rebuilds the query string from remaining filters
3. Re-runs the search

### 3.3 Breadcrumb Bar Component (`src/components/BreadcrumbBar.tsx`)

New component. Renders folder scope as clickable path segments.

Props:
- `folder: string` — current folder scope (e.g., `"2024/Q1/invoices"`)
- `onNavigate(folder: string)` — set new folder scope (narrower or wider)
- `onOpenFolder()` — open in OS file manager
- `onClear()` — remove folder scope entirely

Rendering: splits `folder` on `/` and renders each segment as a clickable link.
- `📁 2024/ > Q1/ > invoices/` — clicking `2024/` calls `onNavigate("2024")`
- `[📂]` button calls `onOpenFolder()`
- `[✕]` button calls `onClear()`

### 3.4 Clickable Paths in ResultRow (`src/components/ResultRow.tsx`)

Modify the `result-file` div at the bottom of each row:
- Split `relative_path` into folder segments + filename
- Each folder segment is a `<span>` with click handler → calls `onFolderClick(folderPath)`
- The filename segment is plain text (not clickable)
- Clicking a segment stops event propagation (doesn't expand the row)

New props:
- `onFolderClick(folder: string)` — sets folder scope
- `onDocTypeClick(docType: string)` — adds doc type filter pill

### 3.5 Clickable Doc Type Icon in ResultRow

Modify the `result-icon` span:
- Add `cursor: pointer` and click handler
- Clicking calls `onDocTypeClick(result.doc_type)`
- Visual feedback: slight scale on hover

### 3.6 Wire Everything in SearchOverlay / SearchScreen

The search screen now manages:
- `query: string` — raw text input
- `parsedFilters: ParsedQuery` — structured filters extracted from query + pill interactions
- `folderScope: string | null` — folder breadcrumb (separate from pills)

Flow:
1. User types `"ABC type:out 2024-03"` → parser extracts `{ text: "ABC", docType: "invoice_out", dateFilter: "2024-03" }`
2. Input shows `"ABC"`, pills show `📤 Invoice Out ✕` and `📅 2024-03 ✕`
3. User clicks folder segment on a result → `folderScope` is set → breadcrumb appears
4. User removes a pill → filter is cleared → search re-runs
5. User clicks doc type icon → if same type as existing pill, remove it; otherwise add/replace

### 3.7 CSS (`src/index.css`)

Add styles for:
- `.filter-pills` — flex row, wrap, gap: 6px
- `.filter-pill` — capsule: `border-radius: 12px`, `var(--bg-secondary)` background, padding `3px 8px 3px 10px`
- `.filter-pill-close` — small × button
- `.breadcrumb-bar` — light background bar below search input
- `.breadcrumb-segment` — clickable link, accent color on hover
- `.breadcrumb-separator` — `>` between segments, muted color
- `.result-file-segment` — clickable folder segment with underline on hover
- `.result-icon-clickable` — pointer cursor, scale on hover

## Files Changed

| File | Change |
|------|--------|
| `src/shared/parse-query.ts` | **New file** — extracted from `records.ts` |
| `src/core/db/records.ts` | Import `parseSearchQuery` from shared module (remove local copy) |
| `src/components/FilterPills.tsx` | **New file** |
| `src/components/BreadcrumbBar.tsx` | **New file** |
| `src/components/ResultRow.tsx` | Add clickable path segments + clickable doc type icon |
| `src/components/ResultList.tsx` | Pass new callbacks through |
| `src/components/SearchOverlay.tsx` | Integrate pills + breadcrumb into Search state |
| `src/index.css` | Pills, breadcrumb, clickable path styles |

## Tests

### Unit Tests

- **`src/shared/__tests__/parse-query.test.ts`** — test `parseSearchQuery` with various inputs: `"ABC type:out"`, `"in:2024/Q1 >5000000"`, `"2024-03 status:conflict"`, edge cases (empty, only filters, only text). Test `buildQueryString` round-trip.
- **`src/components/__tests__/FilterPills.test.tsx`** — render with various filter combos, verify correct pill labels, verify remove callback fires with correct key.
- **`src/components/__tests__/BreadcrumbBar.test.tsx`** — render with `"2024/Q1/invoices"`, verify 3 segments rendered, click segment fires `onNavigate` with correct path, clear button fires `onClear`.
- **`src/components/__tests__/ResultRow.test.tsx`** — render a result with `relative_path: "2024/Q1/scan.pdf"`, verify clicking `"2024/"` segment fires `onFolderClick("2024")`, clicking `"Q1/"` fires `onFolderClick("2024/Q1")`. Verify doc type icon click fires `onDocTypeClick`.

### Integration Test

- **`src/__tests__/filter-flow.test.ts`** — type `"ABC type:out 2024-03"` → verify `parseSearchQuery` extracts correctly → verify `buildQueryString` with `docType` removed produces `"ABC 2024-03"` → verify `parseSearchQuery` on that produces `{ text: "ABC", dateFilter: "2024-03" }`.

## Acceptance Criteria

- [ ] Typing `type:out` in search shows a `📤 Invoice Out` pill and removes the text from the input
- [ ] Typing `2024-03` shows a `📅 2024-03` pill
- [ ] Typing `>5000000` shows a `💰 >5,000,000` pill
- [ ] Removing a pill re-runs the search without that filter
- [ ] Clicking a folder segment on a result row sets the folder scope and shows the breadcrumb bar
- [ ] Breadcrumb shows clickable path segments; clicking a parent widens scope
- [ ] Breadcrumb [📂] opens folder in OS file manager
- [ ] Breadcrumb [✕] clears folder scope
- [ ] Clicking the doc type icon on a result row adds a doc type filter pill
- [ ] Clicking the same doc type icon again removes the filter
- [ ] `parseSearchQuery` is shared between frontend and backend (no duplication)
- [ ] All unit and integration tests pass
