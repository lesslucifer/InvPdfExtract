# InvoiceVault — Implementation Plan

8 phases, each with a clear deliverable you can test end-to-end.

---

## Phase Overview

| Phase | Name | Deliverable | PRD Sections |
|-------|------|-------------|--------------|
| [0](phase-0-scaffolding.md) | **Scaffolding** | `pnpm dev` launches Electron, shared types compile | §14 |
| [1](phase-1-core-engine.md) | **Core Engine** | Vault init + file watcher + SQLite — files tracked automatically | §2.1, §4, §9 |
| [2](phase-2-pdf-extraction.md) | **PDF Extraction** | PDF → Claude CLI → structured data in DB with confidence scores | §3, §10, §5 |
| [3](phase-3-system-tray.md) | **System Tray** | Tray icon with status, context menu, desktop notifications | §2.2, §11 |
| [4](phase-4-search-overlay.md) | **Search Overlay** | `Cmd+Shift+I` → Spotlight-style search across all records | §6 |
| [5](phase-5-structured-extraction.md) | **Structured Extraction** | Excel/CSV/XML parsing via cached scripts + validation rules | §10.3, §3, §4.2 |
| [6](phase-6-editing-locking.md) | **Editing & Locking** | Inline edit + field locks + conflict resolution + smart search | §7, §6.3 |
| [7](phase-7-polish-export.md) | **Polish & Export** | Excel export, multi-vault, Finder/Explorer integration, auto-start | §12-§13 |

---

## Dependency Graph

```
Phase 0 (Scaffolding)
  └── Phase 1 (Core Engine)
        ├── Phase 2 (PDF Extraction)
        │     └── Phase 5 (Structured Extraction)
        │           └── Phase 6 (Editing & Locking)
        └── Phase 3 (System Tray)
              └── Phase 4 (Search Overlay)
                    └── Phase 6 (Editing & Locking)
                          └── Phase 7 (Polish & Export)
```

**Parallelizable:** Phases 2+3 can be built in parallel after Phase 1. Phase 4 only needs Phase 3's tray (for hotkey registration) but not Phase 2's extraction.

---

## MVP Checkpoint

After **Phases 0–4**, you have a working MVP:
- Tray app that watches a folder
- PDFs auto-extracted via Claude Code CLI
- Records searchable via hotkey overlay
- Desktop notifications on extraction events

This maps to PRD §12 (MVP Scope — Week 1).

---

## How to Use This Plan

1. Work through phases sequentially (respect dependencies)
2. Each phase file lists specific tasks, services to create, and acceptance criteria
3. Mark acceptance criteria as you complete them
4. Phases 2+3 can be parallelized if working with multiple contributors
