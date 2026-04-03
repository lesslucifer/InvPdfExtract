# Phase 6: Path Search (`/` prefix) + Watcher Hardening

Replace the `in:foldername` text filter with an interactive **path search mode** triggered when the user types `/` as the first character of the input. Simultaneously harden the file watcher for large vaults (20k+ files).

---

## Motivation

`in:foldername` requires knowing the exact folder name. Most users will type `/` when navigating folders (filesystem muscle memory). The `/` prefix is a mode switch — more discoverable and visually distinct. At the same time, the current chokidar setup has known scaling problems that must be fixed before the path search cache can rely on watcher events.

---

## Part A: Watcher Hardening

### Problems with the current watcher at scale

1. **`ignoreInitial: false`** fires one `add` event per file on startup — 20k files = 20k events in a burst, filling `debounceTimers` with 20k `Timeout` objects simultaneously.
2. **inotify descriptor exhaustion (Linux)** — chokidar registers one OS watch descriptor per file/directory. Default limit is 8192. 20k files blows past this and silently drops watches.
3. **Extension filtering happens after the event** — `handleEvent` currently filters by extension, but chokidar has already registered a watch descriptor for every file including non-watched types (`.txt`, `.zip`, etc.). Filtering in the `ignored` callback instead prevents those descriptors from being allocated at all.

### Fixes

**1. Switch to `ignoreInitial: true`**

Suppress all startup `add` events. The sync engine already has a reconciliation pass (DB vs filesystem) to catch files added while the app was closed — that's the right place for initial scan, not the watcher.

**2. Filter by extension inside `ignored`**

```ts
ignored: (filePath: string, stats?: fs.Stats) => {
  if (stats?.isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    if (!WATCHED_EXTENSIONS.has(ext)) return true; // never register a watch descriptor
  }
  // ... existing dir/pattern checks
}
```

This reduces OS watch descriptors by ~10x — only watched extensions get descriptors.

**3. Cap `depth` at 10**

```ts
depth: 10,
```

Prevents unbounded recursion into pathological directory trees.

**4. Expose watcher events for cache invalidation**

The `FileWatcher` already emits `file:added` and `file:deleted`. The path cache (Part B) hooks into these for surgical updates — no full rebuild needed per change.

### Files changed

| File | Change |
|------|--------|
| `src/core/watcher.ts` | `ignoreInitial: true`, extension pre-filter in `ignored`, add `depth: 10` |

---

## Part B: Path Search

### Trigger

- User types `/` as the **first character** of an otherwise empty search input → enter **PathSearch** mode
- Backspacing to empty while in PathSearch → return to previous state (Home or Search)
- `Esc` in PathSearch → full reset to Home (same as Esc cascade from Search with no query)

### UI

- The input shows the typed path (e.g. `/inv2024`, `/invoices-out/Q1`)
- Below the input, a **PathResultsList** replaces the normal results area
- Folders shown with `📁`, files with `📄`
- Selecting a **folder** → sets `folderScope`, exits PathSearch, transitions to Search scoped to that folder
- Selecting a **file** → opens in default OS app, stays in PathSearch
- Empty query (bare `/`) → shows all top-level vault folders, sorted alphabetically

### Path cache

A `VaultPathCache` class lives in `src/core/vault-path-cache.ts`:

```ts
type CacheEntry = { relativePath: string; lowerPath: string; name: string; lowerName: string; isDir: boolean };
```

**Build:** On vault open, walk the vault root asynchronously using `fs.opendir` (streaming, non-blocking) up to depth 10, ignoring `.invoicevault` and other `IGNORED_DIRS`. Store two pre-sorted arrays: `dirs[]` and `files[]`, both sorted alphabetically by `lowerPath` at build time.

**Update:** On `file:added` / `file:deleted` watcher events, surgically insert or remove the single entry — no full rebuild. Because `ignoreInitial: true` is now set, these events only fire for genuine changes (100–200 at a time at most).

**Query — two-tier scoring:**

Score each `CacheEntry` against the query string (already lowercased at call time):

1. **Prefix match** — `lowerPath.startsWith(q)` or `lowerName.startsWith(q)` → score `1000 + (1000 - lowerPath.length)` (shorter path = higher score, so top-level folders win)
2. **Fuzzy subsequence** — every character of `q` appears in `lowerPath` in order → score = sum of contiguous run lengths (longer runs = more relevant)
3. **No match** → score `0`, excluded from results

**Sort order:** dirs before files → score descending → alphabetical.

**Result limit:** top 20 entries total.

**Performance at scale:**

| Vault size | Cache build | Query latency |
|---|---|---|
| < 1k | < 20ms (async, bg) | < 1ms |
| 1k–10k | 100–300ms (async, bg) | 1–3ms |
| 10k–50k | 300ms–1s (async, bg) | 3–10ms |

Cache build is fully async and happens in the background after vault open — it never blocks the UI or the main process. The 150ms debounce on keystrokes absorbs query latency entirely at any realistic scale.

### IPC: `list-vault-paths`

**Request:** `{ query: string }` — text after the leading `/`

**Response:** `Array<{ name: string; relativePath: string; isDir: boolean }>`

Guards: reject any query containing `..`.

### New OverlayState

```ts
export enum OverlayState {
  Home = 'Home',
  Search = 'Search',
  PathSearch = 'PathSearch',
}
```

Transitions:

| From | Event | To | Side effect |
|------|-------|----|-------------|
| `Home` or `Search` | input first char is `/` | `PathSearch` | — |
| `PathSearch` | select folder | `Search` | set `folderScope` |
| `PathSearch` | select file | `PathSearch` | open file externally |
| `PathSearch` | backspace to empty | previous state | — |
| `PathSearch` | `Esc` | `Home` | clear query, folderScope, filters |

### Removing `in:` filter token

- Remove `in:` token parsing from `parseSearchQuery` in `src/shared/parse-query.ts`
- Remove `folder` branch from `buildQueryString`
- Remove `folder` field from `ParsedQuery` interface
- The `folderScope` state and `BreadcrumbBar` remain — now set only via PathSearch or the Home screen folder browse arrow
- Remove all `in:` test cases from `parse-query.test.ts` and `overlay-state-machine.test.ts`

---

## Files to Change

| File | Change |
|------|--------|
| `src/core/watcher.ts` | `ignoreInitial: true`, extension pre-filter, `depth: 10` |
| `src/core/vault-path-cache.ts` | **New** — `VaultPathCache` class |
| `src/core/vault-path-cache.test.ts` | **New** — unit tests for scoring, sorting, cache update |
| `src/main.ts` | Instantiate `VaultPathCache`, wire watcher events to cache |
| `src/main/overlay-window.ts` | Add `list-vault-paths` IPC handler |
| `src/preload.ts` | Expose `listVaultPaths` |
| `src/shared/types/index.ts` | Add `listVaultPaths` to `InvoiceVaultAPI` |
| `src/shared/parse-query.ts` | Remove `in:` parsing, remove `folder` from `ParsedQuery` |
| `src/shared/parse-query.test.ts` | Remove `in:` test cases |
| `src/components/overlay-state-machine.test.ts` | Remove `in:` test cases, add `PathSearch` transitions |
| `src/components/SearchOverlay.tsx` | Detect `/` trigger, add `PathSearch` state handling, render `PathResultsList` |
| `src/components/PathResultsList.tsx` | **New** — debounced query, keyboard nav, folder/file rows |
| `src/index.css` | Styles for path results list |
| `e2e/path-search.spec.ts` | **New** — E2E: type `/`, pick folder, verify breadcrumb |

---

## Tests

- **`vault-path-cache.test.ts`** — prefix scoring beats fuzzy, dirs before files, top-20 cap, surgical add/remove updates, path traversal rejection
- **`parse-query.test.ts`** — regression: `in:` tokens are no longer parsed
- **`PathResultsList.test.ts`** — renders results, keyboard nav, calls `listVaultPaths` debounced
- **`e2e/path-search.spec.ts`** — type `/inv`, see folder list, click folder, breadcrumb appears, search scoped
