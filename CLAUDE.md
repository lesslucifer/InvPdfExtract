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

## SQLite Schema

The database (`vault.db` in `.invoicevault/`) uses these core tables: `files`, `extraction_batches`, `records`, `bank_statement_data`, `invoice_data`, `invoice_line_items`, `extraction_scripts`, `file_script_assignments`, `field_overrides`, `processing_logs`. Full schema definitions are in PRD Section 9. All deletions are soft deletes (`deleted_at` column). FTS5 is used for search.
