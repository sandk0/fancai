# Plan: Migration to Sonner 2.x

**Date**: 2026-02-04  
**Status**: Ready for implementation  
**Effort**: 2-4 hours  
**Risk**: Low (single atomic commit, easy revert)

---

## 1. Context & Problem

Mobile notifications overflow beyond the right edge of the screen. Investigation showed the best solution is migrating from the custom `NotificationContainer` (363 lines, motion/react animations) + legacy `react-hot-toast` to **Sonner 2.0.7** which:

- Is the React toast standard in 2025-2026 (11.9k GitHub stars, 490k+ dependents)
- Compatible with React 19 (`^18.0.0 || ^19.0.0`)
- Solves mobile overflow at the CSS level (`width: calc(100% - offset*2)`)
- Supports swipe-to-dismiss, safe-area, mobileOffset
- Native TailwindCSS support via `classNames` API
- Replaces 363 lines of custom code

---

## 2. Current Architecture

### 2.1. System 1 — Custom NotificationContainer (main system)

**State management** (`stores/ui.ts`):
- Zustand store `useUIStore` contains a `notify` property (object with methods)
- Standalone exported `notify` object outside the store (separate copy)
- Both patterns call `addNotification()` which manages `notifications[]` array + timer-based auto-dismiss via `notificationTimers` Map

**API:**
| Method | Duration | Notes |
|--------|----------|-------|
| `notify.success(title, message?)` | 5000ms | |
| `notify.error(title, message?, action?)` | 10000ms | Persistent if `action` provided |
| `notify.warning(title, message?, action?)` | 7000ms | Persistent if `action` provided |
| `notify.info(title, message?)` | 5000ms | |
| `notify.loading(title, message?)` | Persistent | + `setLoading(true)` |
| `notify.stopLoading()` | — | `setLoading(false)` |

**Verified by grep:**
- `notify.loading()` and `notify.stopLoading()` — **not called anywhere** (dead code)
- `action` (3rd argument) — **not passed anywhere** (but API must be preserved for back-compat)

**Types** (`types/state.ts`):
```typescript
interface UIState {
  notifications: Notification[];
  addNotification: (...) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  notify: { success, error, warning, info };
}

interface NotificationAction { label: string; onClick: () => void; }
interface Notification { id, type, title, message?, timestamp, duration?, action? }
```

**UI component** (`components/UI/NotificationContainer.tsx` — 361 lines):
- motion/react spring animations (slide right on desktop, slide down on mobile)
- Progress bar with requestAnimationFrame + pause on hover/touch
- Desktop: top-right, Mobile: top-center with `safe-area-inset-top`
- Exports: `NotificationContainer` (default), `Toast`, types `ToastVariant`, `ToastProps`

**Rendering**: `Layout.tsx` line 57: `<NotificationContainer />`

**Barrel exports** (`components/UI/index.ts`):
```typescript
export { default as NotificationContainer } from './NotificationContainer';
export type { ToastVariant, ToastProps } from './NotificationContainer';
```

### 2.2. System 2 — react-hot-toast (legacy, 3 files)

| File | Usage |
|------|-------|
| `App.tsx` | `import { Toaster } from 'react-hot-toast'` + `<Toaster position="top-right" ...>` |
| `ProfilePage.tsx` | `toast.success(msg)`, `toast.error(msg)` |
| `ParsingOverlay.tsx` | `toast.success(msg)`, `toast.error(msg)` |

Additionally: `vite.config.ts` line 138 — `'react-hot-toast'` in `manualChunks.vendor-utils`.

### 2.3. Two access patterns for `notify`

**Pattern A — Standalone import (14 files):**
```typescript
import { notify } from '@/stores/ui';
notify.success('Title', 'Message');
```

Files: `db.ts` (dynamic import), `AdminDashboardEnhanced.tsx`, `LibraryPage.tsx`, `LoginPage.tsx`, `RegisterPage.tsx`, `useReadingSession.ts`, `useParsingStatus.ts`, `useImageModal.ts`, `useDescriptionManagement.ts`, `useAutoParser.ts`, `AdminEntityMerge.tsx`, `EpubReader.tsx`

**Pattern B — Store property (5 files):**
```typescript
const { notify } = useUIStore();         // in components (4 files)
const { notify } = useUIStore.getState(); // in non-components (1 file)
```

Files: `ReaderSettings.tsx`, `ImageGallery.tsx`, `ImageModal.tsx`, `BookUploadModal.tsx`, `serviceWorker.ts`

**Re-export**: `stores/index.ts` line 11: `export { useUIStore, notify } from './ui'`

### 2.4. Tests mocking `notify`

| Test file | What it mocks | Asserts on notify? |
|-----------|---------------|-------------------|
| `pages/__tests__/LibraryPage.test.tsx` | `notify` + `getState: () => ({ notifications: [] })` | No |
| `hooks/__tests__/useReadingSession.test.ts` | `notify: { success, error, warning, info }` | Yes (`notify.warning`) |
| `hooks/epub/__tests__/useImageModal.test.ts` | `notify` | Yes (`notify.success/error`) |
| `components/Reader/__tests__/EpubReader.test.tsx` | `notify` | Yes |
| `services/__tests__/syncQueue.test.ts` | `notify: { success, error, warning, info }` | No |
| `components/__tests__/BookReader.test.tsx.skip` | `notify` (skipped test) | N/A |

### 2.5. Critical routing detail

In `App.tsx` lines 94-105, route `/book/:bookId/read` renders `<BookReaderPage>` **WITHOUT `<Layout>` wrapper**. All other protected routes are inside `<Layout>`. Components inside the reader (`EpubReader`, `useAutoParser`, `useDescriptionManagement`, `useImageModal`, `useReadingSession`) all call `notify`.

---

## 3. Issues Found in Original Plan

### CRITICAL

| # | Issue | Impact | Solution |
|---|-------|--------|----------|
| 1 | **Sonner `<Toaster>` placement**: Plan proposes putting it in `Layout.tsx`. But `BookReaderPage` renders outside Layout — reader notifications (5+ heavy users) will be invisible. | Silent notification loss in reader | Put `<Toaster>` in **`App.tsx`** (replacing react-hot-toast's Toaster), not in Layout. |
| 2 | **`vite.config.ts` not in plan**: `'react-hot-toast'` is in `manualChunks.vendor-utils` (line 138). Build will fail with `Could not resolve "react-hot-toast"` after uninstall. | Build breaks | Replace `'react-hot-toast'` with `'sonner'` in manualChunks. |
| 3 | **Sonner API uses `description`, not `message`**: `toast.success(title, { description: message })`. Without this mapping, all `message` parameters (~40 call sites) will be silently dropped — toasts show titles only. | UX regression: missing message text | Map `message` to `description` in the wrapper. |
| 4 | **Duration mismatch**: Sonner default is 4000ms for all types. Current: success/info=5000, warning=7000, error=10000. Errors would auto-dismiss in 4s instead of 10s. | UX regression: errors disappear too fast | Set explicit `duration` in each wrapper method. |

### HIGH

| # | Issue | Impact | Solution |
|---|-------|--------|----------|
| 5 | **`notifications[]`, `addNotification`, `removeNotification`, `clearNotifications` become dead code** after migration. | Tech debt, confusing dual state | Remove all notification state from Zustand store. |
| 6 | **`UIState` interface** declares notification properties that no longer exist. | TypeScript errors | Update `types/state.ts` to remove notification properties. |
| 7 | **5 files use `const { notify } = useUIStore()`** — if `notify` is removed from store, they get runtime errors. | Runtime crash in 5 components | Migrate these 5 files to standalone `import { notify }`. |
| 8 | **`LibraryPage.test.tsx` mocks `notifications: []`** in getState. | Stale mock, potential type error | Remove `notifications: []` from the mock. |
| 9 | **Accessibility: Sonner uses `role="status"`** vs current `role="alert" aria-live="polite"`. | Subtle screen reader regression for errors | Accept — Sonner's `aria-live="polite"` on container is WCAG-compliant. |
| 10 | **`stores/index.ts` re-exports `notify`** — must continue to work. | Import breakage if export removed | No action needed — standalone `notify` export is preserved unchanged. |

### MEDIUM

| # | Issue | Impact | Solution |
|---|-------|--------|----------|
| 11 | **Dark mode / theme mapping**: App uses 5 reader themes with CSS custom properties (`--color-success-muted`, etc.). Sonner's `richColors` uses its own HSL palette that won't match. | Visual inconsistency with design tokens | Start with `richColors` + `theme="system"`. Override CSS variables if needed later. |
| 12 | **Z-index: Sonner uses `999999999`** vs centralized scale topping at 1000. | Breaks z-index scale convention (no functional issue — toasts should be on top) | Override via `[data-sonner-toaster] { z-index: 800 }` or accept and document. |
| 13 | **Animation differences**: Current uses motion/react springs (overshoot/bounce). Sonner uses CSS cubic-bezier (smooth, no bounce). | Visual "feel" change | Accept — Sonner animations are polished. No action. |
| 14 | **iOS safe-area**: Current container uses `env(safe-area-inset-top)`. Sonner's `mobileOffset` doesn't include safe-area by default. | Toasts may overlap notch/Dynamic Island | CSS override: `[data-sonner-toaster] { top: calc(env(safe-area-inset-top, 0px) + 16px) }` or use `offset` prop. |
| 15 | **`ProfilePage`/`ParsingOverlay` visual change**: react-hot-toast showed plain text. Sonner shows bold title. | Minor visual difference | Accept — title-only style is consistent with rest of app. |
| 16 | **`ToastVariant`, `ToastProps` exports** from barrel are unused externally. | Dead exports | Remove from `index.ts`. |

### LOW

| # | Issue | Impact | Solution |
|---|-------|--------|----------|
| 17 | **`notifyFallbackOnce` in `db.ts`** uses dynamic import of `notify`. | None — works unchanged | No action. |
| 18 | **`notify.loading()` / `notify.stopLoading()` coupling** with `setLoading`. | Dead code | Remove both methods. |
| 19 | **`notificationTimers` Map** becomes unnecessary. | Dead code | Remove. |
| 20 | **`syncQueue.test.ts` also mocks `notify`** — not in original file list. | None — mock shape matches | No action needed. |
| 21 | **Sonner CSS with Vite 7 + TailwindCSS 4 `@layer`**: CSS specificity ordering might override Sonner styles. | Potential unstyled toasts | Verify visually. If needed, add explicit import or `@layer components` overrides. |

---

## 4. Architectural Decision: Remove `notify` from Zustand Store

**Recommendation: Remove `notify` property from the store entirely.**

After migration, the store's `notify` would be a wrapper around `toast()` that doesn't read or write Zustand state. This violates the purpose of a store property.

**Before (current — duplicated logic):**
```
Store.notify.success()     → get().addNotification() → state update → UI renders
Standalone notify.success() → getState().addNotification() → state update → UI renders
```

**After (clean — single API surface):**
```
Standalone notify.success() → toast.success() → Sonner renders internally
```

The 5 files using `useUIStore().notify` must be migrated to `import { notify } from '@/stores/ui'`.

---

## 5. Complete File Change List

| # | File | Action |
|---|------|--------|
| 1 | `frontend/package.json` | `+sonner`, `-react-hot-toast` |
| 2 | `frontend/vite.config.ts` | Replace `'react-hot-toast'` with `'sonner'` in manualChunks |
| 3 | `frontend/src/stores/ui.ts` | Rewrite `notify` to call `toast()` from sonner; remove `notifications[]`, `addNotification`, `removeNotification`, `clearNotifications`, `notificationTimers`, store `notify` property, `notify.loading`, `notify.stopLoading` |
| 4 | `frontend/src/types/state.ts` | Remove `notifications`, `addNotification`, `removeNotification`, `clearNotifications`, `notify` from `UIState`. Remove `Notification` interface. Keep `NotificationAction`. |
| 5 | `frontend/src/App.tsx` | Replace `import { Toaster } from 'react-hot-toast'` with `import { Toaster } from 'sonner'`. Replace `<Toaster>` JSX with Sonner config. |
| 6 | `frontend/src/components/Layout/Layout.tsx` | Remove `import NotificationContainer` and `<NotificationContainer />` |
| 7 | `frontend/src/components/UI/NotificationContainer.tsx` | **DELETE** |
| 8 | `frontend/src/components/UI/index.ts` | Remove `NotificationContainer`, `ToastVariant`, `ToastProps` exports |
| 9 | `frontend/src/pages/ProfilePage.tsx` | `react-hot-toast` → `import { notify }` |
| 10 | `frontend/src/components/UI/ParsingOverlay.tsx` | `react-hot-toast` → `import { notify }` |
| 11 | `frontend/src/components/Settings/ReaderSettings.tsx` | `useUIStore().notify` → `import { notify }` |
| 12 | `frontend/src/components/Images/ImageGallery.tsx` | `useUIStore().notify` → `import { notify }` |
| 13 | `frontend/src/components/Images/ImageModal.tsx` | `useUIStore().notify` → `import { notify }` |
| 14 | `frontend/src/components/Books/BookUploadModal.tsx` | `useUIStore().notify` → `import { notify }` |
| 15 | `frontend/src/utils/serviceWorker.ts` | `useUIStore.getState().notify` → `import { notify }` |
| 16 | `frontend/src/pages/__tests__/LibraryPage.test.tsx` | Remove `notifications: []` from mock |
| 17 | `frontend/src/lib/zIndex.ts` | Update comment for `toast: 800` (Sonner uses its own z-index) |
| 18 | `frontend/src/pages/LibraryPage.tsx` | Commit existing body overflow fix (already done, uncommitted) |
| 19 | `frontend/src/styles/globals.css` | Optional: add Sonner z-index/safe-area CSS overrides |

---

## 6. Step-by-Step Implementation Plan

### Step 1: Install sonner, uninstall react-hot-toast

```bash
cd frontend && npm install sonner && npm uninstall react-hot-toast
```

### Step 2: Update `vite.config.ts`

Replace `'react-hot-toast'` with `'sonner'` in the `vendor-utils` manual chunk (line 138).

### Step 3: Rewrite `stores/ui.ts` (core change)

This is the most important step. The `notify` standalone export changes implementation from `addNotification()` to Sonner's `toast()`.

**Add import:**
```typescript
import { toast } from 'sonner';
```

**Rewrite standalone `notify` object:**
```typescript
export const notify = {
  success: (title: string, message?: string) => {
    toast.success(title, { description: message, duration: 5000 });
  },

  error: (title: string, message?: string, action?: NotificationAction) => {
    toast.error(title, {
      description: message,
      duration: action ? Infinity : 10000,
      action: action ? { label: action.label, onClick: action.onClick } : undefined,
    });
  },

  warning: (title: string, message?: string, action?: NotificationAction) => {
    toast.warning(title, {
      description: message,
      duration: action ? Infinity : 7000,
      action: action ? { label: action.label, onClick: action.onClick } : undefined,
    });
  },

  info: (title: string, message?: string) => {
    toast.info(title, { description: message, duration: 5000 });
  },
};
```

**Remove from module scope:**
- `notificationTimers` Map
- `notify.loading()` method
- `notify.stopLoading()` method

**Remove from Zustand store:**
- `notifications: []` state
- `notify: { ... }` property (lines 27-63)
- `addNotification` action
- `removeNotification` action
- `clearNotifications` action

**Keep in store:** All non-notification state and actions (`isLoading`, `setLoading`, modals, sidebar, etc.)

### Step 4: Update `types/state.ts`

Remove from `UIState` interface:
```typescript
// REMOVE these lines:
notifications: Notification[];
addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
removeNotification: (id: string) => void;
clearNotifications: () => void;
notify: { ... };
```

Remove `Notification` interface (no longer needed).

Keep `NotificationAction` interface (used by standalone `notify.error/warning` signature).

### Step 5: Migrate 5 store-property files to standalone import

For each of: `ReaderSettings.tsx`, `ImageGallery.tsx`, `ImageModal.tsx`, `BookUploadModal.tsx`, `serviceWorker.ts`:

**Before:**
```typescript
import { useUIStore } from '@/stores/ui';
// ...
const { notify, someOtherProp } = useUIStore();
```

**After:**
```typescript
import { useUIStore, notify } from '@/stores/ui';  // or separate import line
// ...
const { someOtherProp } = useUIStore();  // remove notify from destructure
```

For `serviceWorker.ts`:
```typescript
// Before:
const { notify } = useUIStore.getState();
// After:
import { notify } from '@/stores/ui';
// (remove the getState() call for notify)
```

### Step 6: Replace react-hot-toast calls

**`ProfilePage.tsx`:**
```typescript
// Before:
import toast from 'react-hot-toast';
toast.success(t('profile.update_success'));
toast.error(getErrorMessage(error, t('profile.update_error')));

// After:
import { notify } from '@/stores/ui';
notify.success(t('profile.update_success'));
notify.error(getErrorMessage(error, t('profile.update_error')));
```

**`ParsingOverlay.tsx`:**
```typescript
// Before:
import toast from 'react-hot-toast';
toast.success(t('ui.parsing.complete_success'));
toast.error(t('ui.parsing.connection_error'));

// After:
import { notify } from '@/stores/ui';
notify.success(t('ui.parsing.complete_success'));
notify.error(t('ui.parsing.connection_error'));
```

### Step 7: Replace both Toaster components with Sonner

**`App.tsx`** — Replace react-hot-toast Toaster with Sonner Toaster:
```typescript
// Before:
import { Toaster } from 'react-hot-toast';
// ...
<Toaster
  position="top-right"
  toastOptions={{
    duration: 4000,
    className: 'bg-popover text-popover-foreground border border-border',
    success: { className: 'bg-green-500 text-white border-green-600' },
    error: { className: 'bg-destructive text-destructive-foreground border-destructive' },
  }}
/>

// After:
import { Toaster } from 'sonner';
// ...
<Toaster
  position="top-center"
  richColors
  theme="system"
  closeButton
  toastOptions={{
    className: 'font-sans',
  }}
/>
```

**`Layout.tsx`** — Remove NotificationContainer:
```typescript
// Remove:
import NotificationContainer from '@/components/UI/NotificationContainer';
// Remove from JSX:
<NotificationContainer />
```

### Step 8: Delete `NotificationContainer.tsx`

```bash
rm frontend/src/components/UI/NotificationContainer.tsx
```

### Step 9: Update barrel exports (`UI/index.ts`)

Remove:
```typescript
export { default as NotificationContainer } from './NotificationContainer';
export type { ToastVariant, ToastProps } from './NotificationContainer';
```

### Step 10: Update tests

**`pages/__tests__/LibraryPage.test.tsx`** — Remove stale `notifications: []` from mock:
```typescript
// Before:
getState: vi.fn(() => ({ notifications: [] })),

// After:
getState: vi.fn(() => ({})),
```

All other test mocks (`useReadingSession.test.ts`, `useImageModal.test.ts`, `EpubReader.test.tsx`, `syncQueue.test.ts`) mock the standalone `notify` export with `{ success, error, warning, info }` — this exact shape is preserved, so **no changes needed**.

### Step 11: Update z-index documentation

**`lib/zIndex.ts`** — Update comment:
```typescript
// Layer 7: Notifications & Toasts
// Note: Sonner uses its own z-index (999999999). Override in globals.css if needed.
toast: 800,
```

**`styles/globals.css`** — Optional: Override Sonner z-index and safe-area:
```css
/* Sonner toast overrides */
[data-sonner-toaster] {
  --offset: 16px;
  z-index: 800 !important;
}

/* iOS safe area for top-positioned toasts */
@supports (padding-top: env(safe-area-inset-top)) {
  [data-sonner-toaster][data-y-position="top"] {
    top: calc(env(safe-area-inset-top, 0px) + 16px) !important;
  }
}
```

### Step 12: Build, test, verify

```bash
cd frontend

# Type check
npm run type-check

# Build (catches vite.config issues + type errors)
npm run build

# Run tests
npm test

# Manual verification checklist:
# [ ] Login page error → notify.error visible
# [ ] Library page delete book → notify.success visible
# [ ] Book reader (outside Layout!) → notifications work
# [ ] Profile page update → success notification (was react-hot-toast)
# [ ] Mobile viewport → no overflow, safe-area respected
# [ ] Dark mode → toasts have correct colors
# [ ] Hover toast → pause behavior
# [ ] Swipe toast → dismiss
```

---

## 7. Verified Non-Issues

These were investigated and confirmed safe:

| Item | Why it's safe |
|------|---------------|
| `notifyFallbackOnce` in `db.ts` (dynamic import) | Uses standalone `notify` export — works unchanged |
| `chapterCache.ts`, `imageCache.ts`, `epubCache.ts` | Import `notifyFallbackOnce` from `db.ts` — transitive, unaffected |
| `stores/index.ts` re-export | `export { useUIStore, notify } from './ui'` — `notify` export preserved |
| `NotificationsSettingsSection` | Unrelated — push notification toggles |
| `pushNotifications.ts`, `usePushNotifications.ts` | Unrelated — Web Push API |
| `downloadManager.ts` `notifyProgress()` | Unrelated — naming collision only |
| `syncQueue.ts` `notifyListeners()` | Unrelated — naming collision only |
| Sonner React 19 compatibility | Confirmed: peer dep `^18.0.0 \|\| ^19.0.0` |
| SSR concerns | N/A — CSR SPA (Vite, no SSR) |
| `BookReader.test.tsx.skip` | Skipped test file — no impact |

---

## 8. Rollback Safety

**Risk: LOW.** Fully reversible.

1. All changes are frontend only — no backend, database, or API changes
2. Single git commit — `git revert` undoes everything
3. The `notify.*` call signature is preserved — no consumers change their API
4. After revert: `npm install` restores react-hot-toast from package-lock.json

---

## 9. Post-Migration Cleanup (Optional, Future)

These are not required for the migration but improve the codebase:

1. **CSS variable overrides** for Sonner to match design tokens (if `richColors` visual diff is unacceptable)
2. **Remove `Notification` interface** from `types/state.ts` if no code references it
3. **Remove `motion/react` imports** that were only used by NotificationContainer (but motion/react is still used throughout the app, so no bundle savings)
4. **Simplify test mocks** — tests mock `@/stores/ui` module; after migration the mock shape is exactly `{ notify: { success, error, warning, info } }` which is what they already use
