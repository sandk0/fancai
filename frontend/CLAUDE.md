# Frontend — React 19 + TypeScript 5.7 + Vite 8

## Key Conventions

- Functional components with hooks, no class components
- TanStack Query for ALL API calls — no direct fetch()
- Zustand for client state (3 stores: auth, reader, ui)
- Tailwind CSS 4.x — utility-first, CSS variables in globals.css
- CFI for EPUB position tracking (never page numbers)
- Spoiler-free: entity info only up to current reading chapter

## Architecture

- `components/Reader/` — 34 files, EpubReader.tsx (~910 lines) well-decomposed into 25+ hooks
- `components/Entities/` — 10 files (NOT in Reader/); EntityDrawer + EntityBottomSheet (no EntityPopup)
- `hooks/epub/` — 31 files (25+ hooks) for EPUB functionality
- `hooks/api/` — 12 TanStack Query hook files
- `services/` — IndexedDB caching (Dexie), offline-first

## iOS Safari

- Always use `touch-action: pan-x pan-y`
- Always use `overscroll-behavior: none`
- Test gesture events and safe-area insets

## Testing

- Vitest + @testing-library/react — 38 unit test files
- Playwright e2e — 8 specs in `frontend/tests/` (`npm run test:e2e`)
- `npm test` (vitest run) for CI; `npm run build` to verify TypeScript
