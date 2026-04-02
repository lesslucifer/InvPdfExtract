# Phase 3 — System Tray & Notifications

> **Goal:** The app lives in the system tray with status indicators and desktop notifications for extraction events.
> **Output:** Tray icon shows processing state (idle/processing/review/error), context menu provides vault actions, notifications fire on extraction completion.

---

## Tasks

### 3.1 System tray setup
- Create `TrayManager` service in main process
- Tray icon states (PRD §11.2):
  | State | Icon | Meaning |
  |-------|------|---------|
  | Idle | Green dot | Watching, no activity |
  | Processing | Blue dot | Claude Code running |
  | Needs review | Yellow dot | Low-confidence or conflicts |
  | Error | Red dot | Processing failure |
- Prepare icon assets: 4 states x 2 platforms (macOS template images + Windows .ico)
- Icon state driven by `ExtractionQueue` events

### 3.2 Context menu
- Menu items (PRD §11.2):
  - **Open Vault Folder** — `shell.openPath(vaultRoot)`
  - **View Recent Activity** — opens a small log window (simple HTML)
  - **Process Now** — manually trigger extraction for all `pending` files
  - ---
  - **Settings** submenu:
    - Confidence threshold (show current value)
    - Claude Code CLI path
    - Global hotkey (display only for now, editable in Phase 4)
  - ---
  - **Quit** — `app.quit()`
- "Export to Excel" and "Initialize New Vault" deferred to later phases

### 3.3 Desktop notifications
- Use Electron `Notification` API
- Events to notify (PRD §11.3):
  | Event | Message pattern |
  |-------|----------------|
  | Batch complete | "N records extracted from M files" |
  | Low confidence | "N records need review (confidence < 80%)" |
  | File deleted | "filename removed — N records archived" |
  | Error | "Failed to process filename" |
- Notifications are non-blocking, clicking them is a no-op for now (deep link in Phase 4)

### 3.4 Vault initialization flow (tray-based)
- On first launch with no vault configured:
  - Show a native dialog: "Select a folder to initialize as an InvoiceVault"
  - Run `VaultManager.init()` on the selected folder
  - Store vault path in Electron `app.getPath('userData')/app-config.json`
- On subsequent launches: auto-load the configured vault

### 3.5 Event bus
- Create a simple typed EventEmitter for inter-service communication:
  - `extraction:started`, `extraction:completed`, `extraction:error`
  - `file:added`, `file:changed`, `file:deleted`
  - `review:needed`
- TrayManager and NotificationManager subscribe to relevant events

---

## Acceptance Criteria
- [ ] App starts with a tray icon (green/idle state)
- [ ] Tray icon changes to blue during extraction, returns to green on completion
- [ ] Tray icon turns yellow when records need review
- [ ] Context menu opens with all listed items
- [ ] "Open Vault Folder" opens the correct directory in Finder/Explorer
- [ ] "Process Now" triggers extraction for pending files
- [ ] Desktop notification appears after extraction batch completes
- [ ] First launch prompts for vault folder selection
