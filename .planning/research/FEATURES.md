# Feature Landscape

**Domain:** AI-enhanced e-book reader (web PWA) with entity glossary and illustration generation
**Researched:** 2026-02-27
**Confidence:** HIGH (based on competitive analysis of Kindle X-Ray, Readest, ReadEra, Kobo, Moon+ Reader, and existing codebase audit)

## Table Stakes

Features users expect from any production book reader. Missing = product feels incomplete or broken.

### Reader Core

| Feature | Why Expected | Complexity | Status | Notes |
|---------|--------------|------------|--------|-------|
| Reliable EPUB rendering | Foundational -- without this nothing else matters | Already built | DONE | epub.js 0.3.93, CFI navigation working |
| Table of contents navigation | Every reader has this; Kindle, Kobo, Readest all include searchable TOC | Low | DONE | `TocSidebar.tsx` with search, virtualization |
| Reading progress tracking | Users need to know where they are; all competitors show percentage + chapter | Low | DONE | `ProgressIndicator.tsx`, progress sync to backend |
| Font customization (size, family) | Baseline expectation -- Kindle, Apple Books, ReadEra, Readest all offer this | Low | DONE | `ReaderSettingsPanel.tsx` with 6 font families, size 12-32px |
| Theme support (light/dark/sepia) | All modern readers offer at least 3 themes | Low | DONE | 5 themes: light, dark, sepia, warm, cool |
| Resume reading position | Users close and reopen constantly; must resume exactly | Med | DONE | CFI-based position persistence, `PositionConflictDialog` for cross-device |
| Book library with covers | Basic library management; see all books at a glance | Low | DONE | `LibraryPage.tsx`, `BookCard` components |
| Book upload | Users need to get books into the app | Low | DONE | `BookUploadModal.tsx`, drag-and-drop, EPUB + FB2 |
| Offline reading | PWA users expect cached books to work without network | Med | DONE | IndexedDB chapter cache, service worker, `PWAOfflineSection` |
| Text selection + copy | Minimum text interaction -- every reader supports this | Low | DONE | `SelectionMenu.tsx` with copy action |
| Mobile-responsive layout | Book reading is primarily mobile; must work on phones | Med | DONE | Responsive components, bottom sheet on mobile, swipe/tap navigation |
| Wake lock (screen stays on) | Readers hate screens dimming mid-page; Kindle hardware does this by default | Low | DONE | Wake Lock API integration in settings panel |
| Search in TOC | Users search for chapters by name | Low | DONE | Built into `TocSidebar.tsx` |

### Error Handling and Reliability

| Feature | Why Expected | Complexity | Status | Notes |
|---------|--------------|------------|--------|-------|
| Graceful book parsing errors | Corrupted or malformed EPUBs must not crash the app; user needs actionable message | Med | PARTIAL | ebooklib catches some errors, but no user-friendly error states for malformed books |
| API error recovery with retry | Network flakiness must not lose user's place or data | Med | PARTIAL | TanStack Query retries exist, but error messages are generic |
| Health check that actually works | Monitoring must detect real failures, not report fake "healthy" | Low | MISSING | Health endpoint returns hardcoded "checking..." |
| Consistent error message UX | All errors should look the same and suggest next actions | Med | PARTIAL | `ErrorMessage.tsx` exists with retry, but not used consistently across all failure states |
| Book processing failure recovery | If AI extraction fails, user needs to know and retry | Med | PARTIAL | `ParsingOverlay` shows progress, but failure state UX is weak -- user can re-trigger but no clear "what went wrong" |
| Position conflict resolution | Cross-device reading creates position conflicts | Med | DONE | `PositionConflictDialog.tsx` handles server vs local position |

### Loading States and Perceived Performance

| Feature | Why Expected | Complexity | Status | Notes |
|---------|--------------|------------|--------|-------|
| Skeleton loading for library | Users see blank screens without it; Nielsen Norman Group research confirms skeletons reduce perceived wait | Low | DONE | `BookCardSkeleton`, `EntityListSkeleton`, `CardSkeleton` in `Skeleton.tsx` |
| Book processing progress indicator | Long-running task (5-60+ seconds); users must see progress, not a spinner | Med | DONE | `UploadProgress.tsx`, WebSocket/polling for Celery progress |
| AI extraction loading state | 5-15 second LLM call must communicate "AI is working" | Med | DONE | `ExtractionIndicator.tsx` with spinner, text, cancel button |
| Chapter loading between navigations | Swipe/tap to new chapter must feel instant or show loading | Low | PARTIAL | Chapter data is cached in IndexedDB, but no shimmer/skeleton while epub.js re-renders |
| Image lazy loading | AI-generated images are large; must not block page render | Low | DONE | `LazyImage.tsx`, `AuthenticatedImage.tsx` |

### Security Fundamentals

| Feature | Why Expected | Complexity | Status | Notes |
|---------|--------------|------------|--------|-------|
| No debug mode in production | Leaking stack traces = security vulnerability + unprofessional | Low | MISSING | `DEBUG: bool = True` default; must flip to `False` |
| Secure secret key | Hardcoded secrets are exploitable | Low | MISSING | Default `"dev-secret-key-change-in-production"` |
| Reasonable token expiry | 7-day access tokens are too long if stolen | Low | MISSING | `ACCESS_TOKEN_EXPIRE_MINUTES = 10080` should be 15-30 min |
| Working password reset | Production users need to recover accounts | Low | MISSING | URL hardcodes `localhost:5173` |
| File upload validation | Malicious uploads must be rejected early | Low | PARTIAL | Extension-only validation; no magic byte check |

## Differentiators

Features that set fancai apart. Not table stakes, but the reason users choose this product over alternatives.

### AI-Powered Entity Wiki (Primary Differentiator)

| Feature | Value Proposition | Complexity | Status | Notes |
|---------|-------------------|------------|--------|-------|
| Spoiler-free character glossary | Kindle X-Ray doesn't filter by reading position; fancai's chapter-based filtering is genuinely unique | Already built | DONE | Entity filtering by CFI position, `EntityDrawer.tsx`, `EntityProfile.tsx` |
| Entity relationships graph | See character connections visually; goes beyond what any mainstream reader offers | Med | DONE | `graph_service.py`, relationship data in entity profiles |
| Entity type categorization | Characters, locations, objects -- organized taxonomy | Low | DONE | Entity types with icons and categories |
| Entity event timeline | See when characters appeared and what happened -- narrative tracking | Med | DONE | `EntityEventTimeline.tsx` |
| Entity recap panel | Quick summary of what happened with entities up to current chapter | Med | DONE | `RecapPanel.tsx` |
| Entity deduplication (fuzzy + LLM) | Merge "Harry" and "Harry Potter" intelligently -- quality control | High | PARTIAL | Works but fuzzy threshold 0.85 too high for Russian names; chunk boundary entity loss exists |
| In-text entity search | Tap a character name in text to see their wiki entry | Med | NOT BUILT | Kindle X-Ray has this via tap-and-hold; fancai could link description highlights to entity profiles |

### AI-Generated Illustrations (Secondary Differentiator)

| Feature | Value Proposition | Complexity | Status | Notes |
|---------|-------------------|------------|--------|-------|
| AI illustration generation | Unique value: see the scenes as you read them | Already built | DONE | Gemini extraction + Imagen 4 generation pipeline |
| Description highlighting in text | Visual link between text passage and generated image | High | DONE | 8 fallback strategies in `useDescriptionHighlighting.ts` |
| Image gallery per book | Browse all generated illustrations | Low | DONE | `BookImagesPage.tsx`, `ImageGallery.tsx` |
| Image viewer with zoom | Full-screen image viewing experience | Low | DONE | `ImageViewer.tsx` |

### Reading Analytics

| Feature | Value Proposition | Complexity | Status | Notes |
|---------|-------------------|------------|--------|-------|
| Reading statistics | Time spent, pages read, streaks -- gamification of reading | Med | DONE | `StatsPage.tsx`, `StatsCards.tsx`, reading session tracking |
| Reading streaks | Daily/weekly reading habit tracking | Low | DONE | Part of statistics system |
| Achievements | Gamified milestones (books finished, hours read) | Med | DONE | `AchievementsList.tsx` |

### Quality of Life

| Feature | Value Proposition | Complexity | Status | Notes |
|---------|-------------------|------------|--------|-------|
| PWA install prompt | Native-app-like experience without app store friction | Low | DONE | `PWAInstallSection.tsx`, `IOSInstallInstructions` |
| Push notifications | "Continue reading" reminders, processing complete alerts | Med | DONE | `push_notification_service.py`, `pushNotifications.ts` |
| Cross-tab sync | Read in one tab, entity wiki in another -- both stay synced | Low | DONE | `tabSync.ts` |
| Admin dashboard | Content moderation, user management, entity merge | Med | DONE | `AdminDashboardEnhanced.tsx` |
| i18n (Russian + English) | Bilingual support for target audience | Already built | DONE | 222 occurrences of `useTranslation` across 100 files |

## Planned/Stub Features (Not Yet Working)

Features with code stubs or UI but no working implementation.

| Feature | Current State | What's Needed | Priority | Notes |
|---------|--------------|---------------|----------|-------|
| Bookmarks | SelectionMenu has "Highlight" + "Note" buttons marked "Task 3.1" | Backend sync endpoint + IndexedDB persistence + UI for bookmark list | Med | Sync endpoint (`sync.py`) is a TODO stub that returns errors |
| Highlights (text annotation) | UI button exists but `onHighlight` is never passed | Same as bookmarks -- shared sync infrastructure | Med | Standard reader feature; Kindle, Kobo, Readest all have it |
| Notes on highlights | UI button exists but `onNote` is never passed | Same as bookmarks | Med | Tied to highlight feature |
| WebSocket real-time updates | Frontend `WebSocketService` is a no-op stub | Backend cookie auth for WS + reconnection logic | High | Would replace polling for book processing progress |
| Batch description fetch | `useBookDescriptions` hook is permanently disabled | Backend batch endpoint | Low | Optimization for prefetching all descriptions |
| Book download for offline | `DownloadBookButton.tsx` exists | Verify full offline pipeline works end-to-end | Med | PWA offline is partially implemented |
| Payment/subscription system | Config stubs for YooKassa/CloudPayments | Full payment integration | OUT OF SCOPE | Monetization deferred |

## Anti-Features

Features to explicitly NOT build in this production-readiness milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Social/community features | Scope creep; reading is primarily solitary; no competitive moat here | Focus on single-user reading experience quality |
| Built-in book store/marketplace | Complex legal, licensing, and payment integration; not core value | Support EPUB/FB2 upload; users source books elsewhere |
| Text-to-speech / audio narration | Complex accessibility feature; better served by OS-level accessibility tools; Readest does this but it's not expected in web readers | Ensure app works with screen readers (VoiceOver, TalkBack) |
| AI-powered book recommendations | Requires large dataset of user behavior; cold start problem; not related to core reading experience | Manual library organization is sufficient |
| Reading speed estimation / "time left in chapter" | Inaccurate and annoying when wrong; chapter progress percentage is sufficient | Show chapter progress percentage (already done) |
| OAuth social login (Google, GitHub) | Added complexity for minimal user acquisition benefit in v1 | Email/password auth works; add OAuth later if user feedback demands it |
| Multi-format beyond EPUB/FB2 | PDF, MOBI, AZW3 support adds parser complexity; EPUB is the standard for reflowable text | Keep EPUB + FB2; recommend Calibre for format conversion |
| Collaborative annotations | Sharing highlights/notes between users; complex permissions model | Single-user annotations first |
| WebSocket for everything | Over-engineering; polling works for all current features except book processing | Use WebSocket only for book processing progress; polling for everything else |
| Inline dictionary/translation | Complex feature requiring dictionary API integration; tangential to core value | Users can select text and use OS-level dictionary |

## Feature Dependencies

```
Book Upload -> Book Parsing -> Chapter Storage -> EPUB Rendering
                           |
                           +-> AI Extraction -> Entity Wiki (spoiler-free)
                           |                 |
                           |                 +-> Entity Deduplication
                           |
                           +-> Description Extraction -> Image Generation
                                                      |
                                                      +-> Description Highlighting

Reading Progress Tracking -> Reading Statistics -> Achievements
                          |
                          +-> Position Resume
                          |
                          +-> Position Conflict Resolution

Text Selection -> Copy (DONE)
              |
              +-> Highlights (STUB) -> Bookmark Sync (STUB)
              |
              +-> Notes (STUB) -> Bookmark Sync (STUB)

Security Fixes (no dependencies, can be done in parallel):
  - Debug mode default
  - Secret key default
  - Token expiry
  - Password reset URL
  - File upload validation
  - Health check
```

## Production Readiness Recommendation

### Phase 1: Security + Stability (do first -- no features until this is solid)

1. Fix security defaults (DEBUG, SECRET_KEY, token expiry, password reset URL)
2. Implement real health check
3. Remove dead NLP code (reduces confusion, smaller attack surface)
4. Fix or remove TODO stubs (sync endpoint should return 501 Not Implemented, not silent failure)
5. Add magic byte validation for file uploads

### Phase 2: Error Handling + Loading States (polish what exists)

1. Standardize error messages across all failure states
2. Add proper error states for book parsing failures (user-friendly)
3. Add chapter transition loading states (shimmer while epub.js re-renders)
4. Improve AI extraction failure recovery UX
5. Fix book reprocess orphaned descriptions bug

### Phase 3: Entity Wiki Quality (core differentiator must be reliable)

1. Lower fuzzy matching threshold for Russian names (0.85 -> 0.70-0.75 with validation)
2. Address chunk boundary entity loss (recursive reduce or smarter overlap)
3. Add ConsistencyManager unit tests (no tests for 722-line service)
4. Verify spoiler-free filtering is exhaustively tested

### Phase 4: Reader Polish (quality of life)

1. Implement bookmarks/highlights (SelectionMenu UI already exists)
2. Implement bookmark sync endpoint (replace TODO stub)
3. Add entity-to-text linking (tap character name -> entity profile)
4. Add empty states for all "no content" scenarios

Defer: WebSocket real-time, payment system, OAuth, batch descriptions

## Competitor Feature Matrix

| Feature | fancai | Kindle (X-Ray) | Readest | ReadEra | Kobo |
|---------|--------|----------------|---------|---------|------|
| EPUB support | Yes | MOBI/AZW3 | Yes | Yes | Yes |
| Spoiler-free entity wiki | **Yes** | No (shows all) | No | No | No |
| AI-generated illustrations | **Yes** | No | No | No | No |
| Character glossary | Yes | Yes (X-Ray) | No | No | No |
| Highlights/annotations | Stub | Yes | Yes | Yes | Yes |
| Bookmarks | Stub | Yes | Yes | Yes | Yes |
| Cross-device sync | Yes | Yes | Yes | No | Yes |
| Offline reading | Yes | Yes | Yes | Yes | Yes |
| Reading statistics | Yes | Yes | Basic | Yes | Yes |
| Dark mode | Yes | Yes | Yes | Yes | Yes |
| Font customization | Yes | Yes | Yes | Yes | Yes |
| Text search in book | No | Yes | Yes | Yes | Yes |
| Dictionary/translation | No | Yes | Yes | No | Yes |
| Split-screen reading | No | No | Yes | No | No |
| TTS/narration | No | Audible | Yes | Yes | No |
| Open source | No | No | Yes | No | No |

**Key insight:** fancai's two unique differentiators (spoiler-free entity wiki + AI illustrations) are genuinely absent from all major competitors. The gap is in table-stakes features: highlights, bookmarks, and in-book text search. These must be addressed to prevent users leaving for a more complete reader despite the unique AI features.

## Sources

- [Kindle X-Ray Feature Guide - SlashGear](https://www.slashgear.com/1475659/kindle-x-ray-feature-explained/) (HIGH confidence)
- [Kindle X-Ray for Authors - KDP](https://kdp.amazon.com/en_US/help/topic/G202187430) (HIGH confidence)
- [Readest - Open Source Reader](https://github.com/readest/readest) (HIGH confidence)
- [ReadEra - Book Reader](https://readera.org/) (HIGH confidence)
- [Kobo Web Reader Navigation Features](https://help.kobo.com/hc/en-us/articles/35996239522967-Kobo-Web-Reader-Navigation-Reading-Features) (HIGH confidence)
- [Skeleton Screen Best Practices - NN/G](https://www.nngroup.com/articles/skeleton-screens/) (HIGH confidence)
- [AI Progress Indicators - SAP Fiori](https://www.sap.com/design-system/fiori-design-ios/v26-1/in-app-ai-design/components/ai-progress-indicators) (MEDIUM confidence)
- [Cloudscape GenAI Loading States](https://cloudscape.design/patterns/genai/genai-loading-states/) (MEDIUM confidence)
- [PWA Offline Caching Strategies - MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching) (HIGH confidence)
- [Error Handling in Mobile Apps - Maestro](https://maestro.dev/insights/error-handling-mobile-apps-best-practices) (MEDIUM confidence)
- Existing codebase analysis (`.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`) (HIGH confidence)
