/**
 * useEpubLoader - Custom hook for loading and initializing EPUB books
 *
 * Handles the complete lifecycle of loading an EPUB file:
 * - Checks IndexedDB cache for offline EPUB data first
 * - Downloads the book file with authorization if not cached
 * - Initializes epub.js Book and Rendition instances
 * - Applies theme styles
 * - Cleanup on unmount to prevent memory leaks
 *
 * @param bookUrl - URL to the EPUB file
 * @param viewerRef - React ref to the container element for rendering
 * @param authToken - Authentication token for authorized downloads
 * @param bookId - Book ID for cache lookup (optional)
 * @param userId - User ID for cache lookup (optional)
 * @returns Book and Rendition instances, loading state, and error state
 *
 * @example
 * const { book, rendition, isLoading, error } = useEpubLoader({
 *   bookUrl: booksAPI.getBookFileUrl(bookId),
 *   viewerRef,
 *   authToken: localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN),
 *   bookId,
 *   userId: user?.id,
 * });
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import ePub from 'epubjs';
import type { Book, Rendition } from '@/types/epub';
import { epubCache } from '@/services/epubCache';
import { isOnline } from '@/hooks/useOnlineStatus';

/**
 * Enable debug logging - ALWAYS ON for iOS debugging
 * Remove this after fixing the iOS navigation bug
 */
const DEBUG = true; // import.meta.env.DEV;

/**
 * Detect if running in PWA standalone mode
 */
const isStandaloneMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  // iOS Safari
  if ((navigator as any).standalone === true) return true;
  // Other browsers
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
};

/**
 * Measure safe-area-inset-bottom from CSS env() variable
 * Returns the Home Indicator height on iOS (34px on iPhone X+)
 * Returns 0 in Safari browser mode (browser handles safe area)
 */
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

/**
 * Cache key for storing rendition height per book (ensures consistency within session)
 * CRITICAL FIX (January 2026): Prevent 1-2 page offset on reload
 *
 * Problem: Height measurements can vary between page loads due to:
 * - Safari address bar state (expanded/collapsed)
 * - Timing of measurement (before/after layout stabilization)
 * - CSS layout not yet complete when measuring
 *
 * Solution: Cache the measured height per orientation for the session.
 * This ensures the same height is used on reload, preventing page boundary shifts.
 */
const HEIGHT_CACHE_KEY = 'epub-rendition-height-cache';
const HEIGHT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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

    // Check if cache is valid (same orientation and not expired)
    if (
      entry.orientation === currentOrientation &&
      Date.now() - entry.timestamp < HEIGHT_CACHE_TTL &&
      entry.height > 0
    ) {
      if (DEBUG) {
        console.log('[useEpubLoader] Using cached height:', entry.height);
      }
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
    if (DEBUG) {
      console.log('[useEpubLoader] Cached height:', height);
    }
  } catch {
    // Ignore cache errors
  }
};

/**
 * Calculate the actual usable viewport height for epub content
 *
 * This handles both:
 * 1. PWA mode: Subtracts safe-area-inset-bottom (Home Indicator)
 * 2. Safari browser: Uses window.innerHeight which already excludes toolbar
 *
 * The key insight is that `window.innerHeight` gives the visual viewport
 * (actual visible area), while `getBoundingClientRect()` may give the
 * layout viewport (which can extend behind browser chrome).
 *
 * CRITICAL FIX (January 2026): Uses height caching to prevent page offset on reload.
 * The cached height ensures consistent page boundaries between save and restore.
 */
const getUsableViewportHeight = (containerRect: DOMRect, headerHeight: number = 70): number => {
  // Check cache first for consistent height across reloads
  const cachedHeight = getCachedHeight();
  if (cachedHeight !== null) {
    return cachedHeight;
  }
  const isStandalone = isStandaloneMode();
  const safeAreaBottom = measureSafeAreaBottom();
  const safeAreaTop = (() => {
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
  })();

  // Method 1: Use window.innerHeight (visual viewport)
  // This automatically excludes Safari's bottom toolbar in browser mode
  const visualViewportHeight = window.innerHeight;

  // Method 2: Use CSS svh (small viewport height) if available
  // svh gives viewport height with all browser UI visible
  let svhHeight = 0;
  try {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;height:100svh;visibility:hidden;pointer-events:none;';
    document.body.appendChild(div);
    svhHeight = div.offsetHeight;
    document.body.removeChild(div);
  } catch {
    svhHeight = 0;
  }

  // Calculate content height (subtract header and safe areas)
  // In PWA mode, we need to subtract the safe-area-inset-bottom
  // In browser mode, innerHeight already accounts for browser chrome
  let usableHeight: number;

  if (isStandalone) {
    // PWA standalone mode: use visual viewport minus header and safe areas
    usableHeight = visualViewportHeight - headerHeight - safeAreaTop - safeAreaBottom;
  } else {
    // Browser mode: innerHeight already excludes toolbar
    // Use svh if available (more accurate), otherwise innerHeight
    const baseHeight = svhHeight > 0 ? svhHeight : visualViewportHeight;
    usableHeight = baseHeight - headerHeight - safeAreaTop;

    // Additional safety: if container is smaller than viewport, use container
    // This handles cases where CSS already applied safe-area padding
    if (containerRect.height < usableHeight) {
      usableHeight = containerRect.height;
    }
  }

  if (DEBUG) {
    console.log('[useEpubLoader] getUsableViewportHeight:', {
      isStandalone,
      visualViewportHeight,
      svhHeight,
      safeAreaTop,
      safeAreaBottom,
      headerHeight,
      containerRectHeight: containerRect.height,
      calculatedUsableHeight: usableHeight,
    });
  }

  const finalHeight = Math.floor(usableHeight);

  // Cache the calculated height for consistent page boundaries on reload
  // This prevents 1-2 page offset when reopening the book
  cacheHeight(finalHeight);

  return finalHeight;
};

interface UseEpubLoaderOptions {
  bookUrl: string;
  viewerRef: React.RefObject<HTMLDivElement | null>;
  authToken: string | null;
  /** Book ID for cache lookup */
  bookId?: string;
  /** User ID for cache lookup */
  userId?: string;
  onReady?: () => void;
}

interface UseEpubLoaderReturn {
  book: Book | null;
  rendition: Rendition | null;
  isLoading: boolean;
  error: string;
  reload: () => void;
}

export const useEpubLoader = ({
  bookUrl,
  viewerRef,
  authToken,
  bookId,
  userId,
  onReady,
}: UseEpubLoaderOptions): UseEpubLoaderReturn => {
  const [book, setBook] = useState<Book | null>(null);
  const [rendition, setRendition] = useState<Rendition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [reloadKey, setReloadKey] = useState(0);

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  // Reload function to retry loading the book
  const reload = useCallback(() => {
    setError('');
    setReloadKey(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!viewerRef.current) {
      setError('Viewer container not found');
      return;
    }

    let isMounted = true;
    const abortController = new AbortController();

    const loadEpub = async () => {
      try {
        setIsLoading(true);
        setError('');

        let arrayBuffer: ArrayBuffer | null = null;

        // 1. Try to load from IndexedDB cache first
        if (bookId && userId) {
          if (DEBUG) console.log('[useEpubLoader] Checking cache for book:', bookId);
          arrayBuffer = await epubCache.get(userId, bookId);

          if (arrayBuffer) {
            if (DEBUG) console.log('[useEpubLoader] Using cached EPUB for:', bookId);
          }
        }

        // 2. If not cached, try to fetch from network
        if (!arrayBuffer) {
          // Check if we're offline
          if (!isOnline()) {
            throw new Error('Книга недоступна офлайн. Скачайте её для офлайн-чтения.');
          }

          if (DEBUG) console.log('[useEpubLoader] Fetching EPUB from network:', bookUrl);

          // Download EPUB file with authorization and abort signal
          const response = await fetch(bookUrl, {
            headers: authToken ? {
              'Authorization': `Bearer ${authToken}`,
            } : {},
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error(`Failed to download EPUB: ${response.statusText}`);
          }

          arrayBuffer = await response.arrayBuffer();
        }

        if (!isMounted) return;

        // Initialize epub.js with ArrayBuffer
        const epubBook = ePub(arrayBuffer) as unknown as Book;
        bookRef.current = epubBook;
        setBook(epubBook);

        // Wait for book to be ready
        await epubBook.ready;

        if (!isMounted || !viewerRef.current) return;

        // Create rendition using renderTo (this is the epubjs API method)
        // Note: We use capture phase handlers in useTouchNavigation to intercept
        // touch/click events before epub.js processes them
        //
        // iOS Safari Fix (January 2026):
        // - minSpreadWidth: 99999 forces single-column layout on all screen sizes
        // - This prevents iOS Safari from miscalculating CSS column widths
        // - Without this, iOS can render 2 columns when only 1 should be shown,
        //   causing "double page turn" visual bug
        //
        // iOS CRITICAL FIX (from epub.js GitHub Issue #204):
        // - iOS needs EXPLICIT PIXEL VALUES, not percentages
        // - Width must be EVEN number to prevent pixel shifting on page turns
        // - Without this, iOS miscalculates column-width and navigates multiple pages
        const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        // Android device detection (January 2026)
        const isAndroidDevice = /Android/i.test(navigator.userAgent);

        // Combined mobile check - both iOS and Android need explicit pixel dimensions
        const isMobileDevice = isIOSDevice || isAndroidDevice;

        // Get container dimensions for mobile devices
        // CRITICAL: Use getUsableViewportHeight() to account for:
        // 1. PWA mode: safe-area-inset-bottom (Home Indicator on iOS, gesture bar on Android)
        // 2. Browser mode: browser toolbar/chrome (address bar, navigation buttons)
        let renditionWidth: string | number = '100%';
        let renditionHeight: string | number = '100%';

        if (isMobileDevice && viewerRef.current) {
          // CRITICAL FIX (January 2026): Wait for browser layout to stabilize
          // On iOS Safari, measuring immediately can give inconsistent results
          // due to address bar animations and layout shifts
          await new Promise(resolve => setTimeout(resolve, 50));

          const containerRect = viewerRef.current.getBoundingClientRect();
          let width = Math.floor(containerRect.width);

          // Use getUsableViewportHeight() instead of containerRect.height
          // This properly accounts for safe-area and browser chrome
          // Note: Height is cached to ensure consistency on reload (prevents 1-2 page offset)
          const height = getUsableViewportHeight(containerRect, 70); // 70px header height

          // Ensure width is EVEN (fixes pixel shifting on iOS)
          if (width % 2 !== 0) {
            width = width - 1;
          }

          renditionWidth = width;
          renditionHeight = height;

          if (DEBUG) {
            console.log('[useEpubLoader] Mobile: Using explicit pixel dimensions:', {
              device: isIOSDevice ? 'iOS' : 'Android',
              width: renditionWidth,
              height: renditionHeight,
              originalContainerHeight: containerRect.height,
              heightDifference: containerRect.height - height,
            });
          }
        }

        const newRendition = epubBook.renderTo(viewerRef.current, {
          width: renditionWidth,
          height: renditionHeight,
          spread: 'none',
          minSpreadWidth: 99999, // Force single-column on iOS
          flow: 'paginated', // Ensure paginated mode
        });

        // Apply initial theme immediately BEFORE rendering content
        // This prevents flash of light-themed content
        const savedTheme = localStorage.getItem('app-theme') || 'dark';
        const INITIAL_THEMES: Record<string, Record<string, Record<string, string>>> = {
          light: { body: { color: '#1A1A1A', background: '#FFFFFF' } },
          dark: { body: { color: '#E8E8E8', background: '#121212' } },
          sepia: { body: { color: '#3D2914', background: '#FBF0D9' } },
          night: { body: { color: '#B0B0B0', background: '#000000' } },
        };
        const themeStyles = INITIAL_THEMES[savedTheme] || INITIAL_THEMES.dark;
        newRendition.themes.default(themeStyles);

        renditionRef.current = newRendition;
        setRendition(newRendition);

        // iOS-ONLY FIX: Force single-page spread AFTER book metadata is loaded
        // Book metadata can override our initial spread:'none' setting
        // This explicit call ensures our setting takes precedence on iOS
        if (isIOSDevice) {
          newRendition.spread('none', 99999);

          /**
           * iOS FIX (January 2026): Complete layout correction
           *
           * CRITICAL: Not just setting divisor=1, but also recalculating delta!
           * epub.js uses layout.delta as the scroll unit for navigation.
           * If divisor was > 1, delta was calculated for multiple columns.
           * We must recalculate delta = containerWidth for single column mode.
           */
          const fixIOSLayout = (layout: any, source: string) => {
            if (!layout) return;

            const oldDivisor = layout.divisor;
            const oldDelta = layout.delta;
            const oldColumnWidth = layout.columnWidth;

            // Get actual container width
            const containerWidth = viewerRef.current?.clientWidth || renditionWidth;
            const width = typeof containerWidth === 'number' ? containerWidth : parseInt(containerWidth as string, 10) || 0;

            // Force single column
            layout.divisor = 1;
            layout._spread = 'none';
            layout.spreadWidth = 0;

            // CRITICAL: Recalculate delta and columnWidth for single column
            // delta = scroll unit per navigation (should equal container width)
            // columnWidth = width of single column (should equal container width)
            if (width > 0) {
              layout.delta = width;
              layout.columnWidth = width;
              layout.pageWidth = width;
            }

            if (DEBUG || oldDivisor !== 1) {
              console.warn(`[useEpubLoader] iOS ${source}: Fixed layout`, {
                divisor: `${oldDivisor} → 1`,
                delta: `${oldDelta} → ${layout.delta}`,
                columnWidth: `${oldColumnWidth} → ${layout.columnWidth}`,
              });
            }
          };

          // Listen for layout event - earliest interception point
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          newRendition.on('layout', (layout: any) => {
            fixIOSLayout(layout, 'layout event');
          });

          // Also listen for displayed event - fires before rendered
          newRendition.on('displayed', () => {
            if (newRendition.manager?.layout) {
              fixIOSLayout(newRendition.manager.layout, 'displayed event');
            }
          });

          if (DEBUG) {
            console.log('[useEpubLoader] iOS: Applied spread("none", 99999) and comprehensive layout fix');
          }
        }

        // Debug logging (dev only)
        if (DEBUG) {
          console.log('[useEpubLoader] Rendition created:', {
            isIOS: isIOSDevice,
            spread: newRendition.settings?.spread,
            minSpreadWidth: newRendition.settings?.minSpreadWidth,
          });
        }

        // Disable horizontal swipe/touch navigation in iframe to prevent multiple page turns
        newRendition.on('rendered', () => {
          const iframe = viewerRef.current?.querySelector('iframe');
          if (iframe?.contentDocument?.body) {
            // iOS FIX (January 2026): Use 'manipulation' instead of 'pan-y'
            // 'pan-y' blocks stage.scrollTo() from working properly
            // 'manipulation' allows JS-controlled horizontal scrolling while preventing
            // double-tap-to-zoom and other browser gestures
            iframe.contentDocument.body.style.touchAction = 'manipulation';
            iframe.contentDocument.body.style.overscrollBehaviorX = 'none';
            // Enable text selection
            iframe.contentDocument.body.style.userSelect = 'text';
            iframe.contentDocument.body.style.webkitUserSelect = 'text';
          }

          /**
           * iOS FIX Phase 2 (January 2026): DISABLE epub.js internal gesture handling
           *
           * Problem: epub.js has its own touch/swipe handlers that trigger navigation
           * independently of our code. This causes multi-page jumps because epub.js
           * calculates scroll distance incorrectly on iOS.
           *
           * Solution: Completely disable epub.js's internal touch handling
           */
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const manager = (newRendition as any).manager;
          if (isIOSDevice && manager) {
            // Log current state for debugging
            console.log('[useEpubLoader] iOS Phase 2: Manager state:', {
              hasSnap: typeof manager.snap === 'function',
              hasGestures: !!manager.gestures,
              stageScrollWidth: manager.stage?.container?.scrollWidth,
              stageClientWidth: manager.stage?.container?.clientWidth,
              layoutDelta: manager.layout?.delta,
              layoutDivisor: manager.layout?.divisor,
            });

            // Method 1: Override snap() to prevent epub.js from auto-scrolling
            if (typeof manager.snap === 'function') {
              manager.snap = function(...args: unknown[]) {
                const debugFn = (window as any).__iosDebug;
                if (debugFn) {
                  debugFn({ event: 'BLOCKED:snap', blocked: 'manager.snap()' });
                }
                console.warn('[useEpubLoader] iOS: BLOCKED manager.snap() call', args);
                // Don't call original - we handle navigation ourselves
                return Promise.resolve();
              };
              console.log('[useEpubLoader] iOS: Overrode manager.snap()');
            }

            // Method 2: Disable gesture handlers if they exist
            if (manager.gestures) {
              try {
                // Some versions of epub.js have gestures.destroy()
                if (typeof manager.gestures.destroy === 'function') {
                  manager.gestures.destroy();
                  console.log('[useEpubLoader] iOS: Destroyed manager.gestures');
                }
                // Null out the gestures object
                manager.gestures = null;
              } catch (err) {
                console.warn('[useEpubLoader] iOS: Could not disable gestures:', err);
              }
            }

            // Method 3: Override scrollBy to log and potentially block
            if (manager.stage?.container) {
              const stage = manager.stage.container;
              const originalScrollTo = stage.scrollTo?.bind(stage);
              const originalScrollBy = stage.scrollBy?.bind(stage);

              stage.scrollTo = function(options: ScrollToOptions | number, y?: number) {
                // If called with object (our code uses this)
                if (typeof options === 'object') {
                  console.log('[useEpubLoader] iOS: stage.scrollTo() called:', options);
                  return originalScrollTo?.(options);
                }
                // If called with numbers (might be epub.js internal)
                console.warn('[useEpubLoader] iOS: stage.scrollTo(x,y) BLOCKED:', options, y);
                // Allow it for now but log
                return originalScrollTo?.(options, y);
              };

              if (originalScrollBy) {
                stage.scrollBy = function(options: ScrollToOptions | number, y?: number) {
                  const debugFn = (window as any).__iosDebug;
                  if (debugFn) {
                    debugFn({
                      event: 'BLOCKED:scrollBy',
                      blocked: `scrollBy(${typeof options === 'object' ? JSON.stringify(options) : options})`,
                    });
                  }
                  console.warn('[useEpubLoader] iOS: stage.scrollBy() called:', options, y);
                  // This is likely epub.js internal - BLOCK IT
                  // return originalScrollBy?.(options, y);
                  return; // Block scrollBy calls
                };
                console.log('[useEpubLoader] iOS: Blocked stage.scrollBy()');
              }
            }

            // Method 4: Intercept touch events in the iframe to prevent epub.js from handling
            if (iframe?.contentDocument) {
              const doc = iframe.contentDocument;
              const blockEpubJsTouchHandler = (e: TouchEvent) => {
                // Log touch events
                const touch = e.touches[0] || e.changedTouches[0];
                if (touch) {
                  console.log(`[useEpubLoader] iOS: iframe ${e.type}:`, {
                    x: Math.round(touch.clientX),
                    y: Math.round(touch.clientY),
                    target: (e.target as HTMLElement)?.tagName,
                  });
                }
                // Stop propagation to prevent epub.js handlers
                e.stopPropagation();
              };

              // Capture phase to intercept before epub.js
              doc.addEventListener('touchstart', blockEpubJsTouchHandler, { capture: true, passive: true });
              doc.addEventListener('touchmove', blockEpubJsTouchHandler, { capture: true, passive: true });
              doc.addEventListener('touchend', blockEpubJsTouchHandler, { capture: true, passive: true });
              console.log('[useEpubLoader] iOS: Added capture-phase touch blockers to iframe');
            }
          }

          // iOS FIX: Force divisor=1 and recalculate delta to prevent multiple page turns
          // This is the FINAL safety net after all other fixes
          if (isIOSDevice && newRendition.manager?.layout) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const layout = newRendition.manager.layout as any;
            if (layout.divisor !== 1 || !layout.delta) {
              const containerWidth = viewerRef.current?.clientWidth || renditionWidth;
              const width = typeof containerWidth === 'number' ? containerWidth : parseInt(containerWidth as string, 10) || 0;

              const oldDivisor = layout.divisor;
              const oldDelta = layout.delta;

              layout.divisor = 1;
              layout._spread = 'none';
              layout.spreadWidth = 0;

              if (width > 0) {
                layout.delta = width;
                layout.columnWidth = width;
                layout.pageWidth = width;
              }

              if (oldDivisor !== 1) {
                console.warn('[useEpubLoader] iOS rendered event: Fixed layout', {
                  divisor: `${oldDivisor} → 1`,
                  delta: `${oldDelta} → ${layout.delta}`,
                });
              }
            }
          }

          // DEBUG: Log layout after each render
          if (DEBUG && newRendition.manager?.layout) {
            console.log('[useEpubLoader] Layout after render:', {
              divisor: newRendition.manager.layout.divisor,
              delta: newRendition.manager.layout.delta,
              columnWidth: newRendition.manager.layout.columnWidth,
              _spread: newRendition.manager.layout._spread,
            });
          }
        });

        // Note: Initial theme applied above, useEpubThemes hook handles theme changes
        setIsLoading(false);

        if (onReady) {
          onReady();
        }

      } catch (err) {
        // Don't show error if request was aborted (component unmounted)
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        console.error('[useEpubLoader] Error loading EPUB:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Error loading book');
          setIsLoading(false);
        }
      }
    };

    loadEpub();

    // Cleanup function
    return () => {
      isMounted = false;
      // Abort any pending fetch requests
      abortController.abort();

      // Cleanup rendition first
      if (renditionRef.current) {
        try {
          const currentRendition = renditionRef.current;

          // Clear all event listeners
          // Note: rendition.off() without arguments clears all listeners
          try {
            currentRendition.off();
          } catch {
            // Ignore event listener errors
          }

          // Safely destroy rendition
          if (typeof currentRendition.destroy === 'function') {
            currentRendition.destroy();
          }

          renditionRef.current = null;
        } catch {
          // Ignore destruction errors during cleanup
        }
      }

      // Cleanup book instance
      if (bookRef.current) {
        try {
          const currentBook = bookRef.current;

          // Safely destroy book
          if (typeof currentBook.destroy === 'function') {
            currentBook.destroy();
          }

          bookRef.current = null;
        } catch {
          // Ignore destruction errors during cleanup
        }
      }

      // Clear state
      setBook(null);
      setRendition(null);
    };
  }, [bookUrl, authToken, bookId, userId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    book,
    rendition,
    isLoading,
    error,
    reload,
  };
};
