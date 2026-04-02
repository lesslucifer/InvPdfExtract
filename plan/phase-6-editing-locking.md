# Phase 6 — Inline Editing, Field Locking & Conflict Resolution

> **Goal:** Users can correct AI extraction mistakes in the search overlay, with edits protected from being overwritten on re-extraction.
> **Output:** Click a record → edit a field → field gets locked icon → re-extract the file → locked field preserved, conflict shown if AI disagrees.

---

## Tasks

### 6.1 Inline edit form
- Extend `ResultDetail` component (from Phase 4) with edit capability:
  - Each field becomes an editable input on click
  - Save button per-field or form-level save
  - Cancel reverts to stored value
- Different field types: text input, number input, date picker
- Visual states per field (PRD §7.3):
  | State | Visual |
  |-------|--------|
  | Normal | No indicator — AI-extracted value |
  | Locked | Lock icon — user-edited, protected |
  | Conflict | Warning icon — AI disagrees after re-extraction |

### 6.2 Field override storage
- IPC: `window.api.saveFieldOverride({ recordId, tableName, fieldName, userValue })`
- Main process handler:
  1. Update the field value in the extension table (`invoice_data`, `bank_statement_data`, or `invoice_line_items`)
  2. Create/update row in `field_overrides` table:
     - `user_value` = new value
     - `ai_value_at_lock` = current AI value being replaced
     - `status` = `locked`
     - `locked_at` = now
  3. Update FTS5 index if the edited field is searchable

### 6.3 Conflict detection in reconciler
- Upgrade `Reconciler` to respect field locks on re-extraction:
  - **Normal fields:** Overwrite with new AI value (existing behavior)
  - **Locked fields:** Keep user value. If new AI value differs from `ai_value_at_lock`:
    - Update `field_overrides.ai_value_latest` with new AI value
    - Set `status` = `conflict`
    - Set `conflict_at` = now
  - Track conflict count per extraction batch

### 6.4 Conflict resolution UI
- In the expanded record view, conflict fields show:
  - User's value (current)
  - AI's new suggestion
  - Two action buttons: "Keep mine" / "Accept AI"
- **Keep mine:** Dismiss conflict, status back to `locked`, clear `ai_value_latest`
- **Accept AI:** Unlock field, overwrite with AI value, set `resolved_at`, remove override
- Batch resolution: "Accept all AI suggestions" / "Keep all my edits" for a record

### 6.5 Conflict notifications
- After re-extraction with conflicts:
  - Desktop notification: "N field conflicts after re-processing {filename}"
  - Tray icon → yellow (needs review)
  - Conflicts searchable via `status:conflict` in overlay

### 6.6 Smart search filters
- Extend search to support structured queries (PRD §6.3):
  | Filter | Example | Implementation |
  |--------|---------|---------------|
  | `type:bank` / `type:hdra` / `type:hdv` | Filter by doc_type | WHERE clause |
  | `status:review` / `status:conflict` | Filter by status | JOIN field_overrides |
  | `in:subfolder` | Scope to folder | WHERE relative_path LIKE |
  | `>10000000` or `5tr-10tr` | Amount range | WHERE tong_tien/so_tien BETWEEN |
  | `2024-03` | Date filter | WHERE ngay LIKE / BETWEEN |
- Parse query string to extract filters, remaining text → FTS5

---

## Acceptance Criteria
- [ ] Clicking a field in expanded record view makes it editable
- [ ] Saving an edit creates a `field_overrides` row with status `locked`
- [ ] Locked fields show a lock icon in the UI
- [ ] Re-extracting a file preserves locked field values
- [ ] If AI disagrees on re-extraction, field shows conflict state with both values
- [ ] "Keep mine" resolves conflict and preserves user value
- [ ] "Accept AI" resolves conflict and overwrites with AI value
- [ ] Desktop notification fires when conflicts are created
- [ ] `status:conflict` search filter returns records with unresolved conflicts
- [ ] `type:bank`, amount ranges, and date filters work in search
