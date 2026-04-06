# React Query Migration Plan

## Goal

Replace the scattered `useEffect` + `useState(loading/data/error)` + manual-reload-after-mutation pattern with React Query for all SQLite read/write operations in the renderer. Keep Zustand for UI/navigation state and IPC event subscriptions.

## Architecture After Migration

```
SQLite (main process)
  ↕ IPC (window.api)
React Query (renderer — data layer)
  ← queries defined via queryHook builder (src/lib/queries.ts)
  ← mutations defined via mutationHook builder (src/lib/mutations.ts)
  ← invalidated by processingStore (Zustand) on IPC push events
Zustand stores (renderer — UI/navigation state)
  processingStore   → owns push event subscriptions, triggers invalidation
  overlayStore      → navigation, windowlized state (unchanged)
  searchStore       → search UI state + doSearch() (unchanged)
  pathSearchStore   → path search state (unchanged)
  presetStore       → preset selection UI state (unchanged)
```

### QueryHook / MutationHook Pattern

All queries and mutations are defined at **module level** using the `queryHook`/`mutationHook` builders from `src/lib/queryHook.ts` and `src/lib/mutationHook.ts`. Never use raw `useQuery`/`useMutation` in components.

```typescript
// src/lib/queries.ts — query definitions
const usePresets = queryHook
  .ofKey<void, ['presets']>(() => ['presets'] as const)
  .useQuery(() => ({ queryFn: () => window.api.listPresets() }))
  .create();

// src/lib/mutations.ts — mutation definitions
const useDeletePreset = mutationHook
  .mutate<string>(id => window.api.deletePreset(id))
  .onSuccess(() => usePresets.invalidate());

// Component usage
const { data: presets = [] } = usePresets();
const deletePreset = useDeletePreset();
deletePreset.mutate(id);

// Static invalidation (outside React or in callbacks)
usePresets.invalidate();
useAppConfig.invalidate();
```

**When to use `mutationHook` vs static `.invalidate()`:**
- Use `mutationHook` when the component owns the IPC call (mutation fn + invalidation in one place)
- Use static `.invalidate()` when the parent owns the IPC call (e.g. `onDeletePreset` prop) or when the IPC returns `{ success }` and needs conditional logic before invalidation

### Query Key Namespace

| Key | Data | Hook |
|---|---|---|
| `['appConfig']` | `getAppConfig()` | `useAppConfig` |
| `['cliStatus']` | `checkClaudeCli()` | `useCliStatus` |
| `['presets']` | `listPresets()` | `usePresets` |
| `['homeData']` | `listRecentFolders + listTopFolders + getAggregates` | `useHomeData` |
| `['folderStatuses']` | `getFolderStatuses()` | `useFolderStatuses` |
| `['queue']` | `getFilesByStatuses + getJeQueueItems` | `useQueueData` |
| `['processed']` | `getProcessedFilesWithStats()` | `useProcessedData` |
| `['errors']` | `getErrorLogsWithPath + getJeErrorItems` | `useErrorData` |
| `['resultDetail', id]` | `getFieldOverrides + getJournalEntries` | `useResultDetail` |
| `['lineItems', id]` | `getLineItems + getLineItemOverrides` | `useLineItems` |

### `staleTime` Strategy

Use `staleTime: Infinity` globally — SQLite data only changes via explicit IPC mutations or push events. No background refetching. Also disable `refetchOnWindowFocus` and `refetchOnReconnect` — Electron tray app triggers focus events frequently. Invalidate explicitly:
- After mutations: `useXxx.invalidate()` or `mutationHook.onSuccess(() => useXxx.invalidate())`
- On push events: `processingStore` calls `useXxx.invalidate()` after IPC push events

### `QueryClient` Placement

- Singleton exported from `src/lib/queryClient.ts`
- Injected into `QueryHookContext` via `setQueryHookContext({ queryClient })` in `App.tsx` (before render)
- This enables static methods (`.invalidate()`, `.prefetch()`, `.setData()`, `.getCachedData()`) on all query hooks

---

## What to Skip / Never Migrate

- `searchStore.doSearch()` — user-initiated search with Zustand-owned pagination state; React Query would conflict
- `processingStore` IPC subscriptions — push events (pub/sub), not pull queries
- `NoVaultScreen.handleChooseFolder()` — one-shot init flow, plain `await` is correct
- All main-process code — React Query is renderer-only
- Window/app control calls (`hideOverlay`, `quitApp`, `openFile`) — side effects, nothing to cache

---

## Phases

### Phase A — Setup + Easy Wins ✅

**Goal:** Install infrastructure, prove pattern works on simple components.

**Completed:**
1. ✅ Installed `@tanstack/react-query`
2. ✅ Created `src/lib/queryClient.ts` — singleton `QueryClient` with `staleTime: Infinity`, `retry: 1`
3. ✅ Wrapped app in `QueryClientProvider` in `src/App.tsx`
4. ✅ Wired `queryClient` into `QueryHookContext` via `setQueryHookContext()` in `App.tsx`
5. ✅ Created `src/lib/queries.ts` with `useAppConfig`, `useCliStatus`, `usePresets` using `queryHook` builder
6. ✅ Created `src/lib/mutations.ts` with `useDeletePreset` using `mutationHook` builder
7. ✅ Refactored `PresetList` — uses `usePresets()` hook + `usePresets.invalidate()` for delete
8. ✅ Refactored `SettingsPanel` — uses `useAppConfig()` + `useCliStatus()` hooks, vault mutations use `useAppConfig.invalidate()` after conditional `result.success` check

**Lessons:**
- IPC calls returning `{ success }` don't fit `mutationHook` — use static `.invalidate()` with manual await
- When parent owns the IPC call via prop, use static `.invalidate()` in child — avoid double-calling
- `setQueryHookContext()` must run before any component renders (module-level in App.tsx)

---

### Phase B — Medium Components

**Goal:** Replace version-counter `useEffect` refresh loops with query invalidation.

**Steps:**
1. Add to `src/lib/queries.ts`:
   ```typescript
   const useHomeData = queryHook
     .ofKey<void, ['homeData']>(() => ['homeData'] as const)
     .useQuery(() => ({ queryFn: () => Promise.all([...]).then(...) }))
     .create();

   const useFolderStatuses = queryHook
     .ofKey<void, ['folderStatuses']>(() => ['folderStatuses'] as const)
     .useQuery(() => ({ queryFn: () => window.api.getFolderStatuses() }))
     .create();

   const useQueueData = queryHook
     .ofKey<void, ['queue']>(() => ['queue'] as const)
     .useQuery(() => ({ queryFn: () => loadQueueTab() }))
     .create();

   const useProcessedData = queryHook
     .ofKey<void, ['processed']>(() => ['processed'] as const)
     .useQuery(() => ({ queryFn: () => window.api.getProcessedFilesWithStats() }))
     .create();

   const useErrorData = queryHook
     .ofKey<void, ['errors']>(() => ['errors'] as const)
     .useQuery(() => ({ queryFn: () => loadErrorsTab() }))
     .create();
   ```
2. Refactor `HomeScreen`:
   - Use `useHomeData()` + `useFolderStatuses()` hooks
   - Remove `useEffect([fileStatusVersion])` refresh loop
3. Refactor `ProcessingStatusPanel`:
   - Use `useQueueData()`, `useProcessedData()`, `useErrorData()` with `enabled` based on `activeTab`
   - Remove `useEffect([fileStatusVersion, jeStatusVersion])` refresh loop
   - Add mutations to `src/lib/mutations.ts`:
     ```typescript
     const useCancelQueueItem = mutationHook
       .mutate<string>(id => window.api.cancelQueueItem(id))
       .onSuccess(() => useQueueData.invalidate());

     const useClearPendingQueue = mutationHook
       .mutate<void>(() => window.api.clearPendingQueue())
       .onSuccess(() => useQueueData.invalidate());
     ```
4. Wire `processingStore` → query invalidation:
   - In `onFileStatusChanged`: `useFolderStatuses.invalidate()` + `useQueueData.invalidate()`
   - In `onJeStatusChanged`: `useQueueData.invalidate()` + `useErrorData.invalidate()`
   - Remove version-counter bumps that components no longer watch

**After Phase B:**
- Run `pnpm test`
- Run `pnpm tsc --noEmit`
- Update CLAUDE.md with lessons learned

---

### Phase C — Complex Component (ResultDetail)

**Goal:** Eliminate 5 useState + 4 manual loaders + manual-reload-after-mutation chains.

**Steps:**
1. Add to `src/lib/queries.ts`:
   ```typescript
   const useResultDetail = queryHook
     .ofKey<{ id: string }, ['resultDetail', string]>(({ id }) => ['resultDetail', id] as const)
     .useQuery(({ params }) => ({
       queryFn: () => Promise.all([
         window.api.getFieldOverrides(params.id),
         window.api.getJournalEntries(params.id),
       ]).then(([overrides, journalEntries]) => ({ overrides, journalEntries }))
     }))
     .create();

   const useLineItems = queryHook
     .ofKey<{ id: string }, ['lineItems', string]>(({ id }) => ['lineItems', id] as const)
     .useQuery(({ params }) => ({
       queryFn: () => Promise.all([
         window.api.getLineItems(params.id),
         window.api.getLineItemOverrides([...]),
       ]).then(([lineItems, overrides]) => ({ lineItems, overrides }))
     }))
     .create();
   ```
2. Add mutations to `src/lib/mutations.ts`:
   ```typescript
   const useSaveFieldOverride = mutationHook
     .mutate<OverrideInput>(input => window.api.saveFieldOverride(input))
     .onSuccess((_, input) => useResultDetail.invalidate({ id: input.recordId }));

   const useSaveLineItemField = mutationHook
     .mutate<LineItemInput>(input => window.api.saveLineItemField(input))
     .onSuccess((_, input) => useLineItems.invalidate({ id: input.recordId }));

   const useSaveJournalEntry = mutationHook
     .mutate<JeInput>(input => window.api.saveJournalEntry(input))
     .onSuccess((_, input) => useResultDetail.invalidate({ id: input.recordId }));
   ```
3. Refactor `ResultDetail`:
   - Use `useResultDetail({ id })` and `useLineItems({ id })` hooks
   - Use mutation hooks for all save/resolve operations
   - Remove manual loader `useCallback`s and `useEffect` reload loops
4. Remove `useEffect([lastJeUpdate])` for JE reload → `processingStore` `onJeStatusChanged` invalidates `useResultDetail` (extend from Phase B wiring)
5. Keep `localTotals` as `useState` — it's optimistic UI state

**After Phase C:**
- Run `pnpm test`
- Run `pnpm tsc --noEmit`
- Update CLAUDE.md with lessons learned

---

### Phase D — Optional

**Goal:** PathResultsList debounced search.

**Consideration:** The path search query is debounced with a 300ms timer and is also refreshed on `fileStatusVersion`. This can work with React Query using:
```typescript
const useVaultPaths = queryHook
  .ofKey<{ query: string }, ['vaultPaths', string]>(({ query }) => ['vaultPaths', query] as const)
  .useQuery(({ params }) => ({ queryFn: () => window.api.listVaultPaths(params.query) }))
  .create();
```

Only do this if the manual cancellation token pattern in PathResultsList causes bugs or feels brittle. Otherwise it's low priority.

**After Phase D:**
- Run `pnpm test`
- Run `pnpm tsc --noEmit`
- Update CLAUDE.md with lessons learned

---

## CLAUDE.md Updates Checklist

After each phase, add lessons to the **QueryHook / MutationHook Conventions** section in CLAUDE.md. Keep each point ≤25 words.

---

## Completion Criteria

- [x] Phase A: PresetList + SettingsPanel migrated, tests pass, tsc clean
- [ ] Phase B: HomeScreen + ProcessingStatusPanel migrated, processingStore wired to query invalidation, tests pass, tsc clean
- [ ] Phase C: ResultDetail migrated, tests pass, tsc clean
- [ ] Phase D: PathResultsList migrated (optional)
- [ ] CLAUDE.md updated after each phase
- [ ] No component uses manual `loading` state or `useEffect` + reload pattern for data that React Query now owns
