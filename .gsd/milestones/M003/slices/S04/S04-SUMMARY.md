---
id: S04
parent: M003
milestone: M003
provides:
  - DescriptionDrawer with snap points, image generation button, spinner, preview
  - EntityBottomSheet (Vaul bottom sheet replacing floating EntityPopup)
  - Panel dismiss flow includes DescriptionDrawer and EntityBottomSheet
  - i18n keys for description types (ru/en)
  - Dimmed description CSS (opacity 0.06 instead of 0.15-0.2)
  - Active state (:active) for descriptions and entity-mention spans
  - descriptionHighlightingEnabled toggle in reader store and settings UI
  - ENT-02 fix -- entity/description taps at screen edges not intercepted by navigation
  - handleCenterTap returns boolean for interactive element detection
requires: []
affects: []
key_files: []
key_decisions:
  - "EntityBottomSheet uses entities.type_${type} i18n pattern (matching entityTypeLabels.ts)"
  - "popupEntity state moved to top of EpubReader to avoid block-scoped variable error"
  - "Vaul snap points: [0.4, 0.8] for DescriptionDrawer, [0.3, 0.6] for EntityBottomSheet"
  - "onCenterTap returns boolean | Promise<boolean> -- all callers await result before toggling UI"
  - "entityList and handleEntityClick moved before handleCenterTap in EpubReader for dependency order"
  - "Store version bumped to 6 with migration for descriptionHighlightingEnabled (default: true)"
  - "Highlighter icon from lucide-react for description toggle in settings"
patterns_established:
  - "Vaul Drawer.Root with snap points + useState for activeSnapPoint (entity/description sheets)"
  - "useGenerateImage mutation inside component for on-demand image generation"
  - "handleCenterTap checks both .description-highlight and .entity-mention in DOM traversal"
  - "Async center tap: UI toggle deferred until interactive detection resolves"
observability_surfaces: []
drill_down_paths: []
duration: 16min
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---
# S04: Description Entity Popup

**# Phase 19 Plan 01: DescriptionDrawer + EntityBottomSheet Summary**

## What Happened

# Phase 19 Plan 01: DescriptionDrawer + EntityBottomSheet Summary

**DescriptionDrawer extended with snap points [0.4, 0.8], image generation button/spinner/preview via useGenerateImage; EntityPopup replaced by Vaul EntityBottomSheet with snap points [0.3, 0.6]; panel dismiss flow unified**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-11T18:16:52Z
- **Completed:** 2026-03-11T18:28:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- DescriptionDrawer: snap points [0.4, 0.8], generate/view/spinner buttons, image preview, i18n type badges
- EntityBottomSheet: Vaul bottom sheet replacing floating EntityPopup, snap points [0.3, 0.6], avatar/placeholder, truncated description, Details button
- EpubReader integration: EntityBottomSheet wired in, popupPosition removed, isPanelOpen and handlePanelDismiss extended
- 19 new tests covering both components (TDD red-green cycle)
- i18n keys added for description types and generation actions (ru/en)

## Task Commits

Each task was committed atomically:

1. **Task 1: DescriptionDrawer + EntityBottomSheet (TDD RED)** - `b0014f9` (test)
2. **Task 1: DescriptionDrawer + EntityBottomSheet (TDD GREEN)** - `6ca176b` (feat)
3. **Task 2: Wiring in EpubReader** - `c99aef2` (feat)

_TDD task had separate test and implementation commits_

## Files Created/Modified
- `frontend/src/components/Reader/DescriptionDrawer.tsx` - Extended with snap points, useGenerateImage, generate/view buttons, spinner, preview
- `frontend/src/components/Reader/EntityBottomSheet.tsx` - NEW: Vaul bottom sheet for entity quick-view
- `frontend/src/components/Reader/EpubReader.tsx` - Replaced EntityPopup with EntityBottomSheet, extended panel dismiss
- `frontend/src/locales/ru/translation.json` - Added reader.description_drawer.* keys
- `frontend/src/locales/en/translation.json` - Added reader.description_drawer.* keys
- `frontend/src/components/Reader/__tests__/DescriptionDrawer.test.tsx` - NEW: 10 tests for drawer
- `frontend/src/components/Reader/__tests__/EntityBottomSheet.test.tsx` - NEW: 9 tests for sheet

## Decisions Made
- EntityBottomSheet uses `entities.type_${type}` i18n pattern (matching existing entityTypeLabels.ts) instead of `entities.types.${type}` which was used by old EntityPopup but had no translations
- popupEntity state moved to top of EpubReader component to avoid TypeScript block-scoped variable error (isPanelOpen needs it)
- Vaul snap points chosen per CONTEXT.md: [0.4, 0.8] for DescriptionDrawer, [0.3, 0.6] for EntityBottomSheet
- EntityPopup.tsx file kept (not deleted) -- still referenced by EntityPopup.test.tsx and may be needed for reference

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed block-scoped variable ordering in EpubReader**
- **Found during:** Task 2 (EpubReader wiring)
- **Issue:** Adding `!!popupEntity` to isPanelOpen on line 318 referenced popupEntity before its declaration on line 513
- **Fix:** Moved popupEntity useState declaration from line 513 to line 78 (grouped with other state)
- **Files modified:** frontend/src/components/Reader/EpubReader.tsx
- **Verification:** `npm run build` passes without TS errors
- **Committed in:** c99aef2

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for TypeScript compilation. No scope creep.

## Issues Encountered
- Pre-existing test failures in EpubReader.test.tsx (missing VITE_API_BASE_URL env var) and ErrorBoundary.test.tsx -- unrelated to changes

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- DescriptionDrawer and EntityBottomSheet ready for Plan 02 (ENT-02 fix, CSS dimming, toggle)
- EntityPopup.tsx can be safely deleted after removing its test file or updating it
- Panel dismiss flow fully unified -- ready for edge tap fix in Plan 02

## Self-Check: PASSED

All 5 files verified present. All 3 commits (b0014f9, 6ca176b, c99aef2) found in git log.

---
*Phase: 19-description-entity-popup*
*Completed: 2026-03-11*

# Phase 19 Plan 02: CSS Dimming + Active States + ENT-02 Fix Summary

**Description highlights dimmed to 6% opacity with :active tap feedback, settings toggle for descriptions, and ENT-02 fix for entity/description taps at screen edges and iOS center zone**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-11T18:36:40Z
- **Completed:** 2026-03-11T18:52:40Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Description background opacity reduced from 15-20% to 6% across all types (location, character, atmosphere, object, action) for both anchor and full modes
- :active CSS pseudo-class added for both .description-highlight and .entity-mention spans (instant visual feedback on tap)
- descriptionHighlightingEnabled toggle added to reader store (version 6 with migration) and ReaderControls settings panel
- ENT-02 fixed: handleCenterTap now detects both descriptions AND entities, returns boolean to prevent UI toggle when interactive element tapped
- iOS overlay, iframe touchend, and desktop click handlers all await handleCenterTap result before toggling UI
- Entity taps in iOS center zone now work (previously only descriptions were detected)

## Task Commits

Each task was committed atomically:

1. **Task 1: CSS opacity + active states + description toggle** - `ea512f4` (feat)
2. **Task 2: ENT-02 fix -- taps on descriptions/entities at screen edges** - `583c5f4` (fix)

## Files Created/Modified
- `frontend/src/hooks/epub/useDescriptionHighlighting.ts` - TYPE_COLORS bg 0.06, active 0.15; TYPE_FULL_COLORS bg 0.06, hover 0.12; :active CSS rules
- `frontend/src/hooks/epub/useEntityNameHighlighting.ts` - :active CSS rule for .entity-mention
- `frontend/src/stores/reader.ts` - descriptionHighlightingEnabled state, action, partialize, migration v6
- `frontend/src/components/Reader/ReaderControls.tsx` - Description highlighting toggle with Highlighter icon
- `frontend/src/components/Reader/Core/ReaderUI.tsx` - descriptionHighlightingEnabled prop passthrough
- `frontend/src/components/Reader/EpubReader.tsx` - handleCenterTap returns boolean, checks entity-mention, entity block moved up
- `frontend/src/hooks/epub/useGestureController.ts` - onCenterTap type returns boolean, all callers await result
- `frontend/src/locales/ru/translation.json` - entities.description_highlighting key
- `frontend/src/locales/en/translation.json` - entities.description_highlighting key

## Decisions Made
- onCenterTap changed to return `boolean | Promise<boolean>` -- all three call sites (iframe touchend, desktop click, iOS overlay) now await result and only toggle UI if no interactive element found
- entityList and handleEntityClick moved before handleCenterTap in EpubReader to satisfy dependency order (useCallback deps array)
- Reader store version bumped from 5 to 6 with migration that sets descriptionHighlightingEnabled = true for existing users
- Used Highlighter icon from lucide-react for the description toggle (consistent with other settings icons)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reordered hook declarations in EpubReader**
- **Found during:** Task 2 (ENT-02 fix)
- **Issue:** handleCenterTap references entityList and handleEntityClick in its deps array, but they were declared ~270 lines later in the file
- **Fix:** Moved entityList, handleEntityClick, drawerInitialEntityId, entityNetwork, and prefetchEntityNetwork declarations before handleCenterTap
- **Files modified:** frontend/src/components/Reader/EpubReader.tsx
- **Verification:** `npm run build` passes without errors
- **Committed in:** 583c5f4

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for TypeScript compilation. No scope creep.

## Issues Encountered
- Pre-existing test failures in EpubReader.test.tsx (missing VITE_API_BASE_URL env var) and ErrorBoundary.test.tsx -- unrelated to changes, same as Plan 01

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 19 complete: DescriptionDrawer, EntityBottomSheet, dimmed CSS, active states, settings toggle, ENT-02 fixed
- Ready for Phase 20 (if any) or milestone completion
- Manual UAT recommended on Pixel 9 and iOS Safari for gesture verification

## Self-Check: PASSED

All 7 modified files verified present. Both commits (ea512f4, 583c5f4) found in git log.

---
*Phase: 19-description-entity-popup*
*Completed: 2026-03-11*
