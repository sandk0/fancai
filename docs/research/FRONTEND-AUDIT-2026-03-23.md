# Frontend Audit Report — fancai

**Date:** 2026-03-23
**Files analyzed:** 135 TSX components, 31,690 lines
**Agents:** 3 parallel (components, a11y/themes, performance)

---

## Anti-Patterns Verdict

**Verdict: PASS (with notes)**

The codebase does NOT look like AI slop. It demonstrates a human, product-driven design approach. Three AI patterns noted:

| AI Pattern                         | Found?             | Where                                                     |
| ---------------------------------- | ------------------ | --------------------------------------------------------- |
| Cyan-on-dark / neon accents        | No                 | —                                                         |
| Purple-to-blue gradients           | No                 | —                                                         |
| Gradient text                      | **Yes (2 places)** | `GuestHero.tsx:43`, `NotFoundPage.tsx:57`                 |
| Glassmorphism everywhere           | **Yes (35 files)** | backdrop-blur in 42 places                                |
| Hero metrics layout                | No                 | —                                                         |
| Card grids (icon + heading + text) | **Yes (1 place)**  | `GuestHero.tsx:127-146` — 3 identical cards               |
| Inter font                         | **Yes**            | `--font-sans: 'Inter'` — one of the most AI-typical fonts |
| Bounce easing                      | No                 | —                                                         |
| Rounded rects + drop shadows       | No                 | —                                                         |

**Summary:** Gradient text in 2 places and Inter are minor markers. Glassmorphism across 35 files is a deliberate choice for a reading app (blur helps content focus), not slop. Cards in GuestHero are a typical landing page pattern but only appear once.

---

## Executive Summary

| Severity  | Count  |
| --------- | ------ |
| Critical  | 0      |
| High      | 3      |
| Medium    | 6      |
| Low       | 7      |
| **Total** | **16** |

### Top-5 Findings:

1. **`useIntersectionObserver` — `isVisible` in deps** — potential observer recreation cycle
2. **ImageGrid — no lazy loading** for image grid (all load simultaneously)
3. **Layout thrashing in `useEntityNameHighlighting`** — DOM read/write in loop
4. **Gradient text** in GuestHero and NotFoundPage — AI slop marker
5. **progressBar animation** animates `width`/`margin` instead of `transform`

### Overall Quality Score: **8.5 / 10**

---

## High-Severity Issues

### H1. useIntersectionObserver — `isVisible` in dependency array

- **Location:** `hooks/useIntersectionObserver.ts:67`
- **Category:** Performance
- **Description:** `isVisible` is included in useEffect deps, causing observer recreation on every visibility change. With `triggerOnce=false` — infinite create/destroy cycle.
- **Impact:** IntersectionObserver recreated on every scroll event. Performance leak.
- **Recommendation:** Remove `isVisible` from deps. Early return on line 46 is sufficient for triggerOnce.
- **Suggested command:** `/optimize`

### H2. ImageGrid — no lazy loading

- **Location:** `components/Images/ImageGrid.tsx`
- **Category:** Performance
- **Description:** All `AuthenticatedImage` components in the grid render simultaneously. Each makes a separate authenticated fetch for blob URL.
- **Impact:** With 50+ images — 50 concurrent HTTP requests. Network and memory pressure.
- **Recommendation:** Wrap each item in `useIntersectionObserver` or use `LazyImage` wrapper.
- **Suggested command:** `/optimize`

### H3. Layout thrashing in useEntityNameHighlighting

- **Location:** `hooks/epub/useEntityNameHighlighting.ts:104-145`
- **Category:** Performance
- **Description:** Loop over text nodes: reads `textContent` + writes `appendChild`/`replaceChild` inside same loop. Each DOM mutation can trigger reflow.
- **Impact:** With 500+ text nodes per page — noticeable jank on chapter change (150ms debounce doesn't help enough).
- **Recommendation:** Collect all mutations in DocumentFragment, apply as batch.
- **Suggested command:** `/optimize`

---

## Medium-Severity Issues

### M1. Gradient text — AI slop marker

- **Location:** `components/Home/GuestHero.tsx:43`, `pages/NotFoundPage.tsx:57`
- **Category:** Anti-Patterns
- **Description:** `bg-gradient-to-r from-primary via-amber-500 to-orange-500 bg-clip-text text-transparent` — typical AI-generated pattern. NotFoundPage uses `from-primary to-purple-600`.
- **Impact:** Visual marker of AI generation. No functional value.
- **Standard:** Frontend-design skill: "DON'T: Use gradient text for 'impact'"
- **Recommendation:** Replace with solid color with accent tint or typography weight.
- **Suggested command:** `/typeset`

### M2. Inter as primary font

- **Location:** `styles/globals.css:64`
- **Category:** Anti-Patterns
- **Description:** `--font-sans: 'Inter'` — the most common "AI-chosen" font. Not unique.
- **Impact:** Visual identity. Inter is a good font but a generic choice.
- **Standard:** Frontend-design skill: "DON'T: Use overused fonts—Inter, Roboto, Arial"
- **Recommendation:** Consider alternatives: **Plus Jakarta Sans**, **Outfit**, **General Sans** for UI. For a reading app with Cyrillic — **Golos Text** or **Onest**.
- **Suggested command:** `/typeset`

### M3. progressBar animates layout properties

- **Location:** `styles/globals.css:106-119`
- **Category:** Performance
- **Description:** `@keyframes progressBar` animates `width` (0% → 100%) and `margin-left`. These are layout properties that trigger reflow.
- **Impact:** Jank on slow devices when progress bar is displayed.
- **Recommendation:** Replace with `transform: scaleX()` with `transform-origin: left`.
- **Suggested command:** `/optimize`

### M4. GuestFeatures — icon+heading+text card grid

- **Location:** `components/Home/GuestHero.tsx:127-146`
- **Category:** Anti-Patterns
- **Description:** 3 identical cards with icon in rounded bg, heading and description. Classic AI landing page pattern.
- **Impact:** Looks templated.
- **Recommendation:** Vary layout — different sizes, asymmetric grid, inline icons instead of icon-in-circle.
- **Suggested command:** `/bolder` or `/arrange`

### M5. Excessive backdrop-blur usage

- **Location:** 35 files, 42 occurrences of `backdrop-blur`
- **Category:** Anti-Patterns / Performance
- **Description:** `backdrop-blur` on every overlay, panel, modal, header, footer. For a reading app this is justified (content focus), but 42 uses is excessive.
- **Impact:** GPU pressure on mobile devices. On older Android devices may cause jank.
- **Standard:** Frontend-design skill: "DON'T: Use glassmorphism everywhere"
- **Recommendation:** Keep blur in modals and overlays (contextually justified). Remove from static elements: Header, BottomNav, BookCover.
- **Suggested command:** `/quieter`

### M6. Arial in SVG fallback

- **Location:** `api/images.ts:388`
- **Category:** Anti-Patterns (minor)
- **Description:** Fallback SVG placeholder uses `font-family="Arial, sans-serif"`.
- **Impact:** Minimal — only in placeholder on image load error.
- **Recommendation:** Replace with `system-ui, sans-serif`.
- **Suggested command:** `/normalize`

---

## Low-Severity Issues

### L1. EpubReader.tsx — setTimeout accumulation

- **Location:** `components/Reader/EpubReader.tsx` — 5+ setTimeout in one component
- **Category:** Performance
- **Description:** Multiple setTimeout for hint display (174-176), status fetch (327-332), selection blocking (556). Rapid mount/unmount can accumulate timeouts.
- **Recommendation:** Consolidate into a single timer manager hook.
- **Suggested command:** `/optimize`

### L2. DebugPanel — ad-hoc z-index 99999

- **Location:** `components/UI/DebugPanel.tsx:159,188`
- **Category:** Theming
- **Description:** z-index 99998/99999 instead of using centralized `Z_INDEX` from `@/lib/zIndex`.
- **Recommendation:** Add `Z_INDEX.debug` to centralized system.
- **Suggested command:** `/normalize`

### L3. Focus ring via box-shadow instead of outline

- **Location:** `styles/globals.css:746-755`
- **Category:** Accessibility
- **Description:** `.focus-ring` uses `box-shadow` instead of `outline`. Box-shadow can be clipped by `overflow: hidden`.
- **WCAG:** 2.4.7 Focus Visible (AA)
- **Recommendation:** Use `outline: 2px solid var(--color-ring)` with `outline-offset: 2px`.
- **Suggested command:** `/harden`

### L4. Missing `sizes` attribute on AuthenticatedImage

- **Location:** `components/UI/AuthenticatedImage.tsx:126`
- **Category:** Performance
- **Description:** `<img>` with `loading="lazy"` but no `sizes` attribute. Browser doesn't know final size for optimal loading.
- **Recommendation:** Add optional `sizes` prop and pass to img element.
- **Suggested command:** `/optimize`

### L5. Heading hierarchy — spot check didn't cover all pages

- **Location:** Across pages
- **Category:** Accessibility
- **Description:** In main components h1→h2→h3 hierarchy is correct. But deep nesting in modals/drawers may break order.
- **WCAG:** 1.3.1 Info and Relationships (A)
- **Recommendation:** Verify heading level when rendering entity drawer inside reader.
- **Suggested command:** `/harden`

### L6. SelectionMenu — animations without prefers-reduced-motion override

- **Location:** `components/Reader/SelectionMenu.tsx`
- **Category:** Accessibility
- **Description:** Color picker uses motion animations. Global reduced-motion rule covers CSS, but motion library animations may not be disabled.
- **Recommendation:** Add `useReducedMotion()` hook from motion and disable entrance animations.
- **Suggested command:** `/harden`

### L7. Dead code: EntityPopup.tsx and BookReader.tsx

- **Location:** Orphaned files (not imported anywhere)
- **Category:** Performance (bundle)
- **Description:** Mentioned in MEMORY.md as dead code. May be included in bundle with wildcard imports.
- **Recommendation:** Delete files or add to .gitignore.
- **Suggested command:** `/distill`

---

## Patterns & Systemic Issues

| Pattern                       | Frequency                        | Resolution                                         |
| ----------------------------- | -------------------------------- | -------------------------------------------------- |
| backdrop-blur on all overlays | 42 occurrences in 35 files       | Audit: keep in modals, remove from static elements |
| Inter font                    | Global                           | Consider UI font replacement                       |
| CSS variable theming          | 80+ variables, 5 themes          | **Excellent** — keep as is                         |
| 44px touch targets            | 86+ elements                     | **Excellent** — keep as is                         |
| Memoization strategy          | 16 memo, 45+ useMemo/useCallback | **Excellent** — adequate coverage                  |

---

## Positive Findings

This codebase deserves high marks in several areas:

1. **Theme system** — 5 complete themes (Light, Dark, Sepia, Outdoor, System) via CSS variables. Semantic tokens for all colors. Better than 90% of projects.

2. **Accessibility** — 348 ARIA attributes, skip link, focus trap in modals, `prefers-reduced-motion`, `prefers-contrast`, sr-only text (26 places). **100%** alt text coverage on images.

3. **Touch targets** — Consistent 44px across entire UI. Meets Apple HIG.

4. **Virtualization** — BookGrid, EntityList, TocSidebar use `@tanstack/react-virtual`. Long lists don't lag.

5. **Offline-first** — Service worker with 5 caching strategies. TanStack Query with `networkMode: 'offlineFirst'` and 24h gcTime. IndexedDB for chapters.

6. **Animation quality** — 11 of 12 animations use transform/opacity (GPU-accelerated). Spring physics with proper damping. No bounce.

7. **Z-index management** — Centralized scale in `@/lib/zIndex`.

8. **iOS Safari** — safe-area-inset, touch-action, overscroll-behavior, 16px input font (anti-zoom). Advanced level.

---

## Recommendations by Priority

### 1. Immediate (this sprint)

| #   | Action                                               | File                                  | Effort |
| --- | ---------------------------------------------------- | ------------------------------------- | ------ |
| H1  | Remove `isVisible` from deps useIntersectionObserver | `hooks/useIntersectionObserver.ts:67` | 5 min  |
| M3  | progressBar: width → scaleX                          | `styles/globals.css:106-119`          | 10 min |
| L7  | Delete dead code (EntityPopup, BookReader)           | Orphaned files                        | 5 min  |

### 2. Short-term (next sprint)

| #   | Action                                     | File                                      | Effort |
| --- | ------------------------------------------ | ----------------------------------------- | ------ |
| H2  | Lazy loading for ImageGrid                 | `components/Images/ImageGrid.tsx`         | 1h     |
| H3  | Batch DOM mutations in entity highlighting | `hooks/epub/useEntityNameHighlighting.ts` | 2h     |
| M1  | Remove gradient text                       | `GuestHero.tsx`, `NotFoundPage.tsx`       | 15 min |
| L3  | Focus ring: box-shadow → outline           | `styles/globals.css:746-755`              | 15 min |

### 3. Medium-term (2-3 sprints)

| #   | Action                                  | File                           | Effort |
| --- | --------------------------------------- | ------------------------------ | ------ |
| M2  | Replace Inter with unique font          | `globals.css:64`, font preload | 2h     |
| M5  | Audit backdrop-blur: keep 15, remove 20 | 35 files                       | 3h     |
| M4  | Redesign GuestFeatures cards            | `GuestHero.tsx`                | 2h     |

### 4. Long-term (nice-to-have)

| #   | Action                                 | File                | Effort |
| --- | -------------------------------------- | ------------------- | ------ |
| L1  | Timer manager hook for EpubReader      | `EpubReader.tsx`    | 2h     |
| L2  | Z_INDEX.debug to centralized system    | `DebugPanel.tsx`    | 15 min |
| L6  | useReducedMotion for motion animations | `SelectionMenu.tsx` | 30 min |

---

## Suggested Commands for Fixes

| Command      | Covers Issues          | Description                                                            |
| ------------ | ---------------------- | ---------------------------------------------------------------------- |
| `/optimize`  | H1, H2, H3, M3, L1, L4 | Performance: observer deps, lazy loading, layout thrashing, animations |
| `/typeset`   | M1, M2                 | Typography: remove gradient text, replace Inter                        |
| `/quieter`   | M5                     | Reduce glassmorphism intensity                                         |
| `/harden`    | L3, L5, L6             | Resilience: focus ring, heading hierarchy, reduced motion              |
| `/normalize` | L2, M6                 | Consistency: z-index, font fallback                                    |
| `/arrange`   | M4                     | Layout: asymmetric GuestFeatures                                       |
| `/distill`   | L7                     | Remove dead code                                                       |
