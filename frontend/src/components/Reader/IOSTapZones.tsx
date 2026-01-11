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

// BroadcastChannel for cross-iframe communication (works with blob: URLs)
const TAP_CHANNEL_NAME = 'ios-tap-coordinates';
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
  onDescriptionClick: _onDescriptionClick, // Kept for backwards compatibility, not used with postMessage approach
  enabled = true,
  headerHeight = 70,
  navigationEnabled = true, // When false (swipe mode), only center zone is rendered
}: IOSTapZonesProps) {
  // Only render on iOS
  if (!isIOS()) {
    return null;
  }

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastNavTimeRef = useRef<number>(0);
  const lastDescClickTimeRef = useRef<number>(0);

  // Navigation lock - prevents multiple navigations while one is in progress
  const isNavigatingRef = useRef<boolean>(false);
  const navCountRef = useRef<number>(0); // Debug: count navigations

  // Debug: visual tap indicator state
  const [debugTapInfo, setDebugTapInfo] = useState<string | null>(null);

  // Listen for response from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'IFRAME_DEBUG') {
        // Show debug message from iframe
        setDebugTapInfo(`IF: ${event.data.message}`);
        setTimeout(() => setDebugTapInfo(null), 3000);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Debug log for iOS detection (only once on mount)
  if (import.meta.env.DEV) {
    console.log('[IOSTapZones] Rendering overlay zones on iOS', {
      isStandalone: isStandalone(),
      zoneWidth: `${ZONE_WIDTH_PERCENT}%`,
    });
  }

  /**
   * Handle touch start - record position
   */
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

  /**
   * Handle touch end - determine if tap and navigate
   */
  const handleTouchEnd = useCallback((
    e: React.TouchEvent,
    action: 'prev' | 'next'
  ) => {
    // Prevent default to stop any native handling
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

    // Check if it's a tap (not swipe or long press)
    const isTap = duration < TAP_MAX_DURATION && deltaX < TAP_MAX_MOVEMENT && deltaY < TAP_MAX_MOVEMENT;

    if (!isTap) {
      return;
    }

    // Navigation lock - prevent multiple navigations
    if (isNavigatingRef.current) {
      setDebugTapInfo(`LOCKED`);
      setTimeout(() => setDebugTapInfo(null), 1000);
      return;
    }

    // Debounce navigation to prevent double triggers
    const now = Date.now();
    if (now - lastNavTimeRef.current < NAV_DEBOUNCE_MS) {
      return;
    }
    lastNavTimeRef.current = now;

    // Set navigation lock
    isNavigatingRef.current = true;
    navCountRef.current += 1;
    const navNum = navCountRef.current;

    // Show debug indicator
    setDebugTapInfo(`NAV#${navNum}:${action}`);

    // Navigate with lock protection
    const doNavigate = async () => {
      try {
        if (action === 'prev') {
          await onPrevPage();
        } else {
          await onNextPage();
        }
      } finally {
        // Release lock after navigation completes or after timeout
        setTimeout(() => {
          isNavigatingRef.current = false;
          setDebugTapInfo(null);
        }, 300);
      }
    };

    // Use requestAnimationFrame then execute
    requestAnimationFrame(() => {
      doNavigate();
    });
  }, [enabled, onPrevPage, onNextPage]);

  /**
   * Handle click - fallback for devices where touch events don't work
   * NOTE: On real iOS devices, a tap may generate BOTH touchend AND click events
   * The shared lastNavTimeRef and isNavigatingRef prevent double navigation
   */
  const handleClick = useCallback((
    e: React.MouseEvent,
    action: 'prev' | 'next'
  ) => {
    // Prevent default
    e.preventDefault();
    e.stopPropagation();

    if (!enabled) return;

    // Navigation lock check
    if (isNavigatingRef.current) {
      return;
    }

    // Debounce - shared with touch handler to prevent double triggers
    const now = Date.now();
    if (now - lastNavTimeRef.current < NAV_DEBOUNCE_MS) {
      return;
    }
    lastNavTimeRef.current = now;

    // Set navigation lock
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

  /**
   * Handle center zone touch start - record position for tap detection
   */
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

  /**
   * Handle center zone touch end - detect swipes OR send coordinates to iframe via postMessage
   *
   * iOS PWA FIX (January 2026):
   * On iOS PWA, iframe.contentDocument is null due to security restrictions.
   * Instead of trying to access it directly, we send tap coordinates to the iframe
   * via postMessage. The script inside the iframe (injected by useContentHooks)
   * will do elementFromPoint and send the descriptionId back via postMessage.
   *
   * SWIPE MODE FIX (January 2026):
   * When navigationEnabled is false (swipe mode), we also detect swipe gestures here.
   * The center zone overlay intercepts all touches before they reach the iframe,
   * so we must handle swipes in this component for iOS.
   *
   * Flow for taps:
   * 1. User taps in center zone
   * 2. We calculate coordinates relative to iframe
   * 3. We send postMessage to iframe with coordinates: { type: 'TAP_COORDINATES', x, y }
   * 4. Script in iframe does elementFromPoint, finds description
   * 5. Script sends postMessage back: { type: 'DESCRIPTION_CLICK', descriptionId }
   * 6. useDescriptionHighlighting receives message and triggers callback
   *
   * Flow for swipes (when navigationEnabled is false):
   * 1. User swipes horizontally
   * 2. We detect the swipe direction
   * 3. We call onPrevPage or onNextPage
   */
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

    // Find the epub-viewer container (not iframe - iframe has scroll offset)
    const viewer = document.querySelector('#epub-viewer') as HTMLElement | null;
    const iframe = document.querySelector('#epub-viewer iframe') as HTMLIFrameElement | null;

    if (!viewer || !iframe) {
      setDebugTapInfo('ERROR: No viewer/iframe');
      setTimeout(() => setDebugTapInfo(null), 2000);
      return;
    }

    // Use viewer container rect (stable position, not affected by epub.js pagination)
    const viewerRect = viewer.getBoundingClientRect();

    // Calculate coordinates relative to viewer's visible area
    // These are the coordinates we need for elementFromPoint inside iframe
    const viewportX = touch.clientX - viewerRect.left;
    const viewportY = touch.clientY - viewerRect.top;

    // Try multiple methods to send coordinates to iframe
    const coordinateData = {
      type: 'TAP_COORDINATES',
      x: viewportX,
      y: viewportY,
      timestamp: Date.now(), // For debugging
    };

    let methodUsed = '';

    // Method 1: BroadcastChannel (works with blob: iframes on same origin)
    // This is the most reliable method for iOS PWA
    try {
      const channel = new BroadcastChannel(TAP_CHANNEL_NAME);
      channel.postMessage(coordinateData);
      channel.close();
      methodUsed = 'BC';
    } catch (_e) {
      // BroadcastChannel not supported
    }

    // Method 2: iframe.contentWindow.postMessage (backup)
    try {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage(coordinateData, '*');
        if (!methodUsed) methodUsed = 'M1';
        else methodUsed += '+M1';
      }
    } catch (_e) {
      // Method 2 failed
    }

    // Method 3: window.frames collection (backup)
    try {
      const frames = window.frames;
      if (frames.length > 0) {
        frames[0].postMessage(coordinateData, '*');
        if (!methodUsed) methodUsed = 'M2';
        else methodUsed += '+M2';
      }
    } catch (_e) {
      // Method 3 failed
    }

    if (methodUsed) {
      setDebugTapInfo(`${methodUsed}:${Math.round(viewportX)},${Math.round(viewportY)}`);
    } else {
      setDebugTapInfo('FAIL: No method worked');
    }

    setTimeout(() => setDebugTapInfo(null), 2000);
  }, [enabled, navigationEnabled, onPrevPage, onNextPage]);

  // Common styles for tap zones
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    top: `calc(${headerHeight}px + env(safe-area-inset-top))`,
    bottom: 'env(safe-area-inset-bottom)',
    zIndex: 5, // Above iframe but below UI elements
    backgroundColor: 'transparent',
    touchAction: 'manipulation',
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
