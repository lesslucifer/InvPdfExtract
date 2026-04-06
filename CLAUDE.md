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

## Architecture

**Electron Forge + Webpack** setup with separate main/renderer webpack configs:

- **Main process** (`src/main.ts`) — Electron shell, will host: folder watcher (chokidar), SQLite manager (better-sqlite3), Claude Code CLI spawner, sync engine, reconciler, system tray
- **Renderer process** (`src/renderer.ts` → `src/App.tsx`) — React UI for the search overlay and inline editing
- **Preload** (`src/preload.ts`) — Bridge between main and renderer (contextBridge API)

Webpack configs: `webpack.main.config.ts` (main), `webpack.renderer.config.ts` (renderer + CSS), `webpack.rules.ts` (shared loaders). Forge config in `forge.config.ts`.

Global type declarations for Webpack entry points live in `src/types.d.ts`.

## Implementation Plan

The PRD is in [InvoiceVault-PRD.md](InvoiceVault-PRD.md). Implementation is broken into 8 sequential phases documented in [plan/](plan/):

- **Phase 0** — Scaffolding (done: Electron + TS + React compiles and runs)
- **Phase 1** — Core engine: vault init (`.invoicevault/` folder), file watcher, SQLite schema
- **Phase 2** — PDF extraction via Claude Code CLI (`claude --print`)
- **Phase 3** — System tray icon, context menu, notifications
- **Phase 4** — Search overlay (Spotlight-style, `Cmd+Shift+I`)
- **Phase 5** — Structured extraction (Excel/CSV/XML with cached parser scripts)
- **Phase 6** — Inline editing, field locking, conflict resolution
- **Phase 7** — Export, multi-vault, Finder/Explorer integration

Phases 2+3 can run in parallel. MVP = Phases 0-4.

## Key Domain Concepts

- **Vault** — A user folder initialized with `.invoicevault/` (like `git init`). All state is local and portable.
- **Document types**: `bank_statement`, `invoice_out` (sales), `invoice_in` (purchases)
- **Bang ke / Chi tiet** — Invoice header (summary) and line items (detail). A single file can contain N invoices, each with N line items.
- **Fingerprint** — SHA-256 hash of identity fields per record, used for diffing on re-extraction (not full re-insert)
- **Field locking** — Users can edit AI-extracted fields; locked fields survive re-extraction. Conflicts arise when AI disagrees on re-extraction.
- **Script caching** — For structured files (Excel/CSV/XML), Claude generates parser + matcher scripts cached in `.invoicevault/scripts/`

## Vietnamese Accounting Terms

| Term | Meaning |
|------|---------|
| hoa don GTGT | VAT invoice |
| sao ke ngan hang | bank statement |
| hoa don dau ra | output/sales invoice |
| hoa don dau vao | input/purchase invoice |
| MST (ma so thue) | tax identification number |
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
- `__dirname` is **fine** in files that are NOT webpack-bundled: `forge.config.ts`, `webpack.*.ts`, `scripts/`, `e2e/`, and test files (`*.test.ts`) that run under Vitest/Node directly.
- The `__dirname` usage in `matcher-evaluator.ts` is intentional — it sets `__dirname` inside a VM sandbox for user-authored matcher scripts, not for the app's own path resolution.

## Zustand Conventions

- Stores live in `src/stores/<name>Store.ts`; re-export from `src/stores/index.ts`.
- Shared/cross-component state → Zustand store. Local UI state (edit buffers, confirms) → `useState`.
- Always use selectors: `useStore(s => s.field)`, never bare `useStore()` — prevents unnecessary re-renders.
- Cross-store access outside React: `useOtherStore.getState()` — standard Zustand pattern.
- All IPC event subscriptions (`onStatusUpdate`, `onFileStatusChanged`, `onJeStatusChanged`) live in `processingStore` only — never subscribe in components.
- Components react to IPC events via store selectors (`fileStatusVersion`, `lastJeUpdate`), not direct listeners.
- Use `immer` middleware only for stores with complex nested state updates (e.g. `searchStore`).
- For imperative handlers (keyboard, timers), use `getState()` — avoids stale closures and dependency arrays.

## SQLite Schema

The database (`vault.db` in `.invoicevault/`) uses these core tables: `files`, `extraction_batches`, `records`, `bank_statement_data`, `invoice_data`, `invoice_line_items`, `extraction_scripts`, `file_script_assignments`, `field_overrides`, `processing_logs`. Full schema definitions are in PRD Section 9. All deletions are soft deletes (`deleted_at` column). FTS5 is used for search.
