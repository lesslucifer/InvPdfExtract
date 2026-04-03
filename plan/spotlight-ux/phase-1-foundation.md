# Phase 1 — Foundation: State Machine, Types & Settings

## Goal

Replace the monolithic `SearchOverlay` component with a state-machine-driven overlay that can render 4 distinct views. Wire up new IPC handlers and types. Build the Settings panel (State 4) as the first new view — it has the least dependency on other new features and replaces tray functionality early.

## Practical Value

After this phase, the user can:
- Open settings from the overlay via the gear icon
- Switch vaults, add new vaults, disconnect vaults — all from the overlay
- See Claude CLI status
- Quit the app from the overlay
- Initialize a vault from the No Vault screen (first-launch experience)

The tray still exists in parallel (removed in Phase 5), so nothing breaks during development.

## Tasks

### 1.1 New Types (`src/shared/types/index.ts`)

Add:

```typescript
// Overlay state enum
enum OverlayState {
  NoVault = 'no-vault',
  Home = 'home',
  Search = 'search',
  Settings = 'settings',
}

// Folder listing
interface FolderInfo {
  path: string;           // relative to vault root
  recordCount: number;
  lastActive: string;     // ISO datetime
}

// Filter state (used across phases)
interface SearchFilters {
  text?: string;
  folder?: string;
  docType?: string;
  status?: string;
  amountMin?: number;
  amountMax?: number;
  dateFilter?: string;
}

// Aggregation stats
interface AggregateStats {
  totalRecords: number;
  totalAmount: number;
}

// Extend InvoiceVaultAPI with new methods
interface InvoiceVaultAPI {
  // ... existing methods stay ...
  getAppConfig: () => Promise<AppConfig>;
  initVault: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  switchVault: (vaultPath: string) => Promise<{ success: boolean }>;
  removeVault: (vaultPath: string) => Promise<void>;
  pickFolder: () => Promise<string | null>;
  openFolder: (relativePath: string) => Promise<void>;
  listRecentFolders: (limit?: number) => Promise<FolderInfo[]>;
  listTopFolders: () => Promise<FolderInfo[]>;
  getAggregates: (filters: SearchFilters) => Promise<AggregateStats>;
  exportFiltered: (filters: SearchFilters, destPath: string) => Promise<{ filesWritten: string[] }>;
  checkClaudeCli: () => Promise<{ available: boolean; version?: string }>;
  reprocessAll: () => Promise<{ count: number }>;
  quitApp: () => Promise<void>;
}
```

### 1.2 IPC Handlers — Settings & Vault Management (`src/main/overlay-window.ts`)

Add these IPC handlers to `registerIpcHandlers()`:

| Channel | Implementation |
|---------|---------------|
| `get-app-config` | Return `loadAppConfig()` |
| `init-vault` | Validate path → `initVault()` or `openVault()` → update `AppConfig` → call `startVault()` via callback |
| `switch-vault` | Call `startVault()` callback → update `lastVaultPath` |
| `remove-vault` | Remove from `vaultPaths[]` → if active, stop vault → if none left, signal no-vault state |
| `pick-folder` | `dialog.showOpenDialog({ properties: ['openDirectory'] })` → return path or null |
| `open-folder` | `shell.openPath(path.join(vaultPath, relativePath))` |
| `check-claude-cli` | `ClaudeCodeRunner.isAvailable()` + version detection |
| `reprocess-all` | Reuse logic from `handleReprocessAll()` in main.ts |
| `quit-app` | Clean shutdown (same as `handleQuit()`) |

The vault management handlers need access to `startVault`/`stopVault` — either pass callbacks into `OverlayWindow` or move vault lifecycle into the class.

**Design decision**: Keep vault lifecycle in `main.ts`, pass callbacks to `OverlayWindow`:

```typescript
interface OverlayCallbacks {
  onInitVault: (path: string) => Promise<void>;
  onSwitchVault: (path: string) => Promise<void>;
  onStopVault: () => Promise<void>;
  onReprocessAll: () => void;
  onQuit: () => Promise<void>;
}
```

### 1.3 Preload Bridge (`src/preload.ts`)

Add all new API methods matching the extended `InvoiceVaultAPI`.

### 1.4 State Machine (`src/components/SearchOverlay.tsx`)

Rewrite as state-machine orchestrator:

```tsx
const SearchOverlay: React.FC = () => {
  const [overlayState, setOverlayState] = useState<OverlayState>(OverlayState.Home);
  const [previousState, setPreviousState] = useState<OverlayState>(OverlayState.Home);

  // On mount: check if vault exists
  useEffect(() => {
    window.api.getAppConfig().then(config => {
      if (!config.lastVaultPath || config.vaultPaths.length === 0) {
        setOverlayState(OverlayState.NoVault);
      }
    });
  }, []);

  // Transition helper
  const goTo = (state: OverlayState) => {
    setPreviousState(overlayState);
    setOverlayState(state);
  };

  switch (overlayState) {
    case OverlayState.NoVault:
      return <NoVaultScreen onVaultCreated={() => goTo(OverlayState.Home)} />;
    case OverlayState.Home:
      return <HomeScreen onSettingsClick={() => goTo(OverlayState.Settings)} ... />;
    case OverlayState.Search:
      return <SearchScreen onSettingsClick={() => goTo(OverlayState.Settings)} ... />;
    case OverlayState.Settings:
      return <SettingsPanel onBack={() => goTo(previousState)} />;
  }
};
```

The existing search logic (debounce, results, keyboard nav) moves into `SearchScreen`.

### 1.5 No Vault Screen (`src/components/NoVaultScreen.tsx`)

New component. Simple centered layout:
- App title
- Description text
- "Choose Folder..." button → calls `pickFolder()` then `initVault()`
- Error display for edge cases (not writable, already inside vault)

### 1.6 Settings Panel (`src/components/SettingsPanel.tsx`)

New component matching PRD Section 6:
- Current vault display with `[Open]` and `[Disconnect]`
- Other vaults list with `[Switch]`
- `[+ Add Vault]` button
- `[Reprocess All Files]` with confirmation
- Claude CLI status
- `[Quit InvoiceVault]` button
- Back navigation (← icon + Escape key)

### 1.7 Gear Icon in Search Input (`src/components/SearchInput.tsx`)

Add `onGearClick` prop. Render a `⚙` button after the clear button.

### 1.8 CSS (`src/index.css`)

Add styles for:
- `.no-vault-screen` — centered flex layout
- `.settings-panel` — section layout with dividers
- `.settings-vault-row` — vault path with action buttons
- `.gear-icon` — styled button in search bar
- `.overlay-header` — search input + gear wrapper (reusable across states)

## Files Changed

| File | Change |
|------|--------|
| `src/shared/types/index.ts` | Add `OverlayState`, `FolderInfo`, `SearchFilters`, `AggregateStats`; extend `InvoiceVaultAPI` |
| `src/main/overlay-window.ts` | Add `OverlayCallbacks`, 9 new IPC handlers |
| `src/main.ts` | Create `OverlayCallbacks`, pass to `OverlayWindow` |
| `src/preload.ts` | Add new API methods |
| `src/components/SearchOverlay.tsx` | Rewrite as state machine, extract search logic |
| `src/components/SearchInput.tsx` | Add gear icon |
| `src/components/NoVaultScreen.tsx` | **New file** |
| `src/components/SettingsPanel.tsx` | **New file** |
| `src/index.css` | New styles for no-vault, settings, gear icon |

## Tests

### Unit Tests

- **`src/components/__tests__/NoVaultScreen.test.tsx`** — renders setup screen, calls `pickFolder` + `initVault` on button click, shows error on invalid folder
- **`src/components/__tests__/SettingsPanel.test.tsx`** — renders current vault, lists other vaults, switch/add/remove actions, quit button, back navigation
- **`src/components/__tests__/SearchOverlay.test.tsx`** — state transitions: NoVault → Home on vault init, Home → Settings on gear click, Settings → Home on back

### IPC Handler Tests

- **`src/main/__tests__/overlay-ipc.test.ts`** — mock better-sqlite3, test `get-app-config`, `init-vault` (success + error paths), `switch-vault`, `remove-vault`, `pick-folder`, `check-claude-cli`, `reprocess-all`

## Acceptance Criteria

- [ ] Overlay shows No Vault screen on first launch (no `lastVaultPath`)
- [ ] User can pick a folder and initialize a vault entirely from the overlay
- [ ] After vault init, overlay transitions to Home state (content from Phase 2; for now show search input)
- [ ] Gear icon visible in search bar; clicking it opens Settings
- [ ] Settings shows current vault path, other vaults, switch/add/disconnect buttons
- [ ] Reprocess All shows confirmation, then resets files to pending
- [ ] Claude CLI status is displayed (found/not found)
- [ ] Quit button cleanly shuts down the app
- [ ] Escape in Settings returns to previous state
- [ ] All unit tests pass
- [ ] App still compiles and runs with tray in parallel (no regressions)
