# EPUB Reader Stack Analysis & Alternatives Evaluation

**Date:** January 2026
**Status:** Research Complete
**Author:** Claude Code Analysis

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Implementation Analysis](#current-implementation-analysis)
   - [Technology Stack Overview](#technology-stack-overview)
   - [Architecture Deep Dive](#architecture-deep-dive)
   - [Known Issues & Limitations](#known-issues--limitations)
3. [epub.js Alternatives](#epubjs-alternatives)
   - [Library Comparison Matrix](#library-comparison-matrix)
   - [Detailed Analysis](#detailed-analysis)
4. [Recommendations](#recommendations)
5. [Migration Considerations](#migration-considerations)
6. [Sources](#sources)

---

## Executive Summary

### Current State

fancai использует **epub.js v0.3.93** — наиболее популярную JavaScript-библиотеку для рендеринга EPUB с 6.8k звездами на GitHub. Реализация включает:

- 17+ кастомных React-хуков
- 18 компонентов читалки
- 3-уровневое кэширование (IndexedDB)
- CFI-based позиционирование
- 9-стратегийный алгоритм подсветки описаний
- Специальные iOS-фиксы для PWA

### Ключевая Проблема

epub.js имеет **серьезные проблемы на iOS Safari/PWA**:
- CSS multi-column pagination работает некорректно
- Множественные страницы перелистываются за один тап
- Последний релиз: v0.3.88 (July 2020, GitHub) / v0.3.93 (npm)
- 483 открытых issues на GitHub
- Ограниченная поддержка от maintainers

### Основные Альтернативы

| Библиотека | Готовность к продакшену | iOS Support | React Integration |
|------------|-------------------------|-------------|-------------------|
| **Readium Web / Thorium Web** | ⭐⭐⭐⭐⭐ | Отличная | Нативная (React) |
| **foliate-js** | ⭐⭐⭐ | Не тестирована | Требует обёртку |
| **react-reader** | ⭐⭐⭐⭐ | Наследует от epub.js | Нативная |
| **Flow (pacexy/flow)** | ⭐⭐⭐⭐ | Хорошая (PWA-first) | Нативная (Next.js) |

---

## Current Implementation Analysis

### Technology Stack Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    fancai EPUB Reader                       │
├─────────────────────────────────────────────────────────────┤
│  Frontend Framework     │ React 19 + TypeScript 5.7        │
│  EPUB Library           │ epub.js 0.3.93                   │
│  Build Tool             │ Vite 6                           │
│  Styling                │ Tailwind CSS 3.4                 │
│  State Management       │ Zustand 5 + TanStack Query 5.90  │
│  Offline Storage        │ Dexie.js (IndexedDB wrapper)     │
├─────────────────────────────────────────────────────────────┤
│  Total Lines of Code    │ ~5,000+ (reader-specific)        │
│  Custom Hooks           │ 17 hooks                         │
│  Components             │ 18 components                    │
│  Services               │ 4 caching services               │
└─────────────────────────────────────────────────────────────┘
```

### Architecture Deep Dive

#### Component Hierarchy

```
EpubReader.tsx (573 lines) — Main Orchestrator
├── ReaderHeader.tsx — Title, progress, controls
├── ReaderContent.tsx — HTML rendering, highlighting
├── ReaderToolbar.tsx — Floating navigation
├── TocSidebar.tsx — Table of contents overlay
├── IOSTapZones.tsx — iOS-specific navigation overlay
├── ImageGenerationStatus.tsx — AI image status
├── ExtractionIndicator.tsx — LLM extraction progress
├── PositionConflictDialog.tsx — Multi-device sync
└── SelectionMenu.tsx — Text selection context menu
```

#### Hook Architecture

| Category | Hooks | Purpose |
|----------|-------|---------|
| **Core** | `useEpubLoader`, `useLocationGeneration`, `useCFITracking`, `useEpubThemes` | Book loading, position tracking |
| **Navigation** | `useEpubNavigation`, `useKeyboardNavigation`, `useTouchNavigation`, `useChapterManagement` | Page/chapter navigation |
| **Progress** | `useProgressSync` | Debounced save (5s), beforeunload backup |
| **Features** | `useDescriptionHighlighting`, `useImageModal`, `useContentHooks`, `useTextSelection`, `useToc` | AI features, UI |
| **Utility** | `useResizeHandler`, `useBookMetadata`, `useChapterMapping` | Layout, metadata |

#### epub.js Integration Details

**Initialization Flow:**

```typescript
// 1. Load EPUB as ArrayBuffer (from cache or network)
const arrayBuffer = await epubCache.get(userId, bookId)
                 || await fetch(bookUrl, { headers: authHeaders });

// 2. Create epub.js Book instance
const book = ePub(arrayBuffer);
await book.ready;

// 3. Create Rendition with iOS-specific settings
const rendition = book.renderTo(container, {
  width: isIOS ? Math.floor(width) & ~1 : '100%',  // Even pixels for iOS
  height: isIOS ? height : '100%',
  spread: 'none',           // Force single column
  minSpreadWidth: 99999,    // Prevent spread on iOS
  flow: 'paginated'
});

// 4. iOS fixes
if (isIOS) {
  rendition.spread('none', 99999);
  rendition.on('layout', (layout) => {
    layout.divisor = 1;     // Force single page
  });
}
```

**Key epub.js APIs Used:**

| API | Purpose | Notes |
|-----|---------|-------|
| `ePub(arrayBuffer)` | Parse EPUB file | Works with ArrayBuffer |
| `book.renderTo(element, options)` | Create rendition | Options: width, height, spread, flow |
| `rendition.display(cfi)` | Navigate to position | CFI-based navigation |
| `rendition.next() / prev()` | Page navigation | **Broken on iOS** |
| `rendition.themes.default(styles)` | Apply CSS themes | Inline styles to iframe |
| `rendition.hooks.content.register(fn)` | Inject custom CSS | Content hook system |
| `book.locations.generate(charPerPage)` | Generate location index | Slow: 5-10s first time |
| `locations.cfiFromPercentage(pct)` | Convert % to CFI | Used for restoration |
| `locations.percentageFromCfi(cfi)` | Convert CFI to % | **Buggy on mobile** |

#### Caching Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                   3-Tier Caching System                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Tier 1: EPUB File Cache (epubCache.ts)                       │
│  ├─ Storage: IndexedDB via Dexie.js                           │
│  ├─ Content: Full EPUB as ArrayBuffer                         │
│  ├─ Size Limit: 200MB with LRU cleanup                        │
│  ├─ TTL: 30 days                                              │
│  └─ Key: userId + bookId                                      │
│                                                                │
│  Tier 2: Chapter Cache (chapterCache.ts)                      │
│  ├─ Storage: IndexedDB via Dexie.js                           │
│  ├─ Content: Descriptions + image URLs per chapter            │
│  ├─ Limit: Max 50 chapters per book                           │
│  ├─ TTL: 7 days                                               │
│  └─ Reactive updates via Dexie hooks                          │
│                                                                │
│  Tier 3: Image Cache (imageCache.ts)                          │
│  ├─ Storage: IndexedDB (ArrayBuffer)                          │
│  ├─ Content: Generated AI images                              │
│  ├─ Auto-cleanup on quota exceeded                            │
│  └─ Key: userId + descriptionId                               │
│                                                                │
│  Location Cache (useLocationGeneration)                       │
│  ├─ Storage: IndexedDB                                        │
│  ├─ Content: Serialized location string                       │
│  ├─ Purpose: Skip 5-10s regeneration                          │
│  └─ Validation: Length + format check                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Known Issues & Limitations

#### Critical iOS PWA Issues

| Issue | Symptom | Current Fix | Status |
|-------|---------|-------------|--------|
| **Multi-page navigation** | Single tap turns 2-5 pages | Direct scroll manipulation | ⚠️ In Testing |
| **Percentage width miscalculation** | CSS columns break | Explicit pixel dimensions | ✅ Partial |
| **Touch events not forwarded** | Navigation doesn't work | IOSTapZones overlay | ✅ Working |
| **Heap corruption on resume** | "Forever Broken Book" | Visibility health check | ✅ Fixed (P7) |
| **divisor ≠ 1** | Wrong page count | Force layout.divisor=1 | ⚠️ Inconsistent |

#### epub.js Core Limitations

1. **CSS Multi-Column Rendering**
   - Uses CSS `column-width` for pagination
   - iOS Safari calculates columns incorrectly
   - No alternative pagination strategy available

2. **Location Generation**
   - 5-10 seconds on first load
   - Must cache or user waits
   - Memory-intensive for large books

3. **`percentageFromCfi()` Bug**
   - Returns 0% incorrectly on mobile
   - Requires cross-validation with spine-based progress
   - Known issue: [epub.js #278](https://github.com/futurepress/epub.js/issues/278)

4. **Limited Maintenance**
   - Last GitHub release: v0.3.88 (July 2020)
   - 483 open issues
   - npm has newer versions but limited updates

5. **EPUB 3 Partial Support**
   - EPUB 2 fully supported
   - EPUB 3 "mostly works" but edge cases exist
   - No native audio/video sync

---

## epub.js Alternatives

### Library Comparison Matrix

| Library | Stars | Last Update | License | Bundle Size | iOS Support | EPUB 3 | Formats | React |
|---------|-------|-------------|---------|-------------|-------------|--------|---------|-------|
| **[epub.js](https://github.com/futurepress/epub.js)** | 6.8k | Sep 2023 | BSD | ~200KB | ⚠️ Issues | Partial | EPUB | Wrapper |
| **[Readium Web](https://github.com/readium)** | N/A | Dec 2025 | BSD-3 | ~500KB | ✅ Good | Full | EPUB, PDF, Audio | Native |
| **[Thorium Web](https://github.com/edrlab/thorium-web)** | 66 | Dec 2025 | BSD-3 | ~800KB | ✅ Good | Full | EPUB, Audio, Comics | Native |
| **[foliate-js](https://github.com/johnfactotum/foliate-js)** | 863 | Jan 2025 | MIT | ~150KB | ❓ Unknown | Full | EPUB, MOBI, FB2, CBZ | Manual |
| **[react-reader](https://github.com/gerhardsletten/react-reader)** | 1.2k | 2024 | MIT | ~220KB | ⚠️ Same | Partial | EPUB | Native |
| **[Flow](https://github.com/pacexy/flow)** | 3k | Jan 2025 | AGPL-3 | App | ✅ PWA-first | Partial | EPUB | Native |
| **[@nypl/web-reader](https://github.com/NYPL/web-reader)** | 43 | Active | MIT | ~300KB | ✅ Good | Full | EPUB, PDF | Native |

### Detailed Analysis

---

### 1. Readium Web / Thorium Web (EDRLab)

**GitHub:** [edrlab/thorium-web](https://github.com/edrlab/thorium-web)
**Website:** [readium.org/web](https://readium.org/web/)

#### Overview

Readium Web — это современный TypeScript-toolkit от EDRLab (European Digital Reading Lab) для построения веб-ридеров. Thorium Web — готовое приложение на базе этого toolkit'а.

#### Technology Stack

```
Framework:     Next.js + React
Language:      TypeScript (93.8%)
State:         Redux + Redux Toolkit
Accessibility: React Aria
i18n:          i18next
Styling:       CSS Modules
```

#### Key Features

- ✅ **Full EPUB 3 Support** — включая Fixed-Layout, Media Overlays
- ✅ **Professional Accessibility** — React Aria, WCAG 2.1 AA
- ✅ **Modern Architecture** — Readium Architecture 2.0 standard
- ✅ **Active Development** — последний релиз Dec 2025 (v1.0.9)
- ✅ **Multi-format Roadmap** — PDF, audiobooks, comics planned
- ✅ **DRM Support** — LCP (Readium Licensed Content Protection)
- ✅ **iOS PWA Tested** — designed for web deployment

#### npm Packages

```bash
npm install @edrlab/thorium-web @readium/css @readium/navigator @readium/shared
```

#### Architecture Benefits

```
Thorium Web Architecture:
├── @readium/navigator     — Viewport control, gestures
├── @readium/css           — Reader-specific CSS
├── @readium/shared        — Common types & utilities
└── Publication Manifest   — Webpub standard (not EPUB-specific)
```

#### Pros

- Professional-grade quality (EDRLab backing)
- Standards-compliant (Readium Architecture)
- Active community and funding
- iOS Safari thoroughly tested
- Accessibility-first design
- DRM support available

#### Cons

- Larger bundle size (~800KB)
- Steeper learning curve (Readium concepts)
- Redux required for full features
- Newer project, less community examples
- WCP licensing fees planned (Q1 2026)

#### Migration Complexity: **HIGH**

- Different pagination model (not CSS columns)
- Different position tracking (Locator, not CFI)
- Need to adapt all 17 hooks
- New event system

---

### 2. foliate-js

**GitHub:** [johnfactotum/foliate-js](https://github.com/johnfactotum/foliate-js)
**Demo:** [johnfactotum.github.io/foliate-js](https://johnfactotum.github.io/foliate-js/)

#### Overview

Легковесная JavaScript-библиотека от автора Linux-ридера Foliate. Поддерживает множество форматов, чистый JS без зависимостей.

#### Key Features

- ✅ **Multi-format** — EPUB, MOBI, KF8 (AZW3), FB2, CBZ
- ✅ **Small & Modular** — ~150KB, no dependencies
- ✅ **MIT License** — permissive
- ✅ **Better Pagination** — bisecting for accurate position
- ✅ **Scrolled/Paginated Toggle** — without reload
- ✅ **TTS Support** — returns SSML for synthesis
- ✅ **Offline Dictionaries** — StarDict/dictd support

#### Technical Details

```javascript
// Pure ES modules
import { EPUB } from './epub.js'
import { Paginator } from './paginator.js'

// Create book instance
const book = await new EPUB({ url: '/book.epub' }).init()

// Get section content
const section = await book.sections[0].createDocument()

// Paginator uses CSS columns (same as epub.js)
// BUT uses bisecting for more accurate position calculation
```

#### Pagination Approach

```
foliate-js vs epub.js:

epub.js:      Uses section.cfiFromRange() — can be inaccurate
foliate-js:   Uses bisecting to find visible range — more accurate

Both use CSS multi-column → same iOS issues likely
```

#### Pros

- Smallest bundle size
- No dependencies
- Multi-format support (MOBI, FB2)
- More accurate positioning than epub.js
- Active development

#### Cons

- **"Not stable, API may change"** — author warning
- No official React wrapper
- Less documentation
- Primarily tested on WebKitGTK (Linux), not mobile Safari
- Uses same CSS multi-column approach → iOS issues likely persist

#### Migration Complexity: **MEDIUM-HIGH**

- Need to write React wrapper
- Different API paradigm
- Same pagination issues on iOS likely
- Limited iOS Safari testing

---

### 3. react-reader

**GitHub:** [gerhardsletten/react-reader](https://github.com/gerhardsletten/react-reader)
**npm:** `react-reader`

#### Overview

Официальный React-wrapper для epub.js. Полная TypeScript поддержка.

#### Usage

```tsx
import { ReactReader } from 'react-reader'

function Reader() {
  const [location, setLocation] = useState<string>()

  return (
    <ReactReader
      url="/book.epub"
      location={location}
      locationChanged={setLocation}
      epubInitOptions={{ openAs: 'epub' }}
    />
  )
}
```

#### Components

- `ReactReader` — full reader with controls
- `EpubView` — just the iframe view

#### Pros

- Drop-in React component
- Full TypeScript types
- Annotations API exposed
- Active maintenance
- ~23k weekly downloads

#### Cons

- **Inherits all epub.js issues** — including iOS bugs
- Limited customization without forking
- No solution for CSS column problems

#### Migration Complexity: **LOW** (but doesn't solve iOS issues)

---

### 4. Flow (pacexy/flow)

**GitHub:** [pacexy/flow](https://github.com/pacexy/flow)
**Website:** [flowoss.com](https://www.flowoss.com/)

#### Overview

Полноценное PWA-приложение для чтения EPUB. Open-source, построено на epub.js + Next.js.

#### Technology Stack

```
Framework:     Next.js + React
Language:      TypeScript (65%)
Storage:       LocalStorage + Cloud sync
Build:         pnpm + Turborepo
Deployment:    Vercel, Docker
EPUB Engine:   epub.js (internally)
```

#### Features

- ✅ **PWA-first** — designed for offline/mobile
- ✅ **Cloud Sync** — cross-device reading position
- ✅ **Highlighting & Annotations**
- ✅ **Full-text Search**
- ✅ **Multiple themes**
- ✅ **Export/Import data**

#### Architecture Insights

```
Flow solves similar problems to fancai:
├── Offline-first architecture
├── Cloud synchronization
├── Theme system
├── Annotation storage
└── PWA deployment

BUT still uses epub.js internally
```

#### Pros

- Production-proven PWA
- Similar tech stack (Next.js, TypeScript)
- Active development (Jan 2025)
- 3k stars, community tested

#### Cons

- **Uses epub.js** — same iOS issues
- AGPL-3 license (copyleft)
- Full app, not just library
- May have own iOS workarounds worth studying

#### Migration Complexity: **N/A** (reference implementation, not migration target)

**Recommendation:** Study Flow's iOS workarounds for potential adaptation.

---

### 5. @nypl/web-reader (New York Public Library)

**GitHub:** [NYPL/web-reader](https://github.com/NYPL/web-reader)
**npm:** `@nypl/web-reader`

#### Overview

Веб-ридер от New York Public Library, построенный на Readium Architecture.

#### Architecture

```
@nypl/web-reader
├── Uses Readium Webpub Manifest (not raw EPUB)
├── Chakra UI for styling
├── react-pdf for PDF support
├── Customizable Navigator API
└── Settings: font, size, color schemes
```

#### Key Concept: Webpub Manifest

```json
{
  "@context": "https://readium.org/webpub-manifest/context.jsonld",
  "metadata": { "title": "Book Title" },
  "readingOrder": [
    { "href": "/chapter1.html", "type": "text/html" }
  ]
}
```

#### Pros

- Battle-tested (NYPL production)
- Readium-compliant
- MIT license
- Multi-format (EPUB, PDF)
- Accessibility focus

#### Cons

- Requires manifest conversion (not direct EPUB)
- Smaller community (43 stars)
- Chakra UI dependency
- Less documentation

#### Migration Complexity: **HIGH**

- Need EPUB → Webpub conversion pipeline
- Different rendering approach
- Chakra UI vs Tailwind conflict

---

## Recommendations

### Short-term (0-3 months): Stay with epub.js + Custom Fixes

**Rationale:**
- 17 custom hooks already built
- Direct scroll navigation fix in testing
- Migration cost too high for immediate switch

**Action Items:**
1. ✅ Implement direct scroll navigation (bypassing epub.js)
2. Test thoroughly on iOS devices
3. Study Flow's iOS workarounds
4. Monitor Readium Web development

### Medium-term (3-6 months): Evaluate Readium Web

**Rationale:**
- Most professional-grade alternative
- Active development with EDRLab backing
- iOS thoroughly tested
- Potential solution for CSS column issues

**Action Items:**
1. Create proof-of-concept with Thorium Web
2. Test on fancai's problematic iOS devices
3. Measure performance vs current implementation
4. Evaluate migration effort

### Long-term (6-12 months): Consider Migration

**If Readium Web proves better:**
1. Design adapter layer for gradual migration
2. Migrate caching services (compatible)
3. Adapt hooks to Navigator API
4. Phase out epub.js dependencies

**If custom fixes work well:**
1. Document all iOS workarounds
2. Consider contributing to epub.js
3. Build test suite for iOS edge cases
4. Monitor epub.js fork activity

### Decision Matrix

| Factor | Stay with epub.js | Migrate to Readium |
|--------|-------------------|-------------------|
| iOS PWA support | ⚠️ Requires custom fixes | ✅ Native support |
| Development effort | ✅ Minimal (fixes only) | ⚠️ 2-4 weeks migration |
| Risk level | ⚠️ Uncertain iOS behavior | ✅ Professional solution |
| Feature parity | ✅ All features work | ⚠️ Need to adapt highlights |
| Future maintenance | ⚠️ Limited epub.js updates | ✅ Active development |
| Bundle size | ✅ ~200KB | ⚠️ ~800KB |

---

## Migration Considerations

### If Migrating to Readium Web

#### What Can Be Reused

- ✅ **IndexedDB caching** — Dexie.js services compatible
- ✅ **TanStack Query hooks** — API layer unchanged
- ✅ **Theme system** — CSS variables approach compatible
- ✅ **UI components** — ReaderHeader, TocSidebar, etc.
- ✅ **Description highlighting** — algorithm portable

#### What Needs Rewriting

- ⚠️ **Navigation hooks** — New Navigator API
- ⚠️ **Position tracking** — Locator vs CFI
- ⚠️ **Location generation** — Different approach
- ⚠️ **Touch navigation** — New gesture system
- ⚠️ **Content hooks** — Different injection API

#### Estimated Migration Effort

| Component | Effort | Notes |
|-----------|--------|-------|
| Book loading | 2-3 days | New parsing flow |
| Navigation | 3-4 days | Navigator API learning curve |
| Position tracking | 2-3 days | Locator system |
| Theme integration | 1-2 days | @readium/css |
| Highlighting | 3-4 days | Adapt algorithm |
| Testing | 5-7 days | iOS device testing |
| **Total** | **16-23 days** | ~1 month with buffer |

---

## Sources

### Official Documentation

- [epub.js GitHub](https://github.com/futurepress/epub.js)
- [Readium Web Documentation](https://readium.org/web/)
- [Thorium Web GitHub](https://github.com/edrlab/thorium-web)
- [foliate-js GitHub](https://github.com/johnfactotum/foliate-js)
- [Flow GitHub](https://github.com/pacexy/flow)

### Comparison Articles

- [ePUB.js vs Readium.js Comparison (2025)](https://kitaboo.com/epub-js-vs-readium-js-comparison-of-epub-readers/)
- [epub.js npm Trends](https://npmtrends.com/epub.js-vs-epubjs-vs-epubjs-rn-vs-react-reader)

### npm Packages

- [epubjs on npm](https://www.npmjs.com/package/epubjs)
- [react-reader on npm](https://www.npmjs.com/package/react-reader)
- [@readium/navigator on npm](https://www.npmjs.com/package/@readium/navigator)
- [@edrlab/thorium-web on npm](https://www.npmjs.com/package/@edrlab/thorium-web)
- [@nypl/web-reader on npm](https://www.npmjs.com/package/@nypl/web-reader)

### GitHub Issues (iOS-related)

- [epub.js #204 - iOS rendering problems](https://github.com/futurepress/epub.js/issues/204)
- [epub.js #657 - Page skipping](https://github.com/futurepress/epub.js/issues/657)
- [epub.js #904 - Mobile Safari text selection](https://github.com/futurepress/epub.js/issues/904)

---

## Appendix: Current fancai Reader Files

### Components (`/frontend/src/components/Reader/`)

| File | Lines | Purpose |
|------|-------|---------|
| EpubReader.tsx | 573 | Main orchestrator |
| BookReader.tsx | ~200 | Text-based fallback |
| ReaderHeader.tsx | ~70 | Top navigation |
| ReaderControls.tsx | ~100 | Settings dropdown |
| IOSTapZones.tsx | ~150 | iOS navigation overlay |
| PositionConflictDialog.tsx | 123 | Multi-device sync |
| + 12 more | ~800 | Various UI components |

### Hooks (`/frontend/src/hooks/epub/`)

| Hook | Lines | Purpose |
|------|-------|---------|
| useEpubLoader.ts | 355 | Book loading + iOS fixes |
| useEpubNavigation.ts | 215 | Page navigation + direct scroll |
| useDescriptionHighlighting.ts | 566 | 9-strategy fuzzy matching |
| useCFITracking.ts | ~200 | Position tracking |
| useContentHooks.ts | 447 | CSS injection + iOS fixes |
| + 12 more | ~1000 | Various features |

### Services (`/frontend/src/services/`)

| Service | Purpose |
|---------|---------|
| epubCache.ts | EPUB file caching (IndexedDB) |
| chapterCache.ts | Chapter descriptions caching |
| imageCache.ts | Generated images caching |
| syncQueue.ts | Offline operations queue |

---

*Document generated: January 2026*
*For questions: see CLAUDE.md or contact development team*
