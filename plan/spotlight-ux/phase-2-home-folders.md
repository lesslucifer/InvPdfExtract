# Phase 2 — Home Screen & Folder Browsing

## Goal

Build the Home screen (State 2) with recent folders and top-level folder tree. Enable "browse mode" — clicking a folder shows all its records without requiring a text search.

## Practical Value

After this phase, the user can:
- See an at-a-glance view of their vault: recent folders with record counts
- Click any folder to browse its contents (all records, no search text needed)
- Open any folder in Finder/Explorer directly from the overlay
- Navigate back to Home by clearing the folder scope

This is the first "aha moment" — the overlay feels like a real file browser, not just a search box.

## Tasks

### 2.1 Folder Query Functions (`src/core/db/records.ts`)

Add two new exported functions:

```typescript
export function listRecentFolders(limit: number = 5): FolderInfo[] {
  // SQL from PRD Section 4.5 — GROUP BY top-level/two-level folder,
  // ORDER BY MAX(files.updated_at) DESC
}

export function listTopFolders(): FolderInfo[] {
  // Group by first path segment only
  // ORDER BY record_count DESC
}
```

Both use the same base query pattern: `JOIN records r ON r.file_id = f.id` with `GROUP BY folder`.

Fallback logic: if `listRecentFolders` returns fewer than 3 results, the Home screen supplements with `listTopFolders`.

### 2.2 IPC Handlers (`src/main/overlay-window.ts`)

Wire up:
- `list-recent-folders` → `listRecentFolders(limit)`
- `list-top-folders` → `listTopFolders()`

### 2.3 Preload (`src/preload.ts`)

Add `listRecentFolders` and `listTopFolders` to the bridge.

### 2.4 Home Screen Component (`src/components/HomeScreen.tsx`)

New component. Layout per PRD Section 4:

```
Recent folders
📁 2024/Q1/invoices/        38 rec   [→] [📂]
📁 2024/Q1/bank/            12 rec   [→] [📂]

All folders                              [📂]
📁 2024/                 142 records
📁 2025/                  38 records
```

Props:
- `onFolderBrowse(folder: string)` — sets folder scope, transitions to Search state
- `onOpenFolder(relativePath: string)` — opens in OS file manager
- `onSettingsClick()` — navigates to Settings
- `onSearchStart(query: string)` — when user starts typing

Behavior:
- Fetches `listRecentFolders(5)` and `listTopFolders()` on mount
- If fewer than 3 recent folders, merges top folders into the display
- `[→]` browse button calls `onFolderBrowse(folder.path)`
- `[📂]` calls `onOpenFolder(folder.path)`
- `[📂]` on "All folders" header calls `onOpenFolder('')` (vault root)

### 2.5 Browse Mode in SearchOverlay (`src/components/SearchOverlay.tsx`)

Update state machine:
- Add `folderScope: string | null` to state
- When `onFolderBrowse` is called from Home: set `folderScope`, switch to `Search` state
- In Search state with `folderScope` set and no text: run search with `in:folderScope` filter to list all records in that folder
- Clearing folder scope (and no text) returns to Home

### 2.6 Modify `searchRecords` for Browse Mode (`src/core/db/records.ts`)

Current `searchRecords` requires text or returns empty. Modify:
- If `parsed.text` is empty but other filters exist (folder, docType, etc.), skip the FTS condition and return all matching records.
- This enables browse mode: `searchRecords('in:2024/Q1')` returns all records in that folder.

### 2.7 CSS (`src/index.css`)

Add styles for:
- `.home-screen` — padded container
- `.home-section-title` — "Recent folders" / "All folders" headers
- `.folder-row` — hover-able row with icon, path, count, action buttons
- `.folder-row-actions` — right-aligned button group
- `.folder-browse-btn`, `.folder-open-btn` — small icon buttons

## Files Changed

| File | Change |
|------|--------|
| `src/core/db/records.ts` | Add `listRecentFolders()`, `listTopFolders()`; modify `searchRecords` for empty-text queries |
| `src/main/overlay-window.ts` | Add `list-recent-folders`, `list-top-folders` IPC handlers |
| `src/preload.ts` | Add `listRecentFolders`, `listTopFolders` |
| `src/shared/types/index.ts` | Already done in Phase 1 (`FolderInfo`) |
| `src/components/HomeScreen.tsx` | **New file** |
| `src/components/SearchOverlay.tsx` | Add `folderScope` state, wire Home → Search transition |
| `src/index.css` | Home screen styles |

## Tests

### Unit Tests

- **`src/core/db/__tests__/records-folders.test.ts`** — test `listRecentFolders` and `listTopFolders` with a seeded SQLite DB: insert files across folders, verify correct grouping, ordering by `updated_at`, record counts. Test fallback when < 3 recent folders.
- **`src/core/db/__tests__/records-browse.test.ts`** — test `searchRecords` with folder-only filter (no text): verify it returns all records in that folder, ordered correctly, with correct joins.
- **`src/components/__tests__/HomeScreen.test.tsx`** — mock API, verify recent folders render, click [→] calls `onFolderBrowse`, click [📂] calls `onOpenFolder`, fallback to top folders when few recent.

### Integration Test

- **`src/__tests__/home-to-browse.test.ts`** — seed DB with records in multiple folders → call `listRecentFolders()` → verify top folder appears → call `searchRecords('in:top-folder')` → verify returns records for that folder only.

## Acceptance Criteria

- [ ] Home screen shows on overlay open when search is empty
- [ ] Recent folders section shows up to 5 folders, ordered by most recent activity
- [ ] Each folder row displays record count
- [ ] Clicking [→] on a folder transitions to Search state showing all records in that folder
- [ ] Clicking [📂] opens the folder in the OS file manager
- [ ] "All folders" section shows top-level directories with record counts
- [ ] Clicking [📂] on "All folders" header opens the vault root
- [ ] Browse mode works: folder-only search (no text) returns all records
- [ ] Clearing folder scope (with no text) returns to Home screen
- [ ] Fallback: new vault with < 3 active folders still shows a useful home screen
- [ ] All unit and integration tests pass
