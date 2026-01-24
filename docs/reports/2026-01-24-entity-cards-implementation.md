# Entity Cards Implementation Report
**Date:** 2026-01-24
**Status:** Implemented (In-Reader Drawer), Pending (Gallery Page)

## 1. Overview
The "Entity Cards" feature has been implemented as a side-drawer within the `EpubReader` component. This allows users to access character and entity details contextually while reading, with spoiler protection based on their reading progress.

## 2. Component Architecture

### A. Reader Integration (`EpubReader.tsx`)
*   **Entry Point:** New button in `ReaderHeader.tsx` (currently "Users" icon).
*   **State:** `isEntityDrawerOpen` (boolean).
*   **Data Fetching:** `useEntityNetwork(bookId)` hook fetches the graph data.
*   **Integration:**
    ```tsx
    const { data: entityNetwork } = useEntityNetwork(book.id);
    // ...
    <EntityDrawer 
        isOpen={isEntityDrawerOpen} 
        entities={entityNetwork?.entities || {}} 
    />
    ```

### B. List View & Drawer (`EntityDrawer.tsx`)
*   **UI Library:** `vaul` (Drawer component).
*   **Layout:**
    *   **Header:** Title "Characters" (needs renaming to "Entities").
    *   **List:** Scrollable list of entities, sorted by importance.
    *   **Avatar:** Shows character portrait (blur/grayscale if not yet met).
    *   **Detail View:** Clicking an item replaces the list with `EntityProfile`.

### C. Entity Profile (`EntityProfile.tsx`)
*   **Hero Section:** Full-width image (or placeholder gradient).
*   **Badges:** Type (Person/Location) and Importance.
*   **Visual Summary:** Contextual description relevant to appearance.
*   **Biography (Notes):** List of text snippets extracted from the book.
    *   **Spoiler Protection:** Text from future chapters (`chapter_index > currentChapter`) is redacted (████).

## 3. Current Issues & Analysis

### Issue 1: "No new page with cards"
**Analysis:** The current task focused on `Frontend: Implement Entity Cards UI` as a component (`EntityDrawer`) for the reader. The dedicated **Gallery View** (`/book/:id/gallery`) corresponds to the next task in the checklist: `Frontend: Implement Gallery View`.
**Resolution:** This is expected behavior versus the plan, but user expectation was for a standalone page. We should implement the Gallery Page next.

### Issue 2: "Icon is 'Users' (people)"
**Analysis:** The icon `<Users />` (Lucide React) implies only people, whereas entities can be locations, artifacts, etc.
**Resolution:** Change icon to `Shapes`, `Network`, or `BookOpenText` to represent a knowledge graph/encyclopedia.

### Issue 3: "Errors on click"
**Analysis:**
1.  **Loading State:** If `useEntityNetwork` is still loading, `entityNetwork` is `undefined`, so we pass `{}`. The drawer opens empty.
2.  **Potential Crash:** If `vaul` or `framer-motion` encounter hydration mismatches or if `entities` object structure doesn't match `Object.values`, it might crash.
3.  **Data Mismatch:** If `avatar_url` is missing or null, the Avatar component fallback handles it, but if `mentions` is not an array, `Math.min(...mentions)` will crash.

## 4. Proposed Fixes & Next Steps

1.  **Icon Update:** Replace `Users` with `Library` or `Shapes` in `ReaderHeader.tsx`.
2.  **Loading State:** Add `isLoading` check in `EntityDrawer` to show a spinner.
3.  **Robustness:** Add safeguards for `mentions` array in `EntityDrawer` and `EntityProfile`.
4.  **Gallery Page:** Proceed to implement the full-page Gallery View as the next major task.
