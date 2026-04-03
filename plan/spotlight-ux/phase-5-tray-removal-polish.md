# Phase 5 — Tray Removal, E2E Tests & Polish

## Goal

Remove the system tray entirely. The overlay is now the sole UI. Add E2E tests covering the full user journey. Cross-platform polish and visual QA.

## Practical Value

After this phase:
- The app is fully overlay-driven — no tray icon, no context menus, no secondary windows
- E2E test suite validates the core workflows: vault init → browse → search → filter → export
- The app is ready for distribution on macOS, Windows, and Linux

## Tasks

### 5.1 Remove Tray (`src/main/tray.ts`, `src/main.ts`)

**Delete** `src/main/tray.ts`.

In `src/main.ts`:
- Remove `TrayManager` import and initialization
- Remove all `trayManager` references
- Remove `trayManager.setVaultPath()` calls from `startVault`/`stopVault`
- Keep the `app.dock.hide()` on macOS (still a background app, activated by hotkey)
- The overlay now auto-shows on first launch if no vault is configured (No Vault screen)

Since `handleInitVault`, `handleProcessNow`, `handleReprocessAll`, `handleSwitchVault`, `handleQuit` are already passed as callbacks to `OverlayWindow` (from Phase 1), they just lose the tray as a caller.

### 5.2 Auto-Show Overlay on Launch

In `src/main.ts`, after `app.on('ready')`:
- If no vault configured → show overlay immediately (No Vault screen)
- If vault exists → overlay stays hidden until hotkey (current behavior)

Add IPC handler `hide-overlay` for the renderer to request hiding (needed for Escape cascade final step).

### 5.3 Remove Activity Log Window

The `showActivityLog()` method in `TrayManager` created a secondary `BrowserWindow`. This is removed with the tray. If activity logging is needed, it can be added to Settings in a future iteration (out of scope for this epic).

### 5.4 Status Indicator (Minimal)

The tray icon showed processing status via icon color changes. Without the tray, add a minimal status dot to the overlay header:

- Small colored dot next to the gear icon: green (idle), blue-pulse (processing), orange (review), red (error)
- Subscribe to eventBus events in the renderer via IPC forwarding:
  - Main process sends `overlay-status-update` events to renderer
  - Renderer shows the dot

This is a small scope addition that prevents "is it processing?" confusion.

### 5.5 E2E Test Setup

Install Playwright with Electron support:

```bash
yarn add -D @playwright/test playwright
```

Create `e2e/` directory with:
- `e2e/playwright.config.ts` — Electron launch config
- `e2e/fixtures.ts` — test fixtures for launching the app, creating temp vaults

Electron E2E approach:
- Use `electron` as the browser in Playwright
- Launch with `_electron.launch({ args: ['.webpack/main'] })`
- Access the overlay window via `electronApp.firstWindow()`

### 5.6 E2E Test: First Launch → Vault Init

`e2e/vault-init.spec.ts`:
1. Launch app with clean config (no `lastVaultPath`)
2. Verify No Vault screen is visible
3. Mock `dialog.showOpenDialog` to return a temp directory
4. Click "Choose Folder..."
5. Verify vault is initialized (`.invoicevault/` exists)
6. Verify transition to Home screen

### 5.7 E2E Test: Search & Filter

`e2e/search-filter.spec.ts`:
1. Launch with pre-seeded vault (fixtures insert test records)
2. Open overlay via hotkey
3. Type search query → verify results appear
4. Type `type:out` → verify pill appears, input text is clean
5. Verify results are filtered by doc type
6. Click ✕ on pill → verify filter removed, results update
7. Press Escape → verify text cleared
8. Press Escape again → verify overlay hides

### 5.8 E2E Test: Folder Browse & Export

`e2e/browse-export.spec.ts`:
1. Launch with pre-seeded vault (records in multiple folders)
2. Open overlay → verify Home screen shows folders
3. Click [→] on a folder → verify browse mode shows records
4. Verify breadcrumb bar shows folder path
5. Click export button → mock folder picker → verify CSV files created
6. Verify exported files contain only records from the scoped folder

### 5.9 E2E Test: Settings

`e2e/settings.spec.ts`:
1. Open overlay → click gear icon → verify Settings panel
2. Verify current vault is displayed
3. Click "Add Vault" → mock dialog → verify vault added
4. Click "Switch" on another vault → verify switch
5. Click back → verify return to previous state

### 5.10 Cross-Platform Visual Polish

Review and fix:
- **Windows**: overlay shadow rendering (transparent windows can have issues), DPI scaling, font rendering
- **Linux**: compositor-dependent transparency, verify `alwaysOnTop` works on various DEs (GNOME, KDE)
- **macOS**: verify overlay appears above fullscreen apps (`visibleOnFullScreen: true` already set)

CSS adjustments:
- Ensure `scrollbar-width: thin` fallback for non-WebKit
- Test dark mode toggle on all platforms
- Verify icon rendering (emoji vs system font differences)

### 5.11 Package.json Scripts

Add test scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test --config e2e/playwright.config.ts"
  }
}
```

### 5.12 Clean Up Old Plan Reference

- Move `plan/phase-8-overlay-redesign-PRD.md` to `plan/spotlight-ux/PRD.md` (already done)
- Remove the old file
- Update any references

## Files Changed

| File | Change |
|------|--------|
| `src/main/tray.ts` | **Delete** |
| `src/main.ts` | Remove tray init, add auto-show on first launch, add `hide-overlay` IPC |
| `src/main/overlay-window.ts` | Add `hide-overlay` handler, add status event forwarding |
| `src/components/SearchOverlay.tsx` | Add status dot in header |
| `src/index.css` | Status dot styles, cross-platform scrollbar, polish |
| `e2e/playwright.config.ts` | **New file** |
| `e2e/fixtures.ts` | **New file** |
| `e2e/vault-init.spec.ts` | **New file** |
| `e2e/search-filter.spec.ts` | **New file** |
| `e2e/browse-export.spec.ts` | **New file** |
| `e2e/settings.spec.ts` | **New file** |
| `package.json` | Add Playwright dep, test scripts |
| `plan/phase-8-overlay-redesign-PRD.md` | **Delete** (moved to `plan/spotlight-ux/PRD.md`) |

## Tests

This phase is primarily about testing. In addition to the E2E tests described above:

### Regression Unit Tests

- Re-run all existing unit tests from Phases 1-4 to ensure tray removal didn't break anything
- Verify IPC handlers still work without tray callbacks

### Smoke Tests

- [ ] App launches on macOS, shows overlay
- [ ] App launches on Windows, shows overlay
- [ ] App launches on Linux (Ubuntu), shows overlay
- [ ] Hotkey works on all platforms
- [ ] Dark mode works on all platforms

## Acceptance Criteria

- [ ] No tray icon appears on any platform
- [ ] App auto-shows No Vault screen on first launch
- [ ] All tray features are accessible from the overlay (init, switch, export, reprocess, quit)
- [ ] Status indicator shows processing state in the overlay header
- [ ] E2E test: vault init flow passes
- [ ] E2E test: search and filter flow passes
- [ ] E2E test: folder browse and export flow passes
- [ ] E2E test: settings flow passes
- [ ] All unit tests from Phases 1-4 still pass
- [ ] App compiles and runs on macOS, Windows, Linux
- [ ] No regressions in existing search, editing, or conflict resolution features
- [ ] `yarn test` runs unit tests, `yarn test:e2e` runs E2E tests
