import type { Book, Rendition } from '@/types/epub';
import { isIOS, isMobile } from '@/utils/iosSupport';
import { applyIOSSpreadFix, applyIOSRenderedFixes } from './useEpubIOSFixes';
import { logger } from '@/lib/logger';

const HEIGHT_CACHE_KEY = 'epub-rendition-height-cache';
const HEIGHT_CACHE_TTL = 30 * 60 * 1000;

interface HeightCacheEntry {
  height: number;
  orientation: 'portrait' | 'landscape';
  timestamp: number;
}

const getOrientationKey = (): 'portrait' | 'landscape' => {
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
};

const getCachedHeight = (): number | null => {
  try {
    const cached = localStorage.getItem(HEIGHT_CACHE_KEY);
    if (!cached) return null;

    const entry: HeightCacheEntry = JSON.parse(cached);
    const currentOrientation = getOrientationKey();

    if (
      entry.orientation === currentOrientation &&
      Date.now() - entry.timestamp < HEIGHT_CACHE_TTL &&
      entry.height > 0
    ) {
      logger.debug('[useEpubRendition] Using cached height:', entry.height);
      return entry.height;
    }
  } catch {
    // Ignore cache errors
  }
  return null;
};

const cacheHeight = (height: number): void => {
  try {
    const entry: HeightCacheEntry = {
      height,
      orientation: getOrientationKey(),
      timestamp: Date.now(),
    };
    localStorage.setItem(HEIGHT_CACHE_KEY, JSON.stringify(entry));
    logger.debug('[useEpubRendition] Cached height:', height);
  } catch {
    // Ignore cache errors
  }
};

const isStandaloneMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
};

const measureSafeAreaBottom = (): number => {
  if (typeof window === 'undefined') return 0;
  try {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;bottom:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none;';
    document.body.appendChild(div);
    const computed = window.getComputedStyle(div);
    const value = parseFloat(computed.paddingBottom) || 0;
    document.body.removeChild(div);
    return value;
  } catch {
    return 0;
  }
};

const measureSafeAreaTop = (): number => {
  try {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:0;padding-top:env(safe-area-inset-top);visibility:hidden;pointer-events:none;';
    document.body.appendChild(div);
    const computed = window.getComputedStyle(div);
    const value = parseFloat(computed.paddingTop) || 0;
    document.body.removeChild(div);
    return value;
  } catch {
    return 0;
  }
};

const measureSvhHeight = (): number => {
  try {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;height:100svh;visibility:hidden;pointer-events:none;';
    document.body.appendChild(div);
    const height = div.offsetHeight;
    document.body.removeChild(div);
    return height;
  } catch {
    return 0;
  }
};

/**
 * Calculate usable viewport height accounting for safe areas and browser chrome.
 * Uses height caching to prevent page offset on reload (CRITICAL for CFI consistency).
 */
function getUsableViewportHeight(containerRect: DOMRect, headerHeight: number = 70): number {
  const cachedHeight = getCachedHeight();
  if (cachedHeight !== null) {
    return cachedHeight;
  }

  const isStandalone = isStandaloneMode();
  const safeAreaBottom = measureSafeAreaBottom();
  const safeAreaTop = measureSafeAreaTop();
  const visualViewportHeight = window.innerHeight;
  const svhHeight = measureSvhHeight();

  let usableHeight: number;

  if (isStandalone) {
    usableHeight = visualViewportHeight - headerHeight - safeAreaTop - safeAreaBottom;
  } else {
    const baseHeight = svhHeight > 0 ? svhHeight : visualViewportHeight;
    usableHeight = baseHeight - headerHeight - safeAreaTop;

    if (containerRect.height < usableHeight) {
      usableHeight = containerRect.height;
    }
  }

  logger.debug('[useEpubRendition] getUsableViewportHeight:', {
    isStandalone,
    visualViewportHeight,
    svhHeight,
    safeAreaTop,
    safeAreaBottom,
    headerHeight,
    containerRectHeight: containerRect.height,
    calculatedUsableHeight: usableHeight,
  });

  const finalHeight = Math.floor(usableHeight);
  cacheHeight(finalHeight);
  return finalHeight;
}

interface MobileDimensions {
  width: number;
  height: number;
}

async function calculateMobileDimensions(
  viewerRef: React.RefObject<HTMLDivElement | null>,
): Promise<MobileDimensions | null> {
  if (!isMobile() || !viewerRef.current) return null;

  // Wait for browser layout to stabilize (iOS Safari address bar animations)
  await new Promise(resolve => setTimeout(resolve, 50));

  const containerRect = viewerRef.current.getBoundingClientRect();
  let width = Math.floor(containerRect.width);
  const height = getUsableViewportHeight(containerRect, 70);

  // Ensure width is EVEN (fixes pixel shifting on iOS)
  if (width % 2 !== 0) {
    width = width - 1;
  }

  logger.debug('[useEpubRendition] Mobile dimensions:', {
    device: isIOS() ? 'iOS' : 'Android',
    width,
    height,
    originalContainerHeight: containerRect.height,
    heightDifference: containerRect.height - height,
  });

  return { width, height };
}

const INITIAL_THEMES: Record<string, Record<string, Record<string, string>>> = {
  light: { body: { color: '#1A1A1A', background: '#FFFFFF' } },
  dark: { body: { color: '#E8E8E8', background: '#121212' } },
  sepia: { body: { color: '#3D2914', background: '#FBF0D9' } },
  night: { body: { color: '#B0B0B0', background: '#000000' } },
};

export interface CreateRenditionResult {
  rendition: Rendition;
  renditionWidth: string | number;
  renditionHeight: string | number;
  cleanup: () => void;
}

export async function createRendition(
  epubBook: Book,
  viewerRef: React.RefObject<HTMLDivElement | null>,
): Promise<CreateRenditionResult> {
  if (!viewerRef.current) {
    throw new Error('Viewer container not found');
  }

  let renditionWidth: string | number = '100%';
  let renditionHeight: string | number = '100%';

  const mobileDims = await calculateMobileDimensions(viewerRef);
  if (mobileDims) {
    renditionWidth = mobileDims.width;
    renditionHeight = mobileDims.height;
  }

  const newRendition = epubBook.renderTo(viewerRef.current, {
    width: renditionWidth,
    height: renditionHeight,
    spread: 'none',
    minSpreadWidth: 99999,
    flow: 'paginated',
  });

  const savedTheme = localStorage.getItem('app-theme') || 'dark';
  const themeStyles = INITIAL_THEMES[savedTheme] || INITIAL_THEMES.dark;
  newRendition.themes.default(themeStyles);

  const spreadFixCleanup = applyIOSSpreadFix({ rendition: newRendition, viewerRef, renditionWidth });
  logger.debug('[useEpubRendition] Rendition created:', {
    isIOS: isIOS(),
    spread: newRendition.settings?.spread,
    minSpreadWidth: newRendition.settings?.minSpreadWidth,
  });

  let renderedFixesCleanup: (() => void) | undefined;
  newRendition.on('rendered', () => {
    const iframe = viewerRef.current?.querySelector('iframe');
    if (iframe?.contentDocument?.body) {
      iframe.contentDocument.body.style.touchAction = 'manipulation';
      iframe.contentDocument.body.style.overscrollBehaviorX = 'none';
      iframe.contentDocument.body.style.userSelect = 'text';
      iframe.contentDocument.body.style.webkitUserSelect = 'text';
    }

    // Clean up previous rendered fixes before applying new ones
    renderedFixesCleanup?.();
    renderedFixesCleanup = applyIOSRenderedFixes(newRendition, viewerRef, renditionWidth, iframe ?? null);
    if (newRendition.manager?.layout) {
      logger.debug('[useEpubRendition] Layout after render:', {
        divisor: newRendition.manager.layout.divisor,
        delta: newRendition.manager.layout.delta,
        columnWidth: newRendition.manager.layout.columnWidth,
        _spread: newRendition.manager.layout._spread,
      });
    }
  });

  const cleanup = () => {
    spreadFixCleanup?.();
    renderedFixesCleanup?.();
  };

  return { rendition: newRendition, renditionWidth, renditionHeight, cleanup };
}
