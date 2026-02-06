---
paths:
  - "frontend/src/**"
---

## Frontend Rules

### iOS Safari Fixes
- `touch-action: pan-x pan-y` — disable pinch-zoom
- `overscroll-behavior: none` — disable bounce
- Safari gesture event prevention required
- Safe-area support for notch devices (env(safe-area-inset-*))

### Theme System
- CSS Variables: `frontend/src/styles/globals.css`
- Themes: Light, Dark, Sepia, System
- Hooks: `useTheme()`, `useEpubThemes()`
- Always sync theme between app UI and epub.js rendition

### EPUB Reader
- EpubReader.tsx has 84 changes — hottest file, consider decomposition
- Always use CFI for position tracking (not page numbers)
- Description highlighting uses 8 fallback search strategies
- IndexedDB caches chapters offline via chapterCache.ts
- TanStack Query keys defined in queryKeys.ts

### Entity Integration
- EntityCard, EntityList, EntityDrawer, EntityProfile components
- Spoiler-free: entities show info only up to current chapter
- Entity data fetched via TanStack Query hooks
