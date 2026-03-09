---
paths:
  - "frontend/src/components/Reader/**"
  - "frontend/src/hooks/epub/**"
  - "frontend/src/hooks/reader/**"
---

## Reader Rules

### EpubReader (286 lines, well-decomposed)

- Reader/ contains 22 files — EpubReader.tsx is the orchestrator (286 lines)
- Decomposition into 25+ hooks is DONE — maintain this pattern, do not add logic back
- New reader features should be implemented as hooks in `hooks/epub/` or `hooks/reader/`

### epub.js Integration

- ALWAYS use CFI for position tracking (not page numbers)
- 8 search strategies in useDescriptionHighlighting.ts
- epub.js 0.3.93 is stale (2019) but no maintained alternative exists
- IndexedDB (Dexie) caches chapters for offline use

### Entity Integration

- Entity components are in `Entities/` directory (NOT `Reader/`)
- EntityDrawer.tsx — slide-out panel for entity details
- useEntityNetwork.ts — fetches entity graph
- useEntityCFIPopulation.ts — maps entity CFI positions
- Spoiler-free: entities visible only up to current reading chapter

### Performance

- All event handlers must use useCallback
- Computed values use useMemo
- useProgressSync debounced at 5s intervals
- useRenditionHealthGuard prevents zombie renditions
