# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InvoiceVault — an Electron desktop app for managing Vietnamese VAT invoices (hoa don GTGT). It watches folders for accounting documents (PDF, Excel, CSV, XML), auto-extracts structured data via Claude Code CLI, and stores results in a local SQLite database. Designed as a no-window tray app with a Spotlight-style search overlay.

Previously a Node.js CLI tool (preserved on `v1` branch). Now being rewritten as an Electron + TypeScript + React desktop app.

## Commands

```bash
pnpm start           # Launch Electron app in dev mode (electron-forge)
pnpm run package     # Package the app for distribution
pnpm run make        # Build platform-specific installers
```

Package manager is **pnpm**.

> **Symlinked `node_modules` warning:** If `node_modules` is a symlink (e.g. from a shared/packaged build), you must unlink it and reinstall before adding new packages:
> ```bash
> rm node_modules            # remove the symlink (not rm -rf)
> pnpm install               # reinstall local node_modules
> pnpm add <package>         # now safe to add new packages
> ```

## ⚠️ Session Verification (IMPORTANT)

**After every coding session, always run and fix all failures before finishing:**

```bash
pnpm tsc --noEmit   # Type check
pnpm lint           # Lint
pnpm test           # Tests
```

## Linting

**ESLint v9** flat config (`eslint.config.mjs`). Bug-catching rules only, no style enforcement.

```bash
pnpm lint              # Check for lint errors
pnpm lint:fix          # Auto-fix what ESLint can
```

Plugins: `typescript-eslint` (recommended), `eslint-plugin-react-hooks`, `@spaced-out/eslint-plugin-i18n`.

## i18n

- Use `t(key, fallback)` for all user-facing UI text in the app. Avoid hardcoded display strings in components, labels, tooltips, empty states, and buttons.
- Keep `src/components/lib/i18n/translations/en.json` and `src/components/lib/i18n/translations/vi.json` in sync, using flat `snake_case` keys.
- DO NOT ADD RAW STRING FOR DISPLAYABLE TEXT. ALWAYS SUPPORT I18N. IMPORTANT!!

## TypeScript

- Prefer strict, explicit TypeScript types throughout the app. Avoid `any` as much as possible; use concrete types, generics, unions, or `unknown` with narrowing instead.

## Styling

**Tailwind CSS v3** — all component styling uses utility classes inline in JSX `className` props. No component-level CSS files.

### What stays in `src/index.css` (the only CSS file)
- `@tailwind` directives, universal box-sizing reset, `body` base styles
- `-webkit-app-region` drag rules on `.title-bar` / `.title-bar__close` (Electron-specific, no Tailwind equivalent)
- `::-webkit-scrollbar` rules for `.result-list`
- `::placeholder` color for `.search-input`
- Table-descendant selectors Tailwind can't express: `.field-conflict td`, `.editable-field .field-display:hover`, `.editable-cell .cell-display:hover`, `td.cell-mismatch .cell-display`, `tr.line-item-mismatch`, `.je-cell-display:hover`
- Cheatsheet code blocks: `.cheatsheet-compact code`, `.cheatsheet-note code`

**Do not add new CSS classes to `src/index.css`.** Use Tailwind utilities in JSX instead.

### Design tokens (`tailwind.config.ts`)
`bg-bg`, `bg-bg-secondary`, `bg-bg-hover`, `border-border`, `text-text`, `text-text-secondary`, `text-text-muted`, `bg-accent` / `text-accent`, `text-confidence-high/medium/low`, `bg-confidence-high/medium/low`

### Font sizes (custom, non-standard)
`text-2.5`=10px · `text-2.75`=11px · `text-3`=12px · `text-3.25`=13px · `text-3.5`=14px · `text-4`=16px · `text-5`=20px

### JIT rule: no dynamic class construction
Full class strings must appear literally in source. Use lookup objects for conditional classes:
```tsx
// WRONG — JIT won't generate these:
<span className={`text-${color}`} />
// CORRECT — full strings as literal values in a lookup map:
const CLASSES = { high: 'text-confidence-high bg-confidence-high/10', ... }
```

### Hover-reveal children
Use `group` on parent + `opacity-0 group-hover:opacity-100` on child — never add descendant CSS rules to index.css.

### Confidence badges
Use `/10` opacity modifier: `text-confidence-high bg-confidence-high/10`

### Animations
`animate-overlay-in`, `animate-detail-in`, `animate-status-pulse`, `animate-settings-notification-fade`, `animate-suggestion-in`, `animate-je-dot-pulse-slow`, `animate-je-dot-pulse-fast` — all defined in `tailwind.config.ts`.

---

## Code Style

**Write self-documenting code.** Avoid comments unless essential for complex logic or critical context (SUPER CRITICAL - ALWAYS FOLLOW THIS).

**Prefer lodash utilities for better performance and readability.** Use `_.orderBy` instead of native `sort()`, and leverage lodash functions over verbose native alternatives. Exception: Use native `filter()` and `map()` for simple array operations. Avoid `reduce()` - use `_.groupBy`, `_.keyBy`, or other lodash functions instead. For long data transformation chains, use lodash chaining (`_()`).

## Async File I/O

All `src/` fs ops must be async (`fs.promises.*`, `promisify(exec)`). Sync calls block Electron's main thread. Prefer read+catch over existsSync+read. Exceptions: `scripts/`, test setup, `.find()` sync callbacks, `XLSX.readFile`.

## Architecture

**Electron Forge + Webpack** setup with separate main/renderer webpack configs:

- **Main process** (`src/main.ts`) — Electron shell, will host: folder watcher (chokidar), SQLite manager (better-sqlite3), Claude Code CLI spawner, sync engine, reconciler, system tray
- **Renderer process** (`src/renderer.ts` → `src/App.tsx`) — React UI for the search overlay and inline editing
- **Preload** (`src/preload.ts`) — Bridge between main and renderer (contextBridge API)

Webpack configs: `webpack.main.config.ts` (main), `webpack.renderer.config.ts` (renderer + CSS), `webpack.rules.ts` (shared loaders). Forge config in `forge.config.ts`.

Global type declarations for Webpack entry points live in `src/types.d.ts`.

### State Management

- **TanStack React Query** with custom QueryHook/MutationHook wrappers for server state management
- **QueryHook library** (`src/lib/queryHook.ts`) — Type-safe query builder with automatic caching
- **MutationHook library** (`src/lib/mutationHook.ts`) — Type-safe mutation builder with chainable callbacks

### QueryHook / MutationHook Conventions

Always use `queryHook`/`mutationHook` builders instead of raw `useQuery`/`useMutation`. Define hooks at module level, use in components.

```typescript
// Query: queryHook.ofKey → .useQuery → .create()
const usePresets = queryHook
  .ofKey<void, ['presets']>(() => ['presets'] as const)
  .useQuery(() => ({ queryFn: () => window.api.listPresets() }))
  .create();

// Query with params: pass param type to ofKey
const useDetail = queryHook
  .ofKey<{ id: string }, ['resultDetail', string]>(({ id }) => ['resultDetail', id] as const)
  .useQuery(({ params }) => ({ queryFn: () => window.api.getDetail(params.id) }))
  .create();

// Extend with computed fields: .extend() instead of .create()
const useDetailExt = queryHook
  .ofKey<{ id: string }, ['resultDetail', string]>(({ id }) => ['resultDetail', id] as const)
  .useQuery(({ params }) => ({ queryFn: () => window.api.getDetail(params.id) }))
  .extend((data) => ({ isEmpty: !data?.length }));

// Mutation: mutationHook.mutate → .onSuccess()
const useDeletePreset = mutationHook
  .mutate<string>(id => window.api.deletePreset(id))
  .onSuccess(() => usePresets.invalidate());
```

Static methods on query hooks: `.key()`, `.invalidate()`, `.prefetch()`, `.getCachedData()`, `.setData()`.
Chainable transforms: `.params()` (remap params), `.extend()` (add computed fields), `.data()` (add dependencies).

## Vietnamese Accounting Terms

| Term | Meaning |
|------|---------|
| hoa don GTGT | VAT invoice |
| sao ke ngan hang | bank statement |
| hoa don dau ra | output/sales invoice |
| hoa don dau vao | input/purchase invoice |
| TaxID (ma so thue) | tax identification number |
| so hoa don | invoice number |
| tong tien | total amount |
| bang ke | summary/list |
| chi tiet | line item detail |
| NCC (nha cung cap) | supplier |
| KH (khach hang) | customer |

## Testing

- Test framework: **Vitest** (node environment, globals enabled)
- Test pattern: `src/**/*.test.ts`
- Run tests: `pnpm test`
- **Always write tests for UX changes.** When implementing UI/overlay features (state transitions, IPC handlers, component logic), include corresponding tests. Extract testable logic into pure functions when React components can't be rendered in the node test environment.

## Path Resolution — DO NOT use `__dirname` in bundled code

Webpack replaces `__dirname` with `"/"` in the bundled output. This means any code in `src/` that uses `__dirname` will get the wrong path at runtime in packaged builds.

**Rules:**
- **NEVER** use `__dirname` or `__filename` in any `src/` file that gets bundled by webpack (main process or renderer).
- Use `getAppRoot()` or `findNodeModules()` from `src/core/app-paths.ts` instead. These resolve correctly in dev, Vitest, and packaged Electron.
- For packaged native bindings, use `process.resourcesPath` (Electron provides this).

## Zustand Conventions

- Stores live in `src/stores/<name>Store.ts`; re-export from `src/stores/index.ts`.
- Shared/cross-component state → Zustand store. Local UI state (edit buffers, confirms) → `useState`.
- Always use selectors: `useStore(s => s.field)`, never bare `useStore()` — prevents unnecessary re-renders.
- Cross-store access outside React: `useOtherStore.getState()` — standard Zustand pattern.
- All IPC event subscriptions (`onFileStatusChanged`, `onJeStatusChanged`) live in `processingStore` only — never subscribe in components.
- Use `immer` middleware only for stores with complex nested state updates (e.g. `searchStore`).

## React Query Conventions

**What uses React Query:** SQLite reads/writes via IPC — `useQuery` for fetches, `useMutation` for writes with `invalidateQueries` on success.

**What does NOT use React Query:** `searchStore.doSearch()` (Zustand-owned pagination), `processingStore` IPC push subscriptions (pub/sub, not pull), one-shot flows (`NoVaultScreen`), main-process code, window/app control side effects.

Rules:

- `QueryClient` singleton lives in `src/lib/queryClient.ts`; export it so `processingStore` can invalidate outside React.
- Use `staleTime: Infinity` globally — data only changes via mutations or IPC push events; no background refetching.
- Also disable `refetchOnWindowFocus` and `refetchOnReconnect` — Electron tray app triggers focus events frequently.
- `processingStore` calls `queryClient.invalidateQueries()` after IPC push events instead of bumping version counters that components watch.
- Optimistic local UI state (e.g. editable total fields) stays in `useState`; only server-owned data moves to `useQuery`.

### QueryHook / MutationHook Conventions

Always use `queryHook`/`mutationHook` builders instead of raw `useQuery`/`useMutation`. Define hooks at module level, use in components.

```typescript
// Query: queryHook.ofKey → .useQuery → .create()
const usePresets = queryHook
  .ofKey(() => ['presets'] as const)
  .useQuery(() => ({ queryFn: () => window.api.listPresets() }))
  .create();

// Query with params: pass param type to ofKey
const useDetail = queryHook
  .ofKey(({ id }: { id: string }) => ['resultDetail', id] as const)
  .useQuery(({ params }) => ({ queryFn: () => window.api.getDetail(params.id) }))
  .create();

// Extend with computed fields: .extend() instead of .create()
const useDetailExt = queryHook
  .ofKey(({ id }: { id: string }) => ['resultDetail', id] as const)
  .useQuery(({ params }) => ({ queryFn: () => window.api.getDetail(params.id) }))
  .extend((data) => ({ isEmpty: !data?.length }));

// Mutation: mutationHook.mutate → .onSuccess()
const useDeletePreset = mutationHook
  .mutate<string>(id => window.api.deletePreset(id))
  .onSuccess(() => usePresets.invalidate());
```

Static methods on query hooks: `.key()`, `.invalidate()`, `.prefetch()`, `.getCachedData()`, `.setData()`.
Chainable transforms: `.params()` (remap params), `.extend()` (add computed fields), `.data()` (add dependencies).

**Invalidation patterns:**
- IPC calls returning `{ success }` — use static `.invalidate()` with manual `await`, not `mutationHook.onSuccess`.
- When parent owns the IPC call via prop, use static `.invalidate()` in child — avoid double-calling.
- When mutation input lacks `recordId`, wrap it: `mutate<{ input: LineItemFieldInput; recordId: string }>`.
- IPC calls with no `recordId` in return (`resolveConflict`) — call `.invalidate()` statically in async handler.
- `processingStore` `onJeStatusChanged` iterates `recordIds` calling `useResultDetail.invalidate({ id })` per record.

**State ownership:**
- Optimistic animation state (e.g. reclassify spinner) stays `useState` — it's UI state, not server state.
- When a query has local side effects (debounce, sequential fetch), keep as `useEffect`; use React Query only for cacheable part.
- Merge React Query data with local state at render time rather than storing merged copies.

## SQLite Schema

The database (`vault.db` in `.invoicevault/`) uses these core tables: `files`, `extraction_batches`, `records`, `bank_statement_data`, `invoice_data`, `invoice_line_items`, `extraction_scripts`, `file_script_assignments`, `field_overrides`, `processing_logs`. Full schema definitions are in PRD Section 9. All deletions are soft deletes (`deleted_at` column). FTS5 is used for search.
