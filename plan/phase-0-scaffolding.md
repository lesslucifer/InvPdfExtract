# Phase 0 — Project Scaffolding & Foundation

> **Goal:** A buildable Electron + TypeScript app that starts, shows nothing visible, and exits cleanly.
> **Output:** `pnpm dev` launches the Electron app, main process logs "ready" to console, app quits on Cmd+Q.

---

## Tasks

### 0.1 Electron + TypeScript bootstrap
- [x] Already done — Electron Forge is set up with webpack, `forge.config.ts`, `tsconfig.json`
- Verify `pnpm dev` launches successfully
- Verify `pnpm package` produces a distributable

### 0.2 Project structure
Create the following source layout:

```
src/
├── main/
│   ├── index.ts              ← Electron main entry
│   ├── ipc/                  ← IPC handler registration (empty for now)
│   └── services/             ← Business logic services (empty for now)
├── renderer/
│   ├── index.html            ← Shell HTML for overlay window
│   ├── index.tsx             ← React entry point
│   └── App.tsx               ← Root component (placeholder)
├── shared/
│   ├── types/                ← Shared TypeScript types & interfaces
│   │   └── index.ts
│   └── constants.ts          ← App-wide constants
└── preload.ts                ← Context bridge (secure IPC)
```

### 0.3 Shared types — first pass
Define the core domain types from the PRD data model in `src/shared/types/`:
- `DocType` enum: `bank_statement`, `invoice_out`, `invoice_in`, `unknown`
- `FileStatus` enum: `pending`, `processing`, `done`, `review`, `error`
- `VaultFile`, `Record`, `BankStatementData`, `InvoiceData`, `InvoiceLineItem`
- `ExtractionBatch`, `FieldOverride`, `ExtractionScript`

### 0.4 Dev tooling
- ESLint + Prettier config (basic, no over-engineering)
- `tsconfig.json` path aliases: `@main/*`, `@renderer/*`, `@shared/*`

### 0.5 Verify build pipeline
- `pnpm dev` → app launches, console logs "InvoiceVault ready"
- `pnpm package` → builds without errors on macOS

---

## Acceptance Criteria
- [ ] `pnpm dev` starts Electron with no visible window
- [ ] Shared types compile without errors
- [ ] `pnpm package` produces a macOS app bundle
- [ ] Source layout matches the structure above
