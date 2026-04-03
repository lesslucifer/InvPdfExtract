# Phase 8 — Overlay-Centric UX Redesign: PRD

> **Version:** 1.0
> **Date:** April 3, 2026
> **Status:** Draft
> **Author:** Vu + Claude

---

## 1. Motivation

The current InvoiceVault UX relies on three separate interaction surfaces:

1. **System tray icon + context menu** — vault init, export, settings, reprocess
2. **Search overlay** — search, inline editing, conflict resolution
3. **OS context menu** (planned, never built) — Finder/Explorer right-click integration

This creates problems:

- **The OS context menu is impractical.** macOS Finder Extensions require a signed native Swift bundle (Apple Developer certificate), and Windows Shell Extensions require C++/Rust COM registration. Both are complex to build, fragile across OS versions, and impossible to test on the opposite platform during development.
- **The tray menu is disconnected from search.** Export, vault switching, and settings live in the tray, but the user's mental context (which folder? which records?) is in the overlay. Exporting "the records I'm looking at" requires leaving the overlay, going to the tray, and exporting everything.
- **Folder scoping is hidden.** The search parser supports `in:subfolder` syntax, but users have no way to discover this. There's no visual affordance for narrowing search to a subfolder.

### Decision

**Remove the tray icon/menu entirely. Make the search overlay the single UI surface for all interactions.** The app becomes: hotkey opens overlay, overlay does everything.

This eliminates the OS context menu requirement, unifies all features in one place, and makes folder-scoped search/export discoverable.

---

## 2. Design Overview

The overlay operates in four states:

| State | When | What's shown |
|---|---|---|
| **No Vault** | First launch, no vault configured | Setup screen with folder picker |
| **Home** | Overlay opens, search is empty | Recent folders, top-level folder tree, gear icon |
| **Search / Browse** | User types a query or clicks a folder | Filter pills, results, sticky footer with aggregates + export |
| **Settings** | User clicks gear icon | Vault management, preferences, quit |

All states live in the same overlay window. No tray icon, no tray menu, no secondary windows.

---

## 3. State 1: No Vault (First Launch)

### Trigger
App starts with no vault configured (`AppConfig.lastVaultPath` is null and `AppConfig.vaultPaths` is empty).

### Layout

```
┌──────────────────────────────────────────────────┐
│                                                  │
│              📄 InvoiceVault                     │
│                                                  │
│     Select a folder to get started.              │
│     It will be initialized as a vault            │
│     and watched for invoices & bank statements.  │
│                                                  │
│           [ 📁 Choose Folder... ]                │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Behavior
- `Choose Folder...` opens `dialog.showOpenDialog({ properties: ['openDirectory'] })`.
- On folder selection:
  - If `.invoicevault/` already exists → open as existing vault.
  - If not → run vault init (create `.invoicevault/`, `config.json`, `vault.db`), start watcher.
- After init, transition to **State 2 (Home)**.
- The hotkey (`Cmd+Shift+I` / `Ctrl+Shift+I`) still works to show/hide the overlay in this state.

### Edge Cases
- User cancels the folder dialog → stay on this screen.
- Selected folder is not writable → show inline error: "Cannot write to this folder. Choose another."
- Selected folder is inside an existing vault → show inline error: "This folder is already inside vault X."

---

## 4. State 2: Home (Empty Search)

### Trigger
Overlay opens (via hotkey) and search input is empty.

### Layout

```
┌──────────────────────────────────────────────────┐
│ 🔍 [                                    ]  [⚙]  │
│ ─────────────────────────────────────────────── │
│                                                  │
│  Recent folders                                  │
│  📁 2024/Q1/invoices/        38 rec   [→] [📂]  │
│  📁 2024/Q1/bank/            12 rec   [→] [📂]  │
│  📁 2025/Q1/                  5 rec   [→] [📂]  │
│                                                  │
│  All folders                              [📂]   │
│  📁 2024/                 142 records            │
│  📁 2025/                  38 records            │
│  📁 templates/              0 records            │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Components

#### 4.1 Search Input
- Auto-focused on overlay show.
- Placeholder: `"Search invoices, bank statements, MST..."`
- Clear button (×) appears when non-empty.
- Typing transitions to **State 3 (Search/Browse)**.

#### 4.2 Gear Icon [⚙]
- Top-right of the search bar.
- Click → transitions to **State 4 (Settings)**.

#### 4.3 Recent Folders Section
- Shows the 3-5 most recently active folders, based on `MAX(files.updated_at)` grouped by the first 1-2 path segments of `files.relative_path`.
- "Recently active" = folders containing files that were most recently added, modified, or re-extracted.
- Each row shows:
  - Folder icon + path (relative to vault root)
  - Record count (`COUNT(*) FROM records r JOIN files f ... WHERE f.relative_path LIKE 'folder/%' AND r.deleted_at IS NULL`)
  - `[→]` Browse button — clicks sets folder scope, transitions to State 3 with no search text (browse mode)
  - `[📂]` Open in Finder/Explorer button — calls `shell.openPath(path.join(vaultPath, folderPath))`
- **Fallback:** If fewer than 3 recent folders exist (new vault), show top-level folders instead, sorted by record count descending.

#### 4.4 All Folders Section
- Shows the top-level directories in the vault (1 level deep).
- Each row: folder name + total record count.
- Clicking a folder → sets folder scope, transitions to State 3.
- `[📂]` on the "All folders" header → opens vault root in OS file manager.

#### 4.5 Query: Recent Folders

```sql
SELECT
  -- Extract the top-level or two-level folder from relative_path
  CASE
    WHEN INSTR(SUBSTR(relative_path, INSTR(relative_path, '/') + 1), '/') > 0
    THEN SUBSTR(relative_path, 1,
         INSTR(relative_path, '/') +
         INSTR(SUBSTR(relative_path, INSTR(relative_path, '/') + 1), '/') - 1)
    ELSE SUBSTR(relative_path, 1, INSTR(relative_path, '/') - 1)
  END AS folder,
  COUNT(DISTINCT r.id) AS record_count,
  MAX(f.updated_at) AS last_active
FROM files f
JOIN records r ON r.file_id = f.id AND r.deleted_at IS NULL
WHERE f.deleted_at IS NULL
GROUP BY folder
ORDER BY last_active DESC
LIMIT 5;
```

Performance: single indexed query, negligible cost.

---

## 5. State 3: Search / Browse (Active Query or Folder Scope)

### Trigger
- User types in the search input, OR
- User clicks a folder from the Home screen, OR
- User clicks a folder path segment on a result row.

### Layout

```
┌──────────────────────────────────────────────────┐
│ 🔍 [nha cung cap ABC                    ]  [⚙]  │
│  📁 2024/ > Q1/ > invoices/     [📂] [✕]        │
│  📤 Invoice Out ✕  │  📅 2024-03 ✕              │
│ ─────────────────────────────────────────────── │
│  📤 Inv #001  MST:123456  ABC Corp    1,200,000  │
│     2024/Q1/invoices/scan001.pdf                 │
│  📤 Inv #002  MST:789012  ABC Corp      800,000  │
│     2024/Q1/invoices/scan002.pdf                 │
│  📥 Inv #003  MST:345678  XYZ Ltd     3,500,000  │
│     2024/Q1/invoices/ncc-xyz.pdf                 │
│ ─────────────────────────────────────────────── │
│  24 records │ ₫128,500,000 total │ [Export CSV ↓] │
└──────────────────────────────────────────────────┘
```

### 5.1 Folder Breadcrumb Bar

Appears when a folder scope is active. Shows below the search input.

- **Breadcrumb segments** are each clickable. Clicking a parent segment (e.g., `2024/`) widens the scope to that level.
- **`[📂]`** — Opens the scoped folder in Finder/Explorer (`shell.openPath`).
- **`[✕]`** — Clears folder scope, returns to full vault search. If search text is also empty, returns to Home (State 2).

Folder scope can be set by:
1. Clicking a folder on the Home screen.
2. Clicking a folder path segment on a result row (see 5.3).
3. Typing `in:subfolder` in the search input (existing syntax — the pill auto-appears).

### 5.2 Filter Pills

Active filters are shown as removable pills below the breadcrumb bar. Each pill has a `✕` to remove it.

| Filter | Pill appearance | Source |
|---|---|---|
| Doc type | `📤 Invoice Out ✕` | Click doc type icon on a result row, OR type `type:out` |
| Date | `📅 2024-03 ✕` | Type `2024-03` in search |
| Amount range | `💰 >10,000,000 ✕` | Type `>10000000` in search |
| Status | `⚠️ Conflicts ✕` | Type `status:conflict` in search |

**Interaction between pills and search text:**
- When a filter is parsed from the search text (e.g., `type:out`), it is removed from the text input and shown as a pill instead. The remaining free text stays in the input.
- Removing a pill re-runs the search without that filter.
- Folder scope is shown in the breadcrumb bar (not as a pill) because it's hierarchical.

### 5.3 Result Rows (Enhanced)

Each result row shows the same data as today, plus:

- **Clickable folder path segments.** The `relative_path` display (e.g., `2024/Q1/invoices/scan001.pdf`) has each folder segment as a clickable link. Clicking `Q1/` sets folder scope to `2024/Q1/`.
- **Clickable doc type icon.** Clicking the `📤`/`📥`/`🏦` icon adds a doc type filter pill (or removes it if already active).

Result expansion (inline detail, editing, conflict resolution) works exactly as today — no changes.

### 5.4 Sticky Footer

Always visible when results exist. Sticks to the bottom of the overlay.

```
  24 records │ ₫128,500,000 total │ [Export CSV ↓]
```

#### Content
- **Record count**: total records matching the current filters (not just the displayed page).
- **Total amount**: `SUM(COALESCE(invoice_data.tong_tien, bank_statement_data.so_tien, 0))` for all matching records.
- **Export CSV button**: exports all records matching the current filters to CSV files.

#### Aggregation Query

Run in parallel with the search query, using the same WHERE clause:

```sql
SELECT
  COUNT(*) AS total_records,
  SUM(COALESCE(id2.tong_tien, bsd.so_tien, 0)) AS total_amount
FROM records r
JOIN files f ON r.file_id = f.id
LEFT JOIN invoice_data id2 ON r.id = id2.record_id
LEFT JOIN bank_statement_data bsd ON r.id = bsd.record_id
WHERE r.deleted_at IS NULL
  AND <same filter conditions as search>
```

Performance: SQLite aggregation on indexed columns. Sub-millisecond for typical vault sizes (< 100K records).

### 5.5 Export CSV (Filtered)

When the user clicks `[Export CSV ↓]`:

1. Show `dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })` to pick a destination folder.
2. Generate CSV files using the **current filter state** (folder scope + search text + type/date/amount/status filters).
3. Write the same 3 CSV files as the existing export (`bank_statements.csv`, `invoices.csv`, `line_items.csv`) — but only including records that match the current filters.
4. After export, show a small inline toast in the footer: "Exported 24 records to ~/Desktop/export/" with a `[📂 Open]` link.

This replaces the tray-based "Export to CSV..." menu item. The key difference: **export is always contextual to what you're looking at.**

### 5.6 Browse Mode (Folder Scope, No Search Text)

When user clicks a folder from Home without typing a search query, the overlay enters browse mode:

- Folder breadcrumb is active.
- All records in that folder are shown (up to the limit, ordered by `updated_at DESC`).
- The footer shows the total count + amount for the folder.
- The user can further narrow by typing a search query.

This replaces the "right-click folder in Explorer → Search InvoiceVault" workflow. Same result, no OS integration needed.

---

## 6. State 4: Settings Panel

### Trigger
User clicks the `[⚙]` gear icon.

### Layout

```
┌──────────────────────────────────────────────────┐
│ 🔍 [                                    ] [⚙ ←] │
│ ─────────────────────────────────────────────── │
│                                                  │
│  Current Vault                                   │
│  📁 ~/Documents/KeToan2024             [📂] [✕]  │
│                                                  │
│  Other Vaults                                    │
│  📁 ~/Documents/KeToan2025             [Switch]  │
│                                                  │
│  [ + Add Vault ]                                 │
│                                                  │
│ ─────────────────────────────────────────────── │
│  [ Reprocess All Files ]                         │
│  Claude CLI: ✅ Found (v1.2.3)                   │
│                                                  │
│ ─────────────────────────────────────────────── │
│  [ Quit InvoiceVault ]                           │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Components

#### 6.1 Current Vault
- Shows the active vault path.
- `[📂]` opens vault root in OS file manager.
- `[✕]` disconnects vault (stops watching, clears `lastVaultPath`). If no other vaults exist, returns to State 1.

#### 6.2 Other Vaults
- Lists all vaults in `AppConfig.vaultPaths` except the current one.
- `[Switch]` makes that vault active (sets `lastVaultPath`, restarts watcher, reloads DB).

#### 6.3 Add Vault
- Opens folder picker dialog.
- Same logic as State 1: creates `.invoicevault/` if needed, adds to `vaultPaths`.

#### 6.4 Reprocess All Files
- Resets all files to `pending` status and re-queues them for extraction.
- Shows confirmation: "This will re-extract all N files. Continue?"

#### 6.5 Claude CLI Status
- Shows whether the CLI is found and its version.
- If not found: shows "❌ Not found" with a hint: "Install Claude Code CLI and ensure it's in your PATH."

#### 6.6 Quit
- `app.quit()`. Clean shutdown: stop watcher, close DB, deregister hotkey.

#### 6.7 Back Navigation
- The `[⚙ ←]` icon toggles back to the previous state (Home or Search).
- `Escape` also returns to the previous state.

---

## 7. What Gets Removed

| Current Feature | Replacement |
|---|---|
| System tray icon | Removed entirely |
| Tray context menu | Settings panel (State 4) in overlay |
| Tray "Search Overlay" item | Hotkey is the only trigger (already the primary method) |
| Tray "Export to CSV..." | Footer export button in State 3 |
| Tray "Initialize New Vault..." | State 1 setup screen |
| Tray "Open Vault Folder" | `[📂]` buttons throughout overlay |
| Tray "Process Now" | "Reprocess All Files" in Settings |
| Tray icon status colors | Notifications remain (desktop OS notifications). Consider adding a small status indicator in the overlay header (future). |
| Planned Finder/Explorer context menus | Folder pill + clickable paths in overlay |

### Files to Modify/Remove

| File | Action |
|---|---|
| `src/main/tray.ts` | **Delete** (or gut to minimal process-keeping stub) |
| `src/main/overlay-window.ts` | Major changes: new IPC handlers, settings, vault init |
| `src/main.ts` | Remove tray initialization, keep overlay + watcher |
| `src/components/SearchOverlay.tsx` | Rewrite: state machine (no-vault / home / search / settings) |
| `src/components/SearchInput.tsx` | Minor: add gear icon |
| `src/components/ResultRow.tsx` | Add clickable path segments + clickable doc type icon |
| `src/components/ResultList.tsx` | Minor: pass new callbacks |
| `src/components/ResultDetail.tsx` | No changes |
| `src/core/export.ts` | Add folder/filter parameter to `gatherExportData()` |
| `src/shared/types/index.ts` | New types: `FolderInfo`, `AggregateStats`, updated `InvoiceVaultAPI` |
| `src/preload.ts` | New API methods: `listFolders`, `getAggregates`, `exportFiltered`, `initVault`, `switchVault` |
| `src/index.css` | New styles for breadcrumb, pills, footer, settings, home state |

---

## 8. New IPC API Surface

### New Handlers (main process)

| Channel | Params | Returns | Purpose |
|---|---|---|---|
| `list-recent-folders` | `limit?: number` | `FolderInfo[]` | Recent folders for Home screen |
| `list-top-folders` | — | `FolderInfo[]` | Top-level vault folders |
| `get-aggregates` | `filters: SearchFilters` | `{ count: number, totalAmount: number }` | Footer stats |
| `export-filtered` | `filters: SearchFilters, destPath: string` | `{ filesWritten: string[] }` | Filtered CSV export |
| `init-vault` | `folderPath: string` | `{ success: boolean, error?: string }` | Vault initialization |
| `switch-vault` | `vaultPath: string` | `{ success: boolean }` | Switch active vault |
| `remove-vault` | `vaultPath: string` | `void` | Disconnect a vault |
| `get-app-config` | — | `AppConfig` | Settings panel data |
| `open-folder` | `relativePath: string` | `void` | Open folder in OS file manager |
| `pick-folder` | — | `string \| null` | Show native folder picker dialog |

### New Types

```typescript
interface FolderInfo {
  path: string;           // relative path from vault root (e.g., "2024/Q1")
  recordCount: number;
  lastActive: string;     // ISO datetime
}

interface SearchFilters {
  text?: string;
  folder?: string;
  docType?: string;
  status?: string;
  amountMin?: number;
  amountMax?: number;
  dateFilter?: string;
}

interface AggregateStats {
  totalRecords: number;
  totalAmount: number;
}
```

---

## 9. Keyboard Shortcuts

| Key | Context | Action |
|---|---|---|
| `Cmd+Shift+I` / `Ctrl+Shift+I` | Global | Toggle overlay |
| `Escape` | Overlay visible | If in settings → back to previous. If search has text → clear. If folder scoped → clear scope. If clean → hide overlay. |
| `Arrow Up/Down` | Results visible | Navigate results |
| `Enter` | Result selected | Expand/collapse detail |
| `/` | Search input focused | Open folder autocomplete (future enhancement) |
| `Cmd+E` / `Ctrl+E` | Results visible | Export current view |

### Escape Cascade Logic

Escape has a priority cascade — it undoes the most recent narrowing action first:

1. If an expanded detail is open → collapse it.
2. If search text is non-empty → clear search text.
3. If filter pills are active → remove the most recent pill.
4. If folder scope is active → clear folder scope (return to Home).
5. If in settings → return to previous state.
6. If overlay is at Home with nothing to undo → hide overlay.

This makes Escape feel natural: "undo the last thing I did."

---

## 10. Visual Design Notes

### Breadcrumb Bar
- Light background (`var(--bg-secondary)`), small font (12px).
- Each segment is a link (underline on hover, accent color).
- `[📂]` and `[✕]` are small icon buttons, right-aligned.

### Filter Pills
- Rounded capsules (`border-radius: 12px`), background `var(--bg-secondary)`.
- Icon + label + `✕` close button.
- Horizontal row, wraps if many pills.

### Sticky Footer
- Pinned to overlay bottom, separated by top border.
- Muted text for stats, accent-colored Export button.
- Small height (36px) to not consume result space.

### Home Screen Folder Rows
- Each row is a clickable card-like element.
- Hover highlights with `var(--bg-hover)`.
- Record count is right-aligned, muted color.
- `[📂]` icon appears on hover (or always visible — TBD during implementation).

### Settings Panel
- Same overlay dimensions, scrollable if needed.
- Section dividers with `var(--border)` lines.
- Buttons styled consistently with the rest of the overlay.

---

## 11. Migration & Backwards Compatibility

- **No data migration needed.** The SQLite schema is unchanged. This is a pure UI/UX change.
- **Tray removal is safe.** The tray has no persistent state. Removing it is just deleting code.
- **AppConfig is unchanged.** `lastVaultPath`, `vaultPaths`, `claudeCliPath`, `autoStart` — all still used, just accessed from the overlay settings instead of tray.
- **Notifications remain.** Desktop notifications (`Notification` API) still fire for extraction completion, conflicts, errors. They're independent of the tray.

---

## 12. Out of Scope

| Feature | Reason |
|---|---|
| `/` key folder autocomplete | Nice-to-have, can add later once pills + breadcrumbs are working |
| Drag-and-drop folder onto overlay | Complex, low priority |
| Processing status indicator in overlay header | Future — currently notifications are sufficient |
| Multi-select result rows for batch export | Future — current filter-based export covers the main use case |
| Keyboard shortcut for adding filter pills | Future |

---

## 13. Success Criteria

1. **User can initialize a vault** entirely from the overlay (no tray, no CLI).
2. **User can scope search to any subfolder** by clicking a path segment on any result row.
3. **User can export CSV for a specific folder** by scoping to it and clicking Export.
4. **All tray menu functionality** is accessible from the overlay settings panel.
5. **Zero OS-specific extensions required** — works identically on macOS, Windows, Linux.
6. **Escape cascade** feels natural — always undoes the most recent action.
7. **Aggregation footer** updates in < 100ms after filter changes.

---

*End of document.*
