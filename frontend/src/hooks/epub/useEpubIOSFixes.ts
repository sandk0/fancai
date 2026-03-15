import type { Rendition } from '@/types/epub';
import type { EpubLayout, EpubManager } from '@/types/epub-internals';
import { isIOS } from '@/utils/iosSupport';
import { logger } from '@/lib/logger';

interface IOSFixesOptions {
  rendition: Rendition | null;
  viewerRef: React.RefObject<HTMLDivElement | null>;
  renditionWidth: string | number;
}

function fixIOSLayout(layout: EpubLayout, width: number, source: string): void {
  if (!layout) return;

  const oldDivisor = layout.divisor;
  const oldDelta = layout.delta;
  const oldColumnWidth = layout.columnWidth;

  layout.divisor = 1;
  layout._spread = 'none';
  layout.spreadWidth = 0;

  if (width > 0) {
    layout.delta = width;
    layout.columnWidth = width;
    layout.pageWidth = width;
  }

  if (oldDivisor !== 1) {
    logger.warn(`[useEpubIOSFixes] iOS ${source}: Fixed layout`, {
      divisor: `${oldDivisor} → 1`,
      delta: `${oldDelta} → ${layout.delta}`,
      columnWidth: `${oldColumnWidth} → ${layout.columnWidth}`,
    });
  }
}

function getContainerWidth(
  viewerRef: React.RefObject<HTMLDivElement | null>,
  renditionWidth: string | number
): number {
  const containerWidth = viewerRef.current?.clientWidth || renditionWidth;
  return typeof containerWidth === 'number'
    ? containerWidth
    : parseInt(containerWidth as string, 10) || 0;
}

export function applyIOSSpreadFix({
  rendition,
  viewerRef,
  renditionWidth,
}: IOSFixesOptions): (() => void) | undefined {
  if (!isIOS() || !rendition) return undefined;

  rendition.spread('none', 99999);

  const width = getContainerWidth(viewerRef, renditionWidth);

  const onLayout = (layout: unknown) => {
    fixIOSLayout(layout as EpubLayout, width, 'layout event');
  };

  const onDisplayed = () => {
    if (rendition.manager?.layout) {
      fixIOSLayout(rendition.manager.layout as unknown as EpubLayout, width, 'displayed event');
    }
  };

  rendition.on('layout', onLayout);
  rendition.on('displayed', onDisplayed);

  logger.debug('[useEpubIOSFixes] Applied spread("none", 99999) and layout fix');

  return () => {
    rendition.off('layout', onLayout);
    rendition.off('displayed', onDisplayed);
  };
}

export function applyIOSRenderedFixes(
  rendition: Rendition,
  viewerRef: React.RefObject<HTMLDivElement | null>,
  renditionWidth: string | number,
  _iframe: HTMLIFrameElement | null
): (() => void) | undefined {
  if (!isIOS()) return undefined;
  const manager = (rendition as unknown as { manager?: EpubManager }).manager;
  if (!manager) return undefined;
  logger.debug('[useEpubIOSFixes] Manager state:', {
    hasSnap: typeof manager.snap === 'function',
    hasGestures: !!manager.gestures,
    stageScrollWidth: manager.stage?.container?.scrollWidth,
    stageClientWidth: manager.stage?.container?.clientWidth,
    layoutDelta: manager.layout?.delta,
    layoutDivisor: manager.layout?.divisor,
  });
  if (typeof manager.snap === 'function') {
    manager.snap = function (..._args: unknown[]) {
      logger.warn('[useEpubIOSFixes] BLOCKED manager.snap()');
      return Promise.resolve();
    };
  }
  if (manager.gestures) {
    try {
      if (typeof manager.gestures.destroy === 'function') {
        manager.gestures.destroy();
      }
      manager.gestures = null;
    } catch (err) {
      logger.warn('[useEpubIOSFixes] Could not disable gestures:', err);
    }
  }
  if (manager.stage?.container) {
    const stage = manager.stage.container;
    const originalScrollTo = stage.scrollTo?.bind(stage);
    stage.scrollTo = function (options: ScrollToOptions | number, y?: number) {
      if (typeof options === 'object') {
        return originalScrollTo?.(options);
      }
      logger.warn('[useEpubIOSFixes] stage.scrollTo(x,y) BLOCKED:', options, y);
      return originalScrollTo?.(options, y);
    };
    stage.scrollBy = function (_options: ScrollToOptions | number, _y?: number) {
      logger.warn('[useEpubIOSFixes] stage.scrollBy() BLOCKED');
      return;
    };
  }

  // Touch blockers removed in Phase 22 — gestures.destroy() + snap noop sufficient
  // to prevent epub.js gesture interference. Capture-phase stopPropagation was
  // blocking touch events from reaching the gesture controller.

  // Final safety net: fix layout after render
  if (rendition.manager?.layout) {
    const layout = rendition.manager.layout as unknown as EpubLayout;
    if (layout.divisor !== 1 || !layout.delta) {
      const width = getContainerWidth(viewerRef, renditionWidth);
      fixIOSLayout(layout, width, 'rendered event');
    }
  }

  return undefined;
}
