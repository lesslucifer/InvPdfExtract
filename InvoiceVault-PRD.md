# InvoiceVault — Product Requirements Document

> **Version:** 4.0  
> **Date:** April 2, 2026  
> **Status:** Final Draft  
> **Author:** Vu (Technical Leader, WFO) + Claude

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Concepts](#2-core-concepts)
3. [Document Types & Extraction Schema](#3-document-types--extraction-schema)
4. [File Tracking & Change Detection](#4-file-tracking--change-detection)
5. [Invoice Diff & Reconciliation](#5-invoice-diff--reconciliation)
6. [Search Overlay](#6-search-overlay)
7. [Inline Editing & Field Locking](#7-inline-editing--field-locking)
8. [Architecture](#8-architecture)
9. [Data Model (SQLite)](#9-data-model-sqlite)
10. [Claude Code CLI Integration](#10-claude-code-cli-integration)
11. [User Experience](#11-user-experience)
12. [MVP Scope (Week 1)](#12-mvp-scope-week-1)
13. [Post-MVP Roadmap](#13-post-mvp-roadmap)
14. [Technical Stack](#14-technical-stack)
15. [Risks & Mitigations](#15-risks--mitigations)
16. [Open Questions](#16-open-questions)

---

## 1. Overview

**Product Name:** InvoiceVault

**Tagline:** Git-like folder-based invoice management with AI-powered extraction

**Summary:** InvoiceVault is a cross-platform (macOS + Windows) Electron desktop application that runs as a minimal background service — no dedicated window, just a system tray icon and a Spotlight-style search overlay. Users "initialize" any folder (like `git init`), and InvoiceVault recursively watches it for accounting documents. When files are added, modified, or deleted, the app spawns a Claude Code CLI agent to classify, extract, and validate data, then syncs the structured results into a local SQLite database.

The system supports multiple document types (bank statements, input/output invoices in both summary and detailed formats) with type-specific extraction schemas. A confidence scoring system flags low-quality extractions for human review, and a fingerprint-based diffing engine handles multi-invoice files (xlsx, csv, xml) where a single file may contain dozens of records.

**Target Users:** Accountants and bookkeepers working with Vietnamese accounting documents (hóa đơn GTGT, e-invoices, sao kê ngân hàng).

**Timeline:** 1-week proof of concept, then iterative development.

---

## 2. Core Concepts

### 2.1 The `.invoicevault` Folder (Git-like Model)

When a user initializes a directory, InvoiceVault creates a hidden `.invoicevault/` folder at the root:

```
my-accounting/                          ← user's folder (the "vault")
├── .invoicevault/
│   ├── config.json                     ← vault settings
│   ├── vault.db                        ← SQLite database
│   ├── logs/                           ← processing logs
│   ├── scripts/                        ← cached extraction scripts
│   │   ├── vietcombank-xlsx-parser.js  ← parser for Vietcombank xlsx format
│   │   ├── vietcombank-xlsx-matcher.js ← matcher: returns true if file matches
│   │   ├── einvoice-xml-parser.js      ← parser for e-invoice XML format
│   │   └── einvoice-xml-matcher.js     ← matcher for e-invoice XML
│   └── queue/                          ← processing queue state
├── bank-statements/
│   ├── vietcombank-2024-03.pdf         ← 1 file → N bank transactions
│   └── techcombank-2024-Q1.xlsx        ← 1 file → N bank transactions (reuses cached script)
├── invoices-out/
│   ├── HD-001.pdf                      ← 1 file → 1 invoice (bảng kê) + N line items (chi tiết)
│   └── bang-ke-thang-3.xlsx            ← 1 file → N invoices + N×N line items (multi-sheet)
└── invoices-in/
    ├── NCC-ABC-001.xml                 ← e-invoice: 1 invoice + N line items
    └── tong-hop-dau-vao-Q1.csv         ← 1 file → N invoices + N×N line items
```

**Key principles:**

- One `.invoicevault` per root folder — everything inside is tracked recursively
- The vault is fully portable — move the folder, the vault moves with it
- All state is local — no cloud dependency, no external database
- Files are linked to extracted data via **relative paths** from the vault root
- Folder state drives DB state — the file system is the source of truth

### 2.2 No-Window Design Philosophy

InvoiceVault has **no main application window**. The entire UX is:

1. **System tray icon** — status indicator, context menu for settings/actions/export
2. **Spotlight-style search overlay** — triggered via OS-native context menu (right-click folder → "Search InvoiceVault") or global hotkey
3. **Desktop notifications** — processing results, review alerts, conflict warnings

This keeps the app invisible when not needed and instantly accessible when it is.

### 2.3 File-to-Record Relationship Model

A single file can contain multiple records, and invoice records can have line item details. The relationship is:

```
File (1) → Extraction Batch (1) → Records (N) → Line Items (N per invoice record)
```

**For bank statements:**
```
File → Batch → N transaction records (flat, no line items)
```

**For invoices (đầu ra / đầu vào):**
```
File → Batch → N invoice records (bảng kê) → N line items each (chi tiết)
```

The bảng kê (summary) and chi tiết (detail) data coexist within the same file:

| File Type | Structure |
|---|---|
| PDF / image | 1 invoice (bảng kê) + N line items (chi tiết) in the same document |
| XML e-invoice | 1 or N invoices, each with their own line items |
| Excel (.xlsx) | Can have **separate sheets**: one sheet for bảng kê rows, another for chi tiết rows, linked by số hóa đơn. Or a single sheet with both. |
| CSV | N invoices with inline detail rows |

Each time a file is processed (or re-processed due to changes), it produces exactly **one extraction batch** containing all records found in the file.

---

## 3. Document Types & Extraction Schema

InvoiceVault supports 3 document types for MVP, with more planned. Two of these (invoices out & in) have a **header/detail (bảng kê / chi tiết) structure** — the summary-level invoice record and its line item details are extracted from the same file.

### 3.1 Type 1: Sao kê ngân hàng (Bank Statement)

**Structure:** Flat records, no line items.

**Required fields:**

| Field | Column Name | Type | Description |
|---|---|---|---|
| Tên ngân hàng | `ten_ngan_hang` | TEXT | Bank name |
| STK | `stk` | TEXT | Account number |
| Date | `ngay` | DATE | Transaction date |
| Description | `mo_ta` | TEXT | Transaction description (format varies per bank) |
| Amount (Dr./Cr.) | `so_tien` | REAL | Amount — **note: Dr./Cr. may be inverted relative to the company** |
| Tên người thụ hưởng/Người chuyển | `ten_doi_tac` | TEXT | Beneficiary / sender name |

**Fingerprint:** `SHA-256(normalize(stk) + "|" + normalize(ngay) + "|" + normalize(so_tien))`

**Special notes:**
- Each bank has its own statement format — Claude Code must adapt extraction per bank
- Dr./Cr. direction needs normalization relative to the company's perspective

### 3.2 Type 2: Hóa đơn đầu ra (Output Invoices — Sales)

**Structure:** Header/detail — each invoice (bảng kê) has N line items (chi tiết).

**Invoice-level fields (bảng kê):**

| Field | Column Name | Type | Required |
|---|---|---|---|
| Date | `ngay` | DATE | ✅ |
| Số hóa đơn | `so_hoa_don` | TEXT | ✅ |
| Tổng tiền | `tong_tien` | REAL | ✅ |
| MST | `mst` | TEXT | ✅ |
| Địa chỉ KH | `dia_chi_kh` | TEXT | Recommended |
| Tên KH | `ten_kh` | TEXT | Recommended |

**Line item fields (chi tiết):**

| Field | Column Name | Type | Required |
|---|---|---|---|
| Mô tả/hàng hóa | `mo_ta` | TEXT | ✅ |
| Đơn giá | `don_gia` | REAL | ✅ |
| Số lượng | `so_luong` | REAL | ✅ |
| Tax rate | `thue_suat` | REAL | ✅ |
| Thành tiền | `thanh_tien` | REAL | ✅ |

**Fingerprint (invoice-level):** `SHA-256(normalize(so_hoa_don) + "|" + normalize(mst) + "|" + normalize(ngay))`

**Validation rules:**
- Số hóa đơn **must be sequential** — flag gaps or out-of-order
- Sum of chi tiết (Σ thành tiền) **must equal** bảng kê tổng tiền
- **Flag if số hóa đơn is missing**

**File format behavior:**

| Format | Extraction |
|---|---|
| PDF / image | 1 invoice + N line items from the document |
| xlsx | Sheet A = N invoices (bảng kê rows), Sheet B = N×N line items (chi tiết rows), linked by số hóa đơn. Or single sheet with both. |
| csv / xml | N invoices with inline detail rows |

### 3.3 Type 3: Hóa đơn đầu vào (Input Invoices — Purchases)

**Structure:** Header/detail — identical structure to Type 2, but counterparty is NCC (supplier) instead of KH (customer).

**Invoice-level fields (bảng kê):**

| Field | Column Name | Type | Required |
|---|---|---|---|
| Date | `ngay` | DATE | ✅ |
| Số hóa đơn | `so_hoa_don` | TEXT | ✅ |
| Tổng tiền | `tong_tien` | REAL | ✅ |
| MST | `mst` | TEXT | ✅ |
| Địa chỉ NCC | `dia_chi_ncc` | TEXT | Recommended |
| Tên NCC | `ten_ncc` | TEXT | Recommended |

**Line item fields (chi tiết):** Same as Type 2.

**Fingerprint (invoice-level):** `SHA-256(normalize(so_hoa_don) + "|" + normalize(mst) + "|" + normalize(ngay))`

**Validation rules:**
- Sequential order **not required**
- Sum of chi tiết (Σ thành tiền) **must equal** bảng kê tổng tiền

### 3.4 Document Type Classification

Claude Code auto-detects the document type during extraction. The classification step happens first in the agent pipeline — before field extraction — and determines which schema to apply.

Classification signals include: file name patterns, content structure, header keywords (sao kê, bảng kê, hóa đơn, đầu ra, đầu vào), presence of bank-specific formatting, XML namespace/tags for e-invoices.

---

## 4. File Tracking & Change Detection

### 4.1 File Identity

Every file in the vault is tracked by:

- **Relative path** from vault root (e.g., `invoices-out/HD-001.pdf`) — primary link to extracted data
- **File hash** (SHA-256 of content) — used for change detection and rename/move detection

### 4.2 Change Detection Events

| Event | Detection | Action |
|---|---|---|
| **New file** | Path not in DB | Add to `files` table, queue for extraction |
| **Modified file** | Path exists, hash changed | Re-extract entire file, diff results via fingerprints |
| **Deleted file** | Path in DB, file gone from disk | Soft-delete file + all linked records |
| **Renamed/moved** | Same hash, different path | Update `relative_path`, preserve all linked data |

### 4.3 Sync Cycle

On each watcher trigger (debounced):

1. **Scan** — Walk vault folder, compute hashes for new/changed files
2. **Diff against DB** — Compare scanned state with `files` table
3. **Immediate actions** — Deleted files → soft-delete. Moved files → path update.
4. **Queue** — New and modified files → extraction queue
5. **Process** — Spawn Claude Code CLI for queued files (batched)
6. **Reconcile** — Fingerprint-based diff of extraction results against existing DB rows

---

## 5. Invoice Diff & Reconciliation

### 5.1 The Problem

A single xlsx file might contain 50 invoices. When the user edits that xlsx (adds 2 rows, modifies 1, deletes 3), we need to precisely sync those changes to the DB — not blow away and re-insert everything.

### 5.2 Fingerprint-Based Diffing

Each extracted record gets a **fingerprint** — a deterministic hash of its identity fields (defined per document type in §3). On re-extraction:

1. **Re-extract** — Claude Code processes the entire modified file
2. **Compute fingerprints** — For each extracted record
3. **Diff against existing records** linked to this file:

| Scenario | Action |
|---|---|
| Same fingerprint, same data | No change |
| Same fingerprint, different data | Update existing record (respecting field locks — see §7) |
| New fingerprint (not in DB) | Insert as new record |
| Missing fingerprint (in DB, not in new extraction) | Soft-delete the record |

### 5.3 Soft Delete Behavior

All deletions are soft deletes — records are **never removed** from the database.

- `files.deleted_at` — set when file disappears from disk
- `records.deleted_at` — set when parent file is deleted OR record disappears from a multi-record file
- `line_items.deleted_at` — cascades from parent record

Soft-deleted records are excluded from default queries but remain available for audit.

### 5.4 Example Flow

```
Existing DB for "bang-ke-thang-3.xlsx":
  Invoice A (fp: abc123) ← unchanged
  Invoice B (fp: def456) ← user modified amount in xlsx
  Invoice C (fp: ghi789) ← user deleted this row from xlsx
                          ← user added new Invoice D

After re-extraction & diff:
  Invoice A → no change
  Invoice B → updated (new amount written to DB)
  Invoice C → soft-deleted (deleted_at = now)
  Invoice D → inserted as new record
```

---

## 6. Search Overlay

### 6.1 Trigger Mechanism

The search overlay is triggered via **OS-native context menu integration**:

- **macOS:** Finder Extension (FinderSync API) — right-click any folder → "Search InvoiceVault"
- **Windows:** Shell Extension (registry-based) — right-click any folder → "Search InvoiceVault"

The overlay can also be triggered via a **global hotkey** (configurable, default: `Cmd+Shift+I` / `Ctrl+Shift+I`).

### 6.2 Overlay Design

- **Appearance:** Centered on screen, Spotlight-style floating panel
- **Behavior:** Appears on trigger, disappears on `Esc` or click-outside
- **Scope:** When triggered from a folder context menu, search is automatically scoped to that folder + subfolders. When triggered via hotkey, search spans the entire vault.

### 6.3 Search Capabilities

The search box is a **smart unified input** that handles multiple query types:

| Query Type | Example | Behavior |
|---|---|---|
| Free text | `ABC company` | Searches across all text fields |
| Invoice number | `HD-001` | Matches `so_hoa_don` |
| Tax code (MST) | `0101234567` | Matches `mst`, `mst_nguoi_ban`, `mst_nguoi_mua` |
| Date | `15/03/2024` or `2024-03` | Matches date fields, supports month/year |
| Amount | `>10000000` or `5tr-10tr` | Range queries on amount fields |
| Document type | `type:bank` or `type:hdra` | Filters by document type |
| Folder scope | `in:invoices-out` | Limits to a specific subfolder |
| Status | `status:review` or `status:conflict` | Filters by processing status |
| Combined | `type:hdra 0101234567 2024-03` | All filters combine with AND logic |

### 6.4 Search Results

Results appear as a scrollable list below the search box:

```
┌─────────────────────────────────────────────────────────┐
│  🔍  0101234567 type:hdra                           ✕   │
├─────────────────────────────────────────────────────────┤
│  📄 HD-001  │ Công ty ABC │ 11,000,000đ │ 15/03/2024   │
│     invoices-out/HD-001.pdf              confidence: 92% │
│─────────────────────────────────────────────────────────│
│  📄 HD-002  │ Công ty ABC │  5,500,000đ │ 18/03/2024   │
│     invoices-out/HD-002.pdf              confidence: 88% │
│─────────────────────────────────────────────────────────│
│  📊 HD-003..HD-015 │ Công ty ABC │ (12 records)         │
│     invoices-out/bang-ke-thang-3.xlsx    confidence: 95% │
│─────────────────────────────────────────────────────────│
│                                                         │
│  3 files · 14 records · Showing results in /invoices-out │
└─────────────────────────────────────────────────────────┘
```

Each result row shows: document type icon, key fields (invoice number, counterparty, amount, date), source file path, and confidence indicator.

**Actions from results:**
- Click a record → expand to show all fields + edit form (see §7)
- `Enter` on a file → open source file in default app
- `Cmd+C` on a record → copy key fields to clipboard

---

## 7. Inline Editing & Field Locking

### 7.1 The Problem

AI extraction makes mistakes. Users need to correct extracted data. But if the source file later changes and triggers re-extraction, manual corrections would be overwritten.

### 7.2 Edit Flow

1. User searches and finds a record in the overlay
2. Clicks the record to expand it into an **inline edit form**
3. Edits any field (e.g., corrects a misread invoice number)
4. On save:
   - The field value is updated in the DB
   - The field is marked as `locked` (user-edited)
   - A `user_edit` record is created in the audit trail

### 7.3 Field Lock & Conflict Resolution

Each field on a record can be in one of three states:

| State | Visual | Meaning |
|---|---|---|
| **Normal** | (no indicator) | AI-extracted, not edited by user |
| **Locked** | 🔒 icon | User-edited — protected from overwrite |
| **Conflict** | ⚠️ icon | Locked field where AI now disagrees on re-extraction |

**On re-extraction of a file:**

- **Normal fields:** Overwritten with new AI value (standard behavior)
- **Locked fields:** Preserved. But if the new AI value differs from the locked value, the field enters **conflict** state
- **Conflict state:** The field shows both values — user's edit and the new AI suggestion. User can:
  - **Keep their edit** — dismiss the conflict, field stays locked
  - **Accept AI value** — unlock the field, overwrite with AI value

### 7.4 Data Model for Field Locking

Stored in a `field_overrides` table (see §9) rather than modifying the record schema. This keeps the override system decoupled and extensible.

```json
// Example: field_overrides row
{
  "record_id": "uuid-of-invoice",
  "field_name": "so_hoa_don",
  "user_value": "HD-001A",
  "ai_value_at_lock": "HD-0014",
  "ai_value_latest": "HD-001B",
  "status": "conflict",
  "locked_at": "2024-03-20T10:00:00Z"
}
```

### 7.5 Conflict Notification

When re-extraction creates new conflicts, the system:
- Shows a tray notification: "⚠️ 3 field conflicts after re-processing bang-ke-thang-3.xlsx"
- The tray icon turns yellow (🟡 needs review)
- Conflicts are searchable: `status:conflict` in the search overlay

---

## 8. Architecture

### 8.1 High-Level Architecture

```
┌────────────────────────────────────────────────────┐
│              Electron Main Process                  │
│                                                    │
│  ┌─────────────┐    ┌───────────────────────────┐  │
│  │ Folder       │    │ Sync Engine               │  │
│  │ Watcher      │───▶│ - hash-based change detect│  │
│  │ (chokidar)   │    │ - rename/move detection   │  │
│  └─────────────┘    │ - queue management         │  │
│                      └─────────────┬─────────────┘  │
│                                    │                │
│  ┌─────────────────────────────────▼─────────────┐  │
│  │ Claude Code CLI Spawner                        │  │
│  │ (child_process.spawn)                          │  │
│  │ - batch file processing                        │  │
│  │ - multi-step: classify → extract → validate    │  │
│  │ - PDF/image: vision extraction                 │  │
│  │ - XML/Excel/CSV: script generation + execution │  │
│  └─────────────────────────────────┬─────────────┘  │
│                                    │                │
│  ┌─────────────────────────────────▼─────────────┐  │
│  │ Script Registry                                │  │
│  │ - cached parser scripts + matcher functions    │  │
│  │ - matcher evaluation for new files             │  │
│  │ - script reuse tracking & assignment           │  │
│  └─────────────────────────────────┬─────────────┘  │
│                                    │                │
│  ┌─────────────────────────────────▼─────────────┐  │
│  │ Reconciler                                     │  │
│  │ - fingerprint computation                      │  │
│  │ - diff: insert / update / soft-delete          │  │
│  │ - field lock & conflict detection              │  │
│  │ - extraction batch management                  │  │
│  └─────────────────────────────────┬─────────────┘  │
│                                    │                │
│  ┌─────────────────────────────────▼─────────────┐  │
│  │ SQLite Manager (better-sqlite3)                │  │
│  │ - vault.db in .invoicevault/                   │  │
│  └───────────────────────────────────────────────┘  │
│                                                    │
│  ┌────────────────┐  ┌──────────────────────────┐  │
│  │ System Tray    │  │ Search Overlay            │  │
│  │ + Notifications│  │ (BrowserWindow, frameless)│  │
│  └────────────────┘  └──────────────────────────┘  │
│                                                    │
│  ┌───────────────────────────────────────────────┐  │
│  │ Native Extensions                              │  │
│  │ - macOS: FinderSync (Finder context menu)      │  │
│  │ - Windows: Shell Extension (Explorer menu)     │  │
│  └───────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

### 8.2 Process Flow

```
File event detected
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ New file?     │────▶│ Queue for    │────▶│ Classify     │
│ Modified file?│     │ extraction   │     │ (Claude Code)│
└──────┬───────┘     └──────────────┘     └──────┬───────┘
       │                                          │
       │ Deleted file?                            ▼
       │                                  ┌──────────────┐
       ▼                                  │ Check script  │
┌──────────────┐                          │ registry for  │
│ Soft-delete  │                          │ matcher match │
│ file + all   │                          └──────┬───────┘
│ linked data  │                           ┌─────┴──────┐
│ + line items │                           │            │
└──────────────┘                      match found   no match
                                           │            │
       │ Renamed/moved?                    ▼            ▼
       ▼                           ┌────────────┐ ┌────────────┐
┌──────────────┐                   │ Run cached  │ │ Claude Code│
│ Update       │                   │ parser      │ │ generates  │
│ relative_path│                   │ script      │ │ new parser │
└──────────────┘                   └──────┬─────┘ │ + matcher  │
                                          │       └──────┬─────┘
                                          └──────┬───────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │ Validate &   │
                                          │ score        │
                                          └──────┬───────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │ Reconcile    │
                                          │ (fingerprint │
                                          │  diff + lock │
                                          │  detection)  │
                                          └──────────────┘
```

---

## 9. Data Model (SQLite)

### 9.1 Core Tables

#### `files`

| Column | Type | Description |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| relative_path | TEXT (UNIQUE) | Path from vault root — the link key |
| file_hash | TEXT | SHA-256 for change detection |
| file_type | TEXT | pdf, xml, xlsx, csv, jpg, png |
| file_size | INTEGER | Bytes |
| doc_type | TEXT | Classification result (see §3) |
| status | TEXT | pending, processing, done, review, error |
| deleted_at | DATETIME | Soft delete (NULL = active) |
| created_at | DATETIME | File first detected |
| updated_at | DATETIME | Last hash change |

**`doc_type` enum values:**
- `bank_statement`
- `invoice_out` (hóa đơn đầu ra — with bảng kê + chi tiết)
- `invoice_in` (hóa đơn đầu vào — with bảng kê + chi tiết)
- `unknown`

#### `extraction_batches`

| Column | Type | Description |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| file_id | TEXT | FK → files.id |
| status | TEXT | success, partial, error |
| record_count | INTEGER | Number of records extracted |
| overall_confidence | REAL | Average confidence |
| claude_session_log | TEXT (JSON) | Full CLI I/O for audit |
| script_id | TEXT | FK → extraction_scripts.id (NULL for vision-based) |
| processed_at | DATETIME | Extraction timestamp |

#### `records` (common fields for all document types)

| Column | Type | Description |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| batch_id | TEXT | FK → extraction_batches.id |
| file_id | TEXT | FK → files.id (denormalized) |
| doc_type | TEXT | Document type (denormalized) |
| fingerprint | TEXT | Deterministic identity hash |
| confidence | REAL | Overall confidence (0–1) |
| ngay | DATE | Date (common to all types) |
| field_confidence | TEXT (JSON) | Per-field confidence scores |
| raw_extraction | TEXT (JSON) | Full raw AI output |
| deleted_at | DATETIME | Soft delete (NULL = active) |
| created_at | DATETIME | First extracted |
| updated_at | DATETIME | Last updated |

#### `bank_statement_data` (extension for Type 1 — flat, no line items)

| Column | Type | Description |
|---|---|---|
| record_id | TEXT | FK → records.id (1:1) |
| ten_ngan_hang | TEXT | Bank name |
| stk | TEXT | Account number |
| mo_ta | TEXT | Transaction description |
| so_tien | REAL | Amount (Dr./Cr.) |
| ten_doi_tac | TEXT | Beneficiary / sender |

#### `invoice_data` (extension for Types 2–3 — invoice header / bảng kê level)

| Column | Type | Description |
|---|---|---|
| record_id | TEXT | FK → records.id (1:1) |
| so_hoa_don | TEXT | Invoice number |
| tong_tien | REAL | Total amount |
| mst | TEXT | Tax code (MST) |
| ten_doi_tac | TEXT | KH name (đầu ra) or NCC name (đầu vào) |
| dia_chi_doi_tac | TEXT | KH address (đầu ra) or NCC address (đầu vào) |

#### `invoice_line_items` (chi tiết — linked to invoice_data 1:N)

| Column | Type | Description |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| record_id | TEXT | FK → records.id |
| line_number | INTEGER | Order within the invoice |
| mo_ta | TEXT | Item description |
| don_gia | REAL | Unit price |
| so_luong | REAL | Quantity |
| thue_suat | REAL | Tax rate (%) |
| thanh_tien | REAL | Line total |
| deleted_at | DATETIME | Soft delete (cascade from parent) |

#### `extraction_scripts` (cached parser scripts + matcher functions)

| Column | Type | Description |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Human-readable name (e.g., "vietcombank-xlsx-parser") |
| doc_type | TEXT | Document type this script handles |
| script_path | TEXT | Path to parser script in `.invoicevault/scripts/` |
| matcher_path | TEXT | Path to matcher function in `.invoicevault/scripts/` |
| matcher_description | TEXT | Human-readable description of what files this matches |
| times_used | INTEGER | How many files have been processed with this script |
| created_at | DATETIME | When Claude Code generated this script |
| last_used_at | DATETIME | Last time this script was used |

#### `file_script_assignments` (which script was used for which file)

| Column | Type | Description |
|---|---|---|
| file_id | TEXT | FK → files.id |
| script_id | TEXT | FK → extraction_scripts.id |
| assigned_at | DATETIME | When this assignment was made |

#### `field_overrides` (user edits & conflict tracking)

| Column | Type | Description |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| record_id | TEXT | FK → records.id |
| table_name | TEXT | Which extension table (bank_statement_data, invoice_data) |
| field_name | TEXT | Column name that was edited |
| user_value | TEXT | Value set by user |
| ai_value_at_lock | TEXT | AI value when user first edited |
| ai_value_latest | TEXT | AI value from most recent extraction |
| status | TEXT | locked, conflict |
| locked_at | DATETIME | When user edited |
| conflict_at | DATETIME | When conflict was detected (NULL if no conflict) |
| resolved_at | DATETIME | When user resolved conflict (NULL if unresolved) |

#### `processing_logs`

| Column | Type | Description |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| batch_id | TEXT | FK → extraction_batches.id |
| level | TEXT | info, warn, error |
| message | TEXT | Log message |
| timestamp | DATETIME | When logged |

### 9.2 Indexes

```sql
CREATE INDEX idx_files_relative_path ON files(relative_path);
CREATE INDEX idx_files_file_hash ON files(file_hash);
CREATE INDEX idx_files_doc_type ON files(doc_type);
CREATE INDEX idx_records_fingerprint ON records(fingerprint);
CREATE INDEX idx_records_file_id ON records(file_id);
CREATE INDEX idx_records_doc_type ON records(doc_type);
CREATE INDEX idx_records_ngay ON records(ngay);
CREATE INDEX idx_invoice_data_so_hoa_don ON invoice_data(so_hoa_don);
CREATE INDEX idx_invoice_data_mst ON invoice_data(mst);
CREATE INDEX idx_invoice_line_items_record_id ON invoice_line_items(record_id);
CREATE INDEX idx_bank_statement_data_stk ON bank_statement_data(stk);
CREATE INDEX idx_field_overrides_record_id ON field_overrides(record_id);
CREATE INDEX idx_field_overrides_status ON field_overrides(status);
CREATE INDEX idx_extraction_scripts_doc_type ON extraction_scripts(doc_type);
CREATE INDEX idx_file_script_assignments_file_id ON file_script_assignments(file_id);
CREATE INDEX idx_file_script_assignments_script_id ON file_script_assignments(script_id);
```

### 9.3 Full-Text Search

SQLite FTS5 virtual table for the smart search overlay:

```sql
CREATE VIRTUAL TABLE records_fts USING fts5(
  so_hoa_don,
  mst,
  ten_doi_tac,
  dia_chi_doi_tac,
  mo_ta,
  ten_ngan_hang,
  stk,
  content='',  -- external content mode
  tokenize='unicode61'
);
```

Updated on each insert/update to keep search index in sync.

---

## 10. Claude Code CLI Integration

### 10.1 Invocation

```bash
claude --print \
  --system-prompt "$(cat .invoicevault/extraction-prompt.md)" \
  "Process these accounting files and return structured JSON.

   Files:
   - bank-statements/vietcombank-2024-03.pdf
   - invoices-out/bang-ke-thang-3.xlsx
   - invoices-in/NCC-ABC-001.xml

   For each file:
   1. CLASSIFY: Determine document type (bank_statement, invoice_out_detailed,
      invoice_out_summary, invoice_in_detailed, invoice_in_summary)
   2. EXTRACT: Use the appropriate strategy:
      - PDF/images → vision-based extraction
      - XML/Excel/CSV → write a parsing script, execute it, return results
   3. VALIDATE: Apply type-specific rules (sequential order, total matching, etc.)
   4. SCORE: Confidence 0-1 per field and overall
   5. FINGERPRINT: Compute identity hash per record"
```

### 10.2 Multi-Step Agent Flow

```
Step 1: CLASSIFY
  Input:  file path + first N bytes / pages
  Output: doc_type enum (bank_statement, invoice_out, invoice_in)

Step 2: CHECK SCRIPT CACHE
  For XML/Excel/CSV files:
    → Run all cached matcher functions against the file
    → If a matcher returns true → reuse that script (skip to Step 3b)
    → If no matcher matches → proceed to Step 3a (generate new script)

Step 3a: EXTRACT (new file structure — no cached script)
  Strategy A (PDF/Image):
    → Read via vision, output structured fields
    → Extract both invoice-level (bảng kê) and line item (chi tiết) data
  Strategy B (XML/Excel/CSV — no matching script):
    → Inspect file structure (headers, sheets, XML schema)
    → Write a tailored parsing script (JS/Python)
    → Write a matcher function that identifies similar files
    → Execute the script
    → Cache both in .invoicevault/scripts/
    → Register in extraction_scripts table
    → Return parsed results

Step 3b: EXTRACT (cached script match)
  → Execute the matched cached script against the new file
  → Record the file→script assignment in file_script_assignments
  → If script fails or produces low-confidence results → fall back to Step 3a

Step 4: VALIDATE
  → Apply doc_type-specific rules:
    - invoice_out: check sequential order of số hóa đơn
    - invoice_out & invoice_in: check Σ chi tiết thành tiền = bảng kê tổng tiền
    - invoice_out: flag missing số hóa đơn
    - bank_statement: normalize Dr./Cr. direction

Step 5: SCORE
  → Per-field confidence (0-1)
  → Overall record confidence (weighted average)

Step 6: FINGERPRINT
  → Compute per doc_type formula (see §3)
```

### 10.3 Script Caching & Reuse System

When Claude Code processes a structured file (XML, Excel, CSV), it generates two artifacts:

**1. Parser Script** — e.g., `.invoicevault/scripts/vietcombank-xlsx-parser.js`
A standalone script that reads a file and outputs structured JSON matching the InvoiceVault schema.

**2. Matcher Function** — e.g., `.invoicevault/scripts/vietcombank-xlsx-matcher.js`
A function that takes a file path and returns `true/false` indicating whether the parser script is compatible with this file.

```javascript
// Example matcher function
// .invoicevault/scripts/vietcombank-xlsx-matcher.js
module.exports = async function match(filePath) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheetNames = workbook.SheetNames;
  
  // Check for Vietcombank-specific sheet structure
  if (!sheetNames.includes('Statement')) return false;
  
  const sheet = workbook.Sheets['Statement'];
  const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
  
  // Check for expected column headers
  const expectedHeaders = ['Ngày GD', 'Số CT', 'Diễn giải', 'Ghi nợ', 'Ghi có', 'Số dư'];
  const matchCount = expectedHeaders.filter(h => 
    headers.some(actual => actual?.toString().includes(h))
  ).length;
  
  return matchCount >= 4; // Match if 4+ of 6 expected headers found
};
```

**Script selection flow for a new file:**

```
New xlsx file detected
       │
       ▼
┌──────────────────────┐
│ Load all matcher      │
│ functions from        │
│ extraction_scripts    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐     match found
│ Run each matcher      │────────────────┐
│ against the new file  │                │
└──────────┬───────────┘                │
           │ no match                    ▼
           ▼                    ┌──────────────────┐
┌──────────────────────┐       │ Execute cached    │
│ Claude Code generates │       │ parser script     │
│ new parser + matcher  │       └──────────┬───────┘
└──────────┬───────────┘                  │
           │                              │
           ▼                              ▼
┌──────────────────────┐       ┌──────────────────┐
│ Cache in scripts/     │       │ Record assignment │
│ Register in DB        │       │ in file_script_   │
└──────────────────────┘       │ assignments       │
                                └──────────────────┘
```

This system learns over time: after processing a few Vietcombank statements, all future Vietcombank xlsx files are processed instantly via the cached script — no Claude Code invocation needed for the extraction step (though classification still runs).

### 10.4 Output Contract

```json
{
  "results": [
    {
      "file": "bank-statements/vietcombank-2024-03.pdf",
      "doc_type": "bank_statement",
      "status": "success",
      "records": [
        {
          "fingerprint": "a1b2c3...",
          "confidence": 0.94,
          "data": {
            "ten_ngan_hang": "Vietcombank",
            "stk": "0071000123456",
            "ngay": "2024-03-01",
            "mo_ta": "CK tu TK 0091000654321 - Thanh toan HD-001",
            "so_tien": -15000000,
            "ten_doi_tac": "Công ty TNHH ABC"
          },
          "field_confidence": {
            "stk": 0.99,
            "so_tien": 0.95,
            "mo_ta": 0.88
          },
          "warnings": []
        }
      ]
    },
    {
      "file": "invoices-out/bang-ke-thang-3.xlsx",
      "doc_type": "invoice_out",
      "status": "success",
      "script_generated": ".invoicevault/scripts/bang-ke-thang-3-parser.js",
      "matcher_generated": ".invoicevault/scripts/bang-ke-thang-3-matcher.js",
      "records": [
        {
          "fingerprint": "d4e5f6...",
          "confidence": 0.96,
          "data": {
            "ngay": "2024-03-01",
            "so_hoa_don": "HD-001",
            "tong_tien": 11000000,
            "mst": "0101234567",
            "ten_doi_tac": "Công ty CP XYZ",
            "dia_chi_doi_tac": "123 Nguyễn Huệ, Q1, HCM"
          },
          "line_items": [
            {
              "mo_ta": "Dịch vụ tư vấn",
              "don_gia": 5000000,
              "so_luong": 2,
              "thue_suat": 10,
              "thanh_tien": 10000000
            },
            {
              "mo_ta": "Phí vận chuyển",
              "don_gia": 1000000,
              "so_luong": 1,
              "thue_suat": 10,
              "thanh_tien": 1000000
            }
          ],
          "field_confidence": { "...": "..." },
          "warnings": []
        }
      ],
      "validation": {
        "sequential_order": "pass",
        "detail_total_match": "pass"
      }
    }
  ]
}
```

---

## 11. User Experience

### 11.1 Initialization

**Via CLI:**
```
$ invoicevault init ~/Documents/KeToan2024
→ Created .invoicevault/ in ~/Documents/KeToan2024
→ Indexed 156 files (89 PDF, 23 XML, 31 XLSX, 8 CSV, 5 JPG)
→ Vault ready. Launch InvoiceVault app to start processing.
```

**Via tray app:** Settings → "Initialize New Vault..." → folder picker → done.

### 11.2 System Tray

**Icon states:**

| Icon | State | Meaning |
|---|---|---|
| 🟢 | Idle | Watching, no activity |
| 🔵 | Processing | Claude Code running extraction |
| 🟡 | Needs review | Low-confidence records or field conflicts |
| 🔴 | Error | Processing failure |

**Context menu:**
- Open Vault Folder
- View Recent Activity (log window)
- Process Now (manual trigger for all pending files)
- Export to Excel...
- Settings
  - Confidence threshold (default: 0.8)
  - File type filters
  - Claude Code CLI path
  - Global hotkey configuration
  - Ignored paths (`.invoicevaultignore`)
- Quit

### 11.3 Notifications

| Event | Notification |
|---|---|
| Batch complete | "✅ 12 records extracted from 5 files" |
| Low confidence | "⚠️ 3 records need review (confidence < 80%)" |
| Field conflicts | "⚠️ 3 field conflicts after re-processing bang-ke-thang-3.xlsx" |
| Validation warning | "⚠️ Sequential gap detected: HD-005 missing between HD-004 and HD-006" |
| File deleted | "🗑️ invoice-003.pdf removed — 1 record archived" |
| Error | "❌ Failed to process vietcombank-2024-03.pdf" |

### 11.4 Search & Edit Overlay

See §6 and §7 for full details. Summary:

- **Trigger:** Right-click folder → "Search InvoiceVault" (native context menu) or global hotkey
- **Search:** Smart unified input — free text, field queries, filters, date/amount ranges
- **Results:** Scrollable list with key fields, file path, confidence
- **Edit:** Click record → inline form → edit fields → auto-lock → conflict detection on re-extraction

---

## 12. MVP Scope (Week 1 — Proof of Concept)

### In Scope

| Feature | Detail |
|---|---|
| Electron tray app | System tray with status icon, context menu, notifications. macOS + Windows. |
| Vault initialization | `.invoicevault/` creation with config.json + vault.db |
| Folder watcher | chokidar-based, recursive, debounced, hash-based change detection |
| Claude Code CLI | Spawn `claude --print` as child process, batch mode |
| Document classification | Auto-detect document type via Claude Code |
| PDF extraction | Vietnamese hóa đơn GTGT and bank statements (vision-based) |
| SQLite storage | All core tables: files, extraction_batches, records, extension tables, invoice_line_items, field_overrides |
| Fingerprint diffing | Basic fingerprint computation + diff on re-extraction |
| Soft delete | On file deletion, soft-delete file + linked records |
| Confidence scoring | Per-field and overall, threshold-based flagging |
| Basic search | Global hotkey → simple text search overlay (no native context menu yet) |

### Out of Scope for MVP

| Feature | Phase |
|---|---|
| Native Finder/Explorer context menu integration | Phase 2 |
| XML/Excel/CSV extraction (script generation) | Phase 2 |
| Script caching | Phase 2 |
| Inline editing + field locking + conflicts | Phase 2 |
| Smart search (structured filters, amount ranges) | Phase 2 |
| Rename/move detection | Phase 2 |
| Validation rules (sequential order, total matching) | Phase 2 |
| Export to Excel | Phase 3 |
| Multiple vault support | Phase 3 |
| Auto-start on boot | Phase 3 |

---

## 13. Post-MVP Roadmap

### Phase 2 — Weeks 2–3: Full Extraction + Edit

- XML e-invoice parsing via generated scripts
- Excel/CSV extraction via generated scripts (with multi-sheet support for bảng kê + chi tiết)
- **Script caching system**: parser + matcher function generation, script registry DB tables, matcher evaluation for new files, script reuse tracking
- Inline editing in search overlay
- Field locking + conflict detection
- Fingerprint-based diff/reconciliation for multi-record files
- Rename/move detection via hash matching
- Validation rules (sequential order, Σ chi tiết = bảng kê total, missing invoice number flagging)
- Native Finder Extension (macOS) + Shell Extension (Windows) for context menu search
- Smart search: structured filters, date ranges, amount ranges, doc type filters

### Phase 3 — Weeks 4–6: Polish + Export

- Export to Excel/CSV (all records or filtered)
- Multiple vault support (watch several initialized folders)
- Auto-start on system boot
- Processing history dashboard (in overlay)
- Batch reprocessing (re-extract all files or selected files)
- `.invoicevaultignore` file support

### Phase 4 — Future

- Configurable extraction schemas (user-defined fields per doc type)
- Additional document types beyond the initial 5
- Integration with Vietnamese accounting software (MISA, Fast Accounting)
- Duplicate detection across files (same invoice in PDF + xlsx bảng kê)
- MST validation against government tax portal API
- Cross-document validation (bảng kê totals vs. chi tiết totals across files)
- Reporting and analytics dashboard

---

## 14. Technical Stack

| Component | Technology |
|---|---|
| Desktop framework | Electron |
| Language | TypeScript |
| File watcher | chokidar |
| Database | better-sqlite3 + FTS5 |
| AI agent | Claude Code CLI (child_process.spawn) |
| UI (overlay) | React (frameless BrowserWindow) |
| macOS extension | FinderSync API (Swift/Objective-C) |
| Windows extension | Shell Extension (C++ or Rust) |
| Build/package | electron-builder |
| Target platforms | macOS (arm64 + x64), Windows (x64) |

---

## 15. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Claude Code CLI not installed on user machine | App non-functional | Startup check, guided setup, validate `claude --version` |
| Large batch processing is slow | Poor UX | Sub-batch queuing, progress in tray, notifications on complete |
| AI extraction accuracy varies by format | Bad data | Confidence scoring, field locking, human review flow |
| Finder/Shell Extension complexity | Delayed timeline | Defer to Phase 2, use global hotkey as MVP fallback |
| Multi-record file diffing edge cases | Data loss/duplication | Conservative soft-delete, fingerprint-based identity, audit logging |
| Field lock conflicts accumulate | User fatigue | Batch conflict resolution UI, notification grouping |
| Bank statement format varies per bank | Inconsistent extraction | Claude Code adapts per bank, cache bank-specific scripts |
| Script matcher false positives | Wrong script applied to file | Confidence check after script execution, fallback to fresh extraction if low |
| Cross-platform path handling | Bugs on Windows | Consistent `path.join()`, CI testing on both OS |
| SQLite FTS5 index size on large vaults | Performance | Incremental FTS updates, periodic optimize |
| File watcher performance on 10k+ files | High CPU | Debounce, extension filter, `.invoicevaultignore` |

---

## 16. Open Questions

1. **Claude Code CLI exact flags** — Need to validate `--print`, `--system-prompt`, piped mode, and batch behavior. What are the token/context limits per session?
2. **Concurrent vault support** — Should the tray app support multiple vaults from Day 1, or single vault only?
3. **Offline handling** — When Claude Code CLI can't reach the API: queue and retry? notify? how long to retry?
4. **Max batch size** — How many files per CLI session before splitting? What's the practical limit?
5. **Conflict resolution UX** — Should conflicts auto-expire after N days? Should there be a "trust AI" mode that disables locking?
6. **Cross-file duplicate detection** — Same invoice appears in PDF (single) and xlsx (bảng kê). How to handle? Flag both? Link them?
7. **Bank Dr./Cr. normalization** — Should the user configure their company's accounts so the system knows how to flip Dr./Cr., or should Claude Code infer it?
8. **Native extension signing** — Finder Extensions require Apple Developer signing. Shell Extensions need code signing for trust. Budget for certificates?

---

*End of document.*
