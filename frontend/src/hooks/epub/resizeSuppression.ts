/**
 * ResizeObserver suppression utilities for epub.js DOM mutations
 *
 * epub.js 0.3.93 uses a ResizeObserver on the iframe's documentElement
 * to detect content size changes. When we wrap text in highlight spans,
 * the size changes trigger a cascade: RESIZE -> expand -> layout.format ->
 * clear -> display, destroying all custom DOM modifications.
 *
 * Solution: Temporarily disconnect the ResizeObserver during DOM mutations,
 * update the cached _size to match post-mutation dimensions, then reconnect.
 * This prevents the cascade because resizeCheck() will see matching dimensions.
 *
 * Three exported functions:
 * - withResizeSuppression: synchronous mutation wrapper (disconnect -> mutate -> reconnect)
 * - disconnectResizeObserver: for async scenarios (disconnect before async work)
 * - reconnectResizeObserver: for async scenarios (reconnect after async work completes)
 *
 * @see epub.js contents.js lines 429-443 (resizeCheck), 526-534 (ResizeObserver)
 */

import type { Rendition } from '@/types/epub';

/**
 * Internal state interface for epub.js Contents (stable since 0.3.x, 2018)
 */
interface ContentsInternal {
  observer?: ResizeObserver;
  _size?: { width: number; height: number };
  textWidth: () => number;
  textHeight: () => number;
  document?: Document;
}

/**
 * Get the internal Contents object from a Rendition, with type casting.
 * Returns null if contents are not available.
 */
function getContentsInternal(rendition: Rendition): ContentsInternal | null {
  try {
    const contents = rendition.getContents();
    if (!contents?.length) return null;
    return contents[0] as unknown as ContentsInternal;
  } catch {
    return null;
  }
}

/**
 * Execute a synchronous DOM mutation within an epub.js iframe without
 * triggering the ResizeObserver resize cascade.
 *
 * Pattern: disconnect observer -> mutation -> update _size -> reconnect observer
 *
 * If contents are not available (not yet loaded or already destroyed),
 * the mutation is still executed without error.
 *
 * @param rendition - epub.js Rendition instance
 * @param mutation - Synchronous callback that performs DOM mutations
 * @throws Re-throws any error from the mutation callback (after reconnecting observer)
 */
export function withResizeSuppression(rendition: Rendition, mutation: () => void): void {
  const c = getContentsInternal(rendition);

  if (!c) {
    mutation();
    return;
  }

  const observer = c.observer;
  const docEl = c.document?.documentElement;

  // 1. Disconnect observer before mutation
  if (observer) {
    observer.disconnect();
  }

  try {
    // 2. Perform DOM mutation
    mutation();

    // 3. Update _size to current dimensions (prevents cascade on reconnect)
    if (c._size && c.textWidth && c.textHeight) {
      c._size = {
        width: c.textWidth(),
        height: c.textHeight(),
      };
    }
  } finally {
    // 4. Reconnect observer (guaranteed even if mutation throws)
    if (observer && docEl) {
      observer.observe(docEl);
    }
  }
}

/**
 * Disconnect the ResizeObserver from an epub.js rendition.
 * Use this for async scenarios where the mutation spans multiple frames.
 * Must be paired with reconnectResizeObserver().
 *
 * @param rendition - epub.js Rendition instance
 */
export function disconnectResizeObserver(rendition: Rendition): void {
  const c = getContentsInternal(rendition);
  if (!c?.observer) return;
  c.observer.disconnect();
}

/**
 * Reconnect the ResizeObserver to an epub.js rendition after async mutations.
 * Updates _size to current dimensions before reconnecting to prevent cascade.
 * Must be called after disconnectResizeObserver().
 *
 * @param rendition - epub.js Rendition instance
 */
export function reconnectResizeObserver(rendition: Rendition): void {
  const c = getContentsInternal(rendition);
  if (!c) return;

  // Update _size to current dimensions
  if (c._size && c.textWidth && c.textHeight) {
    c._size = {
      width: c.textWidth(),
      height: c.textHeight(),
    };
  }

  // Reconnect observer
  const docEl = c.document?.documentElement;
  if (c.observer && docEl) {
    c.observer.observe(docEl);
  }
}
