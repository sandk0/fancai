/**
 * IOSTapZones - Touch navigation overlay for iOS PWA
 *
 * iOS PWA SPECIFIC FIX (January 2026):
 * iOS Safari and iOS PWA standalone mode do not reliably forward touch events
 * from iframes to the parent document. This is a known WebKit limitation.
 *
 * Solution: Render transparent overlay divs OUTSIDE the iframe that capture
 * touch/click events directly in the parent document.
 *
 * IMPORTANT:
 * - Zones are VERY narrow (8%) to maximize clickable area for descriptions
 * - Descriptions near the extreme edges may not be clickable (acceptable tradeoff)
 * - This component ONLY renders on iOS devices
 * - Android and other platforms use the standard rendition.on() approach
 *
 * References:
 * - https://github.com/gseguin/ios-iframe-touchevents-fix
 * - WebKit Bug 128924: Shifted document touch handling in iframes on iOS
 */

import { useCallback, useRef, memo, useState, useEffect } from 'react';

const TAP_MAX_DURATION = 350; // ms

// Note: BroadcastChannel removed - it doesn't work with blob: URL iframes on iOS Safari
// due to storage partitioning. Using callback approach instead.
const TAP_MAX_MOVEMENT = 20; // px

// Debounce time for navigation (increased for real iOS devices)
// Real devices can generate both touch and click events from single tap
const NAV_DEBOUNCE_MS = 500;

// Navigation zone width - VERY narrow to maximize description clickability
// 8% = roughly 30px on iPhone, enough for a finger tap on the edge
const ZONE_WIDTH_PERCENT = 8;

// Swipe detection config for iOS
const SWIPE_MIN_DISTANCE = 30; // px - minimum horizontal movement for swipe
const SWIPE_MAX_VERTICAL_RATIO = 2.0; // if deltaY/deltaX > this, it's vertical scroll

// Detect iOS device (iPhone, iPad, iPod)
const isIOS = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  return isIOSDevice || isIPadOS;
};

// Check if running as PWA (standalone mode)
const isStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-expect-error - Safari specific property
    window.navigator.standalone === true
  );
};

interface IOSTapZonesProps {
  onPrevPage: () => void;
  onNextPage: () => void;
  onDescriptionClick?: (descriptionId: string) => void;
  /**
   * Callback for center zone taps with coordinates relative to iframe
   * Used to find descriptions via rendition.getContents() in parent component
   * This replaces the broken BroadcastChannel/postMessage approach
   */
  onCenterTap?: (x: number, y: number) => void;
  enabled?: boolean;
  headerHeight?: number;
  /** Whether navigation tap zones should be rendered (false = swipe mode, only center zone) */
  navigationEnabled?: boolean;
}

/**
 * IOSTapZones renders transparent overlay divs for left/right navigation
 * ONLY on iOS devices. Does nothing on Android/Desktop.
 */
export const IOSTapZones = memo(function IOSTapZones({
  onPrevPage,
  onNextPage,
  onDescriptionClick: _onDescriptionClick, // Kept for backwards compatibility
  onCenterTap, // New: callback with coordinates for description detection via rendition.getContents()
  enabled = true,
  headerHeight = 70,
  navigationEnabled = true, // When false (swipe mode), only center zone is rendered
}: IOSTapZonesProps) {
  // All hooks MUST be called before any early returns (Rules of Hooks)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastNavTimeRef = useRef<number>(0);
  const lastDescClickTimeRef = useRef<number>(0);
  const isNavigatingRef = useRef<boolean>(false);
  const navCountRef = useRef<number>(0);
  const [debugTapInfo, setDebugTapInfo] = useState<string | null>(null);
  
  const isIOSDevice = isIOS();

  useEffect(() => {
    if (!isIOSDevice) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'IFRAME_DEBUG') {
        setDebugTapInfo(`IF: ${event.data.message}`);
        setTimeout(() => setDebugTapInfo(null), 3000);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isIOSDevice]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  }, [enabled]);

  const handleTouchEnd = useCallback((
    e: React.TouchEvent,
    action: 'prev' | 'next'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!enabled) return;
    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    if (!touch) {
      touchStartRef.current = null;
      return;
    }

    const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
    const duration = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    const isTap = duration < TAP_MAX_DURATION && deltaX < TAP_MAX_MOVEMENT && deltaY < TAP_MAX_MOVEMENT;
    if (!isTap) return;

    if (isNavigatingRef.current) {
      setDebugTapInfo(`LOCKED`);
      setTimeout(() => setDebugTapInfo(null), 1000);
      return;
    }

    const now = Date.now();
    if (now - lastNavTimeRef.current < NAV_DEBOUNCE_MS) return;
    lastNavTimeRef.current = now;

    isNavigatingRef.current = true;
    navCountRef.current += 1;
    const navNum = navCountRef.current;
    setDebugTapInfo(`NAV#${navNum}:${action}`);

    const doNavigate = async () => {
      try {
        if (action === 'prev') {
          await onPrevPage();
        } else {
          await onNextPage();
        }
      } finally {
        setTimeout(() => {
          isNavigatingRef.current = false;
          setDebugTapInfo(null);
        }, 300);
      }
    };

    requestAnimationFrame(() => {
      doNavigate();
    });
  }, [enabled, onPrevPage, onNextPage]);

  const handleClick = useCallback((
    e: React.MouseEvent,
    action: 'prev' | 'next'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!enabled) return;

    if (isNavigatingRef.current) return;

    const now = Date.now();
    if (now - lastNavTimeRef.current < NAV_DEBOUNCE_MS) return;
    lastNavTimeRef.current = now;

    isNavigatingRef.current = true;
    navCountRef.current += 1;
    const navNum = navCountRef.current;
    setDebugTapInfo(`CLK#${navNum}:${action}`);

    const doNavigate = async () => {
      try {
        if (action === 'prev') {
          await onPrevPage();
        } else {
          await onNextPage();
        }
      } finally {
        setTimeout(() => {
          isNavigatingRef.current = false;
          setDebugTapInfo(null);
        }, 300);
      }
    };

    requestAnimationFrame(() => {
      doNavigate();
    });
  }, [enabled, onPrevPage, onNextPage]);

  const handleCenterTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  }, [enabled]);

  const handleCenterTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;

    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    if (!touch) {
      touchStartRef.current = null;
      return;
    }

    const startX = touchStartRef.current.x;
    const startY = touchStartRef.current.y;
    const rawDeltaX = touch.clientX - startX; // Keep sign for direction
    const deltaX = Math.abs(rawDeltaX);
    const deltaY = Math.abs(touch.clientY - startY);
    const duration = Date.now() - touchStartRef.current.time;

    touchStartRef.current = null;

    // SWIPE DETECTION (only in swipe mode - when navigationEnabled is false)
    if (!navigationEnabled) {
      // Check if it's a horizontal swipe (not vertical scroll)
      const isVerticalScroll = deltaY > 10 && deltaY / deltaX > SWIPE_MAX_VERTICAL_RATIO;
      const isSwipe = deltaX >= SWIPE_MIN_DISTANCE && !isVerticalScroll;

      if (isSwipe) {
        // Swipe detected - navigate!
        const swipeDirection = rawDeltaX > 0 ? 'prev' : 'next';

        if (import.meta.env.DEV) {
          console.log('[IOSTapZones] Swipe detected!', { deltaX, direction: swipeDirection });
        }

        // Navigation lock check
        if (isNavigatingRef.current) {
          setDebugTapInfo('SWIPE LOCKED');
          setTimeout(() => setDebugTapInfo(null), 1000);
          return;
        }

        // Debounce navigation
        const now = Date.now();
        if (now - lastNavTimeRef.current < NAV_DEBOUNCE_MS) {
          return;
        }
        lastNavTimeRef.current = now;

        // Set navigation lock
        isNavigatingRef.current = true;
        navCountRef.current += 1;
        const navNum = navCountRef.current;

        setDebugTapInfo(`SWIPE#${navNum}:${swipeDirection}`);

        const doNavigate = async () => {
          try {
            if (swipeDirection === 'prev') {
              await onPrevPage();
            } else {
              await onNextPage();
            }
          } finally {
            setTimeout(() => {
              isNavigatingRef.current = false;
              setDebugTapInfo(null);
            }, 300);
          }
        };

        requestAnimationFrame(() => {
          doNavigate();
        });

        return; // Don't process as tap
      }
    }

    // Check if it's a tap (not swipe or long press)
    const isTap = duration < TAP_MAX_DURATION && deltaX < TAP_MAX_MOVEMENT && deltaY < TAP_MAX_MOVEMENT;

    if (!isTap) {
      if (import.meta.env.DEV) {
        console.log('[IOSTapZones] Center: Not a tap - ignoring', { deltaX, deltaY, duration });
      }
      return;
    }

    // Debounce
    const now = Date.now();
    if (now - lastDescClickTimeRef.current < 300) {
      if (import.meta.env.DEV) {
        console.log('[IOSTapZones] Center: Debounced - ignoring');
      }
      return;
    }
    lastDescClickTimeRef.current = now;

    // Find the iframe for coordinate calculation
    // CRITICAL FIX (January 2026): Use iframe rect, NOT viewer rect!
    // After safe-area fix, iframe height is reduced (via renditionHeight),
    // but viewer container may have different dimensions.
    const iframe = document.querySelector('#epub-viewer iframe') as HTMLIFrameElement | null;

    if (!iframe) {
      setDebugTapInfo('ERROR: No iframe');
      setTimeout(() => setDebugTapInfo(null), 2000);
      return;
    }

    // Use iframe rect for coordinate calculation
    // This ensures coordinates match the iframe's coordinate system for elementFromPoint()
    const iframeRect = iframe.getBoundingClientRect();

    // Calculate coordinates relative to iframe's visible area
    // These are the exact coordinates needed for elementFromPoint inside iframe
    const viewportX = touch.clientX - iframeRect.left;
    const viewportY = touch.clientY - iframeRect.top;

    // NEW APPROACH (January 2026): Use callback instead of postMessage
    // BroadcastChannel and postMessage do NOT work reliably with blob: URL iframes
    // on iOS Safari due to storage partitioning and security restrictions.
    // Instead, we pass coordinates to parent component which uses
    // rendition.getContents()[0].document.elementFromPoint() - this works!
    if (onCenterTap) {
      setDebugTapInfo(`TAP:${Math.round(viewportX)},${Math.round(viewportY)}`);
      onCenterTap(viewportX, viewportY);
      setTimeout(() => setDebugTapInfo(null), 2000);
    } else {
      setDebugTapInfo('NO_HANDLER');
      setTimeout(() => setDebugTapInfo(null), 2000);
    }
  }, [enabled, navigationEnabled, onPrevPage, onNextPage, onCenterTap]);

  // Early return for non-iOS devices (after all hooks are called)
  if (!isIOSDevice) {
    return null;
  }

  if (import.meta.env.DEV) {
    console.log('[IOSTapZones] Rendering overlay zones on iOS', {
      isStandalone: isStandalone(),
      zoneWidth: `${ZONE_WIDTH_PERCENT}%`,
    });
  }

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    top: `calc(${headerHeight}px + env(safe-area-inset-top))`,
    bottom: 'env(safe-area-inset-bottom)',
    zIndex: 5, // Above iframe but below UI elements
    backgroundColor: 'transparent',
    // pan-x pan-y: explicitly excludes pinch-zoom (manipulation = pan-x pan-y pinch-zoom!)
    touchAction: 'pan-x pan-y',
    WebkitTapHighlightColor: 'transparent',
    WebkitUserSelect: 'none',
    userSelect: 'none',
  };

  return (
    <>
      {/* Left tap zone - only when navigation is enabled (tap mode) */}
      {navigationEnabled && (
        <div
          data-testid="ios-tap-zone-left"
          style={{
            ...baseStyle,
            left: 'env(safe-area-inset-left)',
            width: `${ZONE_WIDTH_PERCENT}%`,
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={(e) => handleTouchEnd(e, 'prev')}
          onClick={(e) => handleClick(e, 'prev')}
          aria-label="Previous page"
          role="button"
          tabIndex={-1}
        />
      )}

      {/* Right tap zone - only when navigation is enabled (tap mode) */}
      {navigationEnabled && (
        <div
          data-testid="ios-tap-zone-right"
          style={{
            ...baseStyle,
            right: 'env(safe-area-inset-right)',
            width: `${ZONE_WIDTH_PERCENT}%`,
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={(e) => handleTouchEnd(e, 'next')}
          onClick={(e) => handleClick(e, 'next')}
          aria-label="Next page"
          role="button"
          tabIndex={-1}
        />
      )}

      {/* Center tap zone - for description clicks via bidirectional postMessage */}
      {/* Always rendered - sends tap coordinates to iframe, iframe finds description */}
      {/* When navigation is disabled (swipe mode), covers entire width except safe areas */}
      <div
        data-testid="ios-tap-zone-center"
        style={{
          ...baseStyle,
          left: navigationEnabled
            ? `calc(${ZONE_WIDTH_PERCENT}% + env(safe-area-inset-left))`
            : 'env(safe-area-inset-left)',
          right: navigationEnabled
            ? `calc(${ZONE_WIDTH_PERCENT}% + env(safe-area-inset-right))`
            : 'env(safe-area-inset-right)',
        }}
        onTouchStart={handleCenterTouchStart}
        onTouchEnd={handleCenterTouchEnd}
        aria-label="Content area"
        role="region"
        tabIndex={-1}
      />

      {/* Debug tap indicator - only shown in development */}
      {import.meta.env.DEV && debugTapInfo && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: debugTapInfo.startsWith('ERROR') ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 128, 0, 0.9)',
            color: 'white',
            padding: '12px 20px',
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 'bold',
            zIndex: 99999,
            pointerEvents: 'none',
          }}
        >
          {debugTapInfo}
        </div>
      )}

      {/* Debug indicator - only shown in development */}
      {import.meta.env.DEV && (
        <div
          style={{
            position: 'fixed',
            bottom: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: navigationEnabled ? 'rgba(0, 128, 0, 0.8)' : 'rgba(59, 130, 246, 0.8)',
            color: 'white',
            padding: '6px 12px',
            borderRadius: 4,
            fontSize: 11,
            zIndex: 9999,
            pointerEvents: 'none',
          }}
        >
          iOS {navigationEnabled ? `${ZONE_WIDTH_PERCENT}%+Tap` : 'Swipe+Center'} {isStandalone() ? '[PWA]' : '[Safari]'}
        </div>
      )}
    </>
  );
});

export default IOSTapZones;
