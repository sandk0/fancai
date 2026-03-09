---
name: perf-audit
description: Audit frontend performance for the EPUB reader and entity UI. Use when the reader is slow, entity drawer lags, or bundle size grows.
allowed-tools: Bash, Read, Grep, Glob
---

# Frontend Performance Audit

## Quick Checks

### Bundle Size

```bash
cd frontend && npm run build 2>&1 | tail -20
```

### Type Check

```bash
cd frontend && time npx tsc --noEmit
```

## Reader Performance Checklist

- [ ] All event handlers use `useCallback`
- [ ] Computed values use `useMemo`
- [ ] `useProgressSync` debounced at 5s
- [ ] Large entity lists are virtualized
- [ ] Images are lazy-loaded
- [ ] No direct fetch() — all through TanStack Query

## Files to Profile

- `EpubReader.tsx` (286 lines, orchestrator)
- `useDescriptionHighlighting.ts` (8 search strategies)
- `EntityDrawer.tsx`, `EntityList.tsx`
- `chapterCache.ts` (IndexedDB)

## Bundle Targets

- Total JS: < 500KB gzipped
- epub.js: ~150KB (unavoidable)
- React + ReactDOM: ~45KB
- Vendor chunk: monitor for growth

## Anti-Patterns to Check

- CSS-in-JS at runtime (use Tailwind 4)
- Missing React.lazy for non-critical routes
- Missing code splitting
- Overfetching with TanStack Query (check staleTime)
