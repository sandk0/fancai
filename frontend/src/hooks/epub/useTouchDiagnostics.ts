/**
 * useTouchDiagnostics - Diagnostic hook for iOS touch event debugging
 *
 * Attaches passive capture-phase listeners to both iframe and parent documents
 * to log touch/pointer events without interfering with existing event handling.
 * Active only when debug mode is enabled (?debug=1).
 *
 * Also provides getTouchActionInfo() to inspect computed CSS touch-action
 * values for key elements in the reader DOM hierarchy.
 */

import { useEffect, useRef } from 'react';
import type { Rendition } from '@/types/epub';
import { logger, isDebugActive } from '@/lib/logger';

const TOUCH_EVENTS = [
  'touchstart',
  'touchmove',
  'touchend',
  'pointerdown',
  'pointermove',
  'pointerup',
] as const;

const THROTTLED_EVENTS = new Set(['touchmove', 'pointermove']);
const THROTTLE_MS = 100;

/**
 * Attach diagnostic listeners to a document for touch/pointer events.
 * All listeners use { capture: true, passive: true } to observe without interference.
 *
 * @param doc - The document to attach listeners to (iframe or parent)
 * @param label - Label for log entries ('iframe' or 'parent')
 * @returns Cleanup function to remove all listeners
 */
export function attachDiagnosticListeners(doc: Document, label: string): () => void {
  const lastLogTime: Record<string, number> = {};
  const handlers: Array<{ type: string; handler: EventListener }> = [];

  for (const eventType of TOUCH_EVENTS) {
    const handler = (e: Event) => {
      // Throttle move events
      if (THROTTLED_EVENTS.has(eventType)) {
        const now = Date.now();
        const last = lastLogTime[eventType] || 0;
        if (now - last < THROTTLE_MS) return;
        lastLogTime[eventType] = now;
      }

      // Extract coordinates
      const te = e as TouchEvent;
      const pe = e as PointerEvent;
      const touch = te.touches?.[0] || te.changedTouches?.[0];
      const x = touch?.clientX ?? pe?.clientX ?? 0;
      const y = touch?.clientY ?? pe?.clientY ?? 0;

      logger.debug(`[touch-diag] ${label} ${eventType}`, {
        type: eventType,
        source: label,
        x,
        y,
        cancelable: e.cancelable,
        defaultPrevented: e.defaultPrevented,
        ts: Date.now(),
      });
    };

    doc.addEventListener(eventType, handler as EventListener, { capture: true, passive: true });
    handlers.push({ type: eventType, handler: handler as EventListener });
  }

  return () => {
    for (const { type, handler } of handlers) {
      doc.removeEventListener(type, handler, { capture: true });
    }
  };
}

/**
 * Get computed CSS touch-action values for key reader elements.
 *
 * @param rendition - epub.js rendition instance
 * @returns Record mapping element selector/label to computed touch-action value
 */
export function getTouchActionInfo(rendition: Rendition): Record<string, string> {
  const result: Record<string, string> = {};

  // Parent document elements
  const viewer = document.getElementById('epub-viewer');
  if (viewer) {
    result['#epub-viewer'] = getComputedStyle(viewer).touchAction;
  }

  // iOS overlay
  const overlay = document.getElementById('gesture-controller-ios-overlay');
  if (overlay) {
    result['iOS overlay'] = getComputedStyle(overlay).touchAction;
  }

  // Iframe elements
  const iframe = viewer?.querySelector('iframe') as HTMLIFrameElement | null;
  if (iframe) {
    result['iframe (element)'] = getComputedStyle(iframe).touchAction;

    try {
      const iframeDoc = iframe.contentDocument;
      if (iframeDoc?.body) {
        result['iframe body'] = getComputedStyle(iframeDoc.body).touchAction;
      }
      if (iframeDoc?.documentElement) {
        result['iframe html'] = getComputedStyle(iframeDoc.documentElement).touchAction;
      }
    } catch {
      result['iframe (cross-origin)'] = 'ACCESS DENIED';
    }
  }

  // Also check via rendition.getContents()
  try {
    const contents = rendition.getContents();
    if (contents?.[0]?.document) {
      const doc = contents[0].document;
      if (doc.body && !result['iframe body']) {
        result['iframe body'] = getComputedStyle(doc.body).touchAction;
      }
      if (doc.documentElement && !result['iframe html']) {
        result['iframe html'] = getComputedStyle(doc.documentElement).touchAction;
      }
    }
  } catch {
    // Ignore -- fallback path
  }

  return result;
}

/**
 * Hook for touch event diagnostics in the epub reader.
 * Active only when isDebugActive() returns true.
 *
 * Attaches diagnostic listeners to both iframe and parent documents
 * on each 'rendered' event from the rendition.
 *
 * @param rendition - epub.js rendition instance (or null)
 */
export function useTouchDiagnostics(rendition: Rendition | null): void {
  const cleanupRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!rendition || !isDebugActive()) return;

    const onRendered = () => {
      // Clean up previous listeners
      for (const cleanup of cleanupRef.current) {
        cleanup();
      }
      cleanupRef.current = [];

      // Attach to iframe document
      try {
        const contents = rendition.getContents();
        const iframeDoc = contents?.[0]?.document;
        if (iframeDoc) {
          cleanupRef.current.push(attachDiagnosticListeners(iframeDoc, 'iframe'));
        }
      } catch {
        logger.debug('[touch-diag] Could not attach iframe listeners');
      }

      // Attach to parent document
      cleanupRef.current.push(attachDiagnosticListeners(document, 'parent'));

      // Log CSS touch-action info
      const info = getTouchActionInfo(rendition);
      logger.debug('[touch-diag] CSS touch-action', info);

      // Experiment: test -webkit-overflow-scrolling on #epub-viewer
      const viewer = document.getElementById('epub-viewer');
      if (viewer) {
        viewer.style.setProperty('-webkit-overflow-scrolling', 'touch');
        logger.debug('[touch-diag] Applied -webkit-overflow-scrolling: touch to #epub-viewer');
      }
    };

    rendition.on('rendered', onRendered as (...args: unknown[]) => void);

    // Also run immediately if content is already loaded
    const contents = rendition.getContents();
    if (contents?.length > 0) {
      onRendered();
    }

    return () => {
      rendition.off('rendered', onRendered as (...args: unknown[]) => void);
      for (const cleanup of cleanupRef.current) {
        cleanup();
      }
      cleanupRef.current = [];
    };
  }, [rendition]);
}
