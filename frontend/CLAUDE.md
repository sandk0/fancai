# Frontend — React 19 + TypeScript 5.7 + Vite 7

## Key Conventions

- Functional components with hooks, no class components
- TanStack Query for ALL API calls — no direct fetch()
- Zustand for client state (3 stores: auth, reader, ui)
- Tailwind CSS 4.x — utility-first, CSS variables in globals.css
- CFI for EPUB position tracking (never page numbers)
- Spoiler-free: entity info only up to current reading chapter

## Architecture

- `components/Reader/` — 22 files, EpubReader.tsx (286 lines) well-decomposed into 25+ hooks
- `components/Entities/` — 12 files (NOT in Reader/)
- `hooks/epub/` — 26 hooks for EPUB functionality
- `hooks/api/` — 8 TanStack Query hook files
- `services/` — IndexedDB caching (Dexie), offline-first

## iOS Safari

- Always use `touch-action: pan-x pan-y`
- Always use `overscroll-behavior: none`
- Test gesture events and safe-area insets

## Testing

- Vitest + @testing-library/react
- `npm test -- --watchAll=false` for CI
- `npm run build` to verify TypeScript
