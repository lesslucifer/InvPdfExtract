---
name: ivicp
description: Interact with the InvoiceVault (IVICP) Electron app programmatically. Search invoices, trigger reprocessing, manage vaults, export data, view aggregates, and trigger any IPC command via an HTTP bridge. Use this skill whenever the user mentions "ivicp", "invoice vault", "invoicevault", wants to search/query invoices, reprocess files or folders, manage vaults, check extraction status, export invoice data, or interact with the running InvoiceVault app in any way — even if they don't explicitly say "ivicp".
---

# IVICP — InvoiceVault App Interaction

Control the InvoiceVault Electron app from Claude Code via a local HTTP bridge that maps to the app's internal IPC handlers.

## Architecture

```
Claude Code  --(curl/WebFetch)--> HTTP Bridge (:19847) --> ipcMain handlers --> App core
```

The Electron app exposes a lightweight HTTP server on `127.0.0.1:19847` that translates `POST /ipc/<channel>` requests into internal `ipcMain.handle()` calls. This bridge lives in the main process alongside the existing IPC handlers.

## Quick Start

### 1. Check if the bridge is running

```bash
curl -s http://127.0.0.1:19847/ping
```

Expected: `{"ok":true,"channels":[...]}` — if this works, skip to step 3.

### 2. Set up the bridge (one-time)

If the ping fails, the HTTP bridge hasn't been added to the app yet. You need to add it:

1. Read the bridge module at `~/.claude/skills/ivicp/scripts/ipc-bridge.ts`
2. Copy it into the IVICP project at `src/main/ipc-bridge.ts`
3. In `src/main.ts`, after `overlayWindow.registerIpcHandlers()` (around line 172), add:
   ```typescript
   import { startIpcBridge } from './main/ipc-bridge';
   // ... after registerIpcHandlers()
   startIpcBridge(overlayWindow);
   ```
4. Restart the app with `pnpm start`

After setup, verify with `curl -s http://127.0.0.1:19847/ping`.

### 3. Call IPC commands

Every IPC channel is available as `POST /ipc/<channel>` with a JSON body containing an `args` array.

```bash
# Search for invoices
curl -s http://127.0.0.1:19847/ipc/search -X POST -H 'Content-Type: application/json' -d '{"args":["query text"]}'

# Get line items for a record
curl -s http://127.0.0.1:19847/ipc/get-line-items -X POST -H 'Content-Type: application/json' -d '{"args":["record-id-here"]}'

# Reprocess all files
curl -s http://127.0.0.1:19847/ipc/reprocess-all -X POST -H 'Content-Type: application/json' -d '{"args":[]}'

# Get app config
curl -s http://127.0.0.1:19847/ipc/get-app-config -X POST -H 'Content-Type: application/json' -d '{"args":[]}'
```

## Available IPC Channels

Rather than maintaining a static list here, discover available channels dynamically:

1. **List all channels**: `curl -s http://127.0.0.1:19847/ping` — returns all registered channel names
2. **Read the source**: The IPC handlers are registered in `src/main/overlay-window.ts` in the `registerIpcHandlers()` method. Read this file to understand parameter types and return values.
3. **Read the types**: The `InvoiceVaultAPI` interface in `src/shared/types/index.ts` defines the full typed API.

### Channel Quick Reference

| Channel | Args | Returns | Description |
|---------|------|---------|-------------|
| `search` | `[query: string]` | `SearchResult[]` | Full-text search records |
| `get-line-items` | `[recordId: string]` | `InvoiceLineItem[]` | Line items for a record |
| `get-field-overrides` | `[recordId: string]` | `FieldOverrideInfo[]` | User-locked field values |
| `get-line-item-overrides` | `[lineItemIds: string[]]` | `Record<string, FieldOverrideInfo[]>` | Batch line item overrides |
| `get-aggregates` | `[filters: SearchFilters]` | `{totalRecords, totalAmount}` | Summary stats |
| `save-field-override` | `[input: FieldOverrideInput]` | `void` | Lock a field value |
| `save-line-item-field` | `[input: LineItemFieldInput]` | `void` | Update line item field |
| `resolve-conflict` | `[recordId, fieldName, action]` | `void` | Resolve single conflict |
| `resolve-all-conflicts` | `[recordId, action]` | `void` | Resolve all conflicts |
| `open-file` | `[relativePath: string]` | `void` | Open file in default app |
| `open-folder` | `[relativePath: string]` | `void` | Open folder in Finder |
| `show-item-in-folder` | `[absolutePath: string]` | `void` | Reveal in Finder |
| `get-app-config` | `[]` | `AppConfig` | Load app config |
| `init-vault` | `[folderPath: string]` | `{success, error?}` | Initialize new vault |
| `switch-vault` | `[vaultPath: string]` | `{success}` | Switch active vault |
| `remove-vault` | `[vaultPath: string]` | `void` | Remove vault from config |
| `list-recent-folders` | `[limit?: number]` | `FolderInfo[]` | Recently accessed folders |
| `list-top-folders` | `[]` | `FolderInfo[]` | Top folders by record count |
| `list-vault-paths` | `[query: string, scope?: string]` | `PathEntry[]` | Fuzzy search vault paths |
| `reprocess-all` | `[]` | `{count}` | Requeue all files |
| `reprocess-file` | `[relativePath: string]` | `{count}` | Requeue single file |
| `reprocess-folder` | `[folderPrefix: string]` | `{count}` | Requeue folder |
| `count-folder-files` | `[folderPrefix: string]` | `{count}` | Count files in folder |
| `check-claude-cli` | `[]` | `{available, version?}` | Check Claude CLI |
| `export-filtered` | `[filters: SearchFilters]` | `{filePath}` | Export to XLSX |
| `hide-overlay` | `[]` | `void` | Hide overlay window |
| `quit-app` | `[]` | `void` | Shut down app |

### Key Types

**SearchFilters**: `{ text?, folder?, docType?, status?, amountMin?, amountMax?, dateFilter? }`

**FieldOverrideInput**: `{ recordId, tableName, fieldName, userValue }`

**LineItemFieldInput**: `{ lineItemId, fieldName, userValue }`

## Workflow Patterns

### Search and inspect an invoice
```bash
# Search
curl -s http://127.0.0.1:19847/ipc/search -X POST -H 'Content-Type: application/json' -d '{"args":["company name"]}'

# Get line items from a result
curl -s http://127.0.0.1:19847/ipc/get-line-items -X POST -H 'Content-Type: application/json' -d '{"args":["<record_id>"]}'
```

### Reprocess a folder after changes
```bash
curl -s http://127.0.0.1:19847/ipc/reprocess-folder -X POST -H 'Content-Type: application/json' -d '{"args":["2024/Q1"]}'
```

### Get aggregate stats with filters
```bash
curl -s http://127.0.0.1:19847/ipc/get-aggregates -X POST -H 'Content-Type: application/json' -d '{"args":[{"folder":"2024","docType":"invoice_in"}]}'
```

## Dynamic Discovery

When the user asks for something you're not sure maps to a specific channel:

1. Read `src/main/overlay-window.ts` to find the handler implementation
2. Read `src/shared/types/index.ts` for type definitions
3. Check `src/core/db/records.ts` for database query functions

This lets you construct the right HTTP call for any operation, even ones added after this skill was written.

## Error Handling

The bridge returns:
- `200` with JSON body on success
- `404` if the channel doesn't exist
- `500` with `{"error": "message"}` on handler failure
- Connection refused if the app isn't running

If the bridge is unreachable, remind the user to start the IVICP app (`pnpm start` from the project directory).
