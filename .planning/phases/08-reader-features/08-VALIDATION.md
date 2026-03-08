---
phase: 8
slug: reader-features
status: audited
nyquist_compliant: partial
wave_0_complete: true
created: 2026-03-05
audited: 2026-03-08
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Updated by Nyquist auditor on 2026-03-08.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (frontend)** | Vitest + @testing-library/react |
| **Config (frontend)** | `frontend/vitest.config.ts` |
| **Quick run (frontend)** | `cd frontend && npx vitest run --reporter=verbose src/hooks/epub/__tests__/` |
| **Full suite (frontend)** | `cd frontend && npm test` |
| **Framework (backend)** | pytest + pytest-asyncio |
| **Config (backend)** | `backend/pytest.ini` |
| **Quick run (backend)** | `cd backend && .venv/bin/python -m pytest tests/routers/test_sync_bookmarks.py -x --no-cov` |
| **Full suite (backend)** | `cd backend && .venv/bin/python -m pytest -v` |
| **Estimated runtime** | ~2 seconds (frontend, 5 files) + ~15 seconds (backend, requires PostgreSQL) |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm test && cd ../backend && pytest tests/ -x --no-header -q`
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | READ-03 | integration (backend) | `cd backend && .venv/bin/python -m pytest tests/routers/test_sync_bookmarks.py -x --no-cov` | test_sync_bookmarks.py | ⚠️ needs PostgreSQL |
| 08-01-02 | 01 | 1 | READ-01 | unit (frontend) | `cd frontend && npx vitest run src/hooks/api/__tests__/useSync.test.ts` | useSync.test.ts | ✅ green |
| 08-02-01 | 02 | 1 | READ-01 | unit (frontend) | `cd frontend && npx vitest run src/components/Reader/__tests__/BookmarksList.test.tsx` | BookmarksList.test.tsx | ✅ green |
| 08-02-02 | 02 | 1 | READ-02 | unit (frontend) | `cd frontend && npx vitest run src/hooks/epub/__tests__/useAnnotationRendering.test.ts` | useAnnotationRendering.test.ts | ✅ green |
| 08-03-01 | 03 | 2 | READ-04 | unit (frontend) | `cd frontend && npx vitest run src/hooks/epub/__tests__/useBookSearch.test.ts` | useBookSearch.test.ts | ✅ green |
| 08-03-02 | 03 | 2 | READ-05 | unit (frontend) | `cd frontend && npx vitest run src/components/Reader/__tests__/EntityPopup.test.tsx` | EntityPopup.test.tsx | ✅ green |

*Status: ⬜ pending -- ✅ green -- ❌ red -- ⚠️ needs env*

> **Note (2026-03-08 audit):** highlights model was MERGED into bookmarks during plan 08-02 execution.
> References to `highlight.py`, `useHighlights`, `HighlightsList` are obsolete.
> All bookmark/highlight functionality is now in the unified `Bookmark` model.

---

## Wave 0 Requirements

- [x] `backend/tests/routers/test_sync_bookmarks.py` -- CRUD bookmark endpoints (7 tests, needs PostgreSQL to run)
- [x] `frontend/src/hooks/api/__tests__/useSync.test.ts` -- TanStack Query hooks for bookmarks (5 tests, green)
- [x] `frontend/src/components/Reader/__tests__/BookmarksList.test.tsx` -- BookmarksList component (6 tests, green)
- [x] `frontend/src/hooks/epub/__tests__/useAnnotationRendering.test.ts` -- annotation rendering hook (5 tests, green)
- [x] `frontend/src/hooks/epub/__tests__/useBookSearch.test.ts` -- book search hook (7 tests, green)
- [x] `frontend/src/components/Reader/__tests__/EntityPopup.test.tsx` -- entity popup component (8 tests, green)
- [x] Backend model `bookmark.py` exists (unified, replaces old highlight.py)
- [x] Alembic migrations applied (bookmarks + merge highlights + text_color)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Long tap opens context menu | READ-01/02 | Touch events + DOM positioning | Open book on iOS/Android, long tap on text, verify popup |
| Entity popup on name tap | READ-05 | CFI navigation + DOM overlay | Open book with processed entities, tap highlighted name |
| Search navigates to result in other chapter | READ-04 | epub.js navigation + CFI display | Enter query, tap result from other chapter, verify navigation |
| Annotations persist after reload | READ-02/03 | Full E2E: frontend -> backend -> reload | Create annotation, reload page, verify restoration |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter (blocked by backend PostgreSQL requirement)

**Approval:** partial (5/6 gaps resolved, 1 escalated -- backend needs running PostgreSQL)
