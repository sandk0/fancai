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

import { useCallback, useRef, memo } from 'react';
import { isIOS } from '@/utils/iosSupport';
import { logger } from '@/lib/logger';
import { TapZone } from './TapZone';
import { TapFeedback } from './TapFeedback';
import type { NavigationLock } from '@/hooks/shared/useNavigationLock';

const TAP_MAX_DURATION = 350; // ms

// Note: BroadcastChannel removed - it doesn't work with blob: URL iframes on iOS Safari
// due to storage partitioning. Using callback approach instead.
const TAP_MAX_MOVEMENT = 20; // px

// Navigation zone width - VERY narrow to maximize description clickability
// 8% = roughly 30px on iPhone, enough for a finger tap on the edge
const ZONE_WIDTH_PERCENT = 8;

// Swipe detection config for iOS
const SWIPE_MIN_DISTANCE = 30; // px - minimum horizontal movement for swipe
const SWIPE_MAX_VERTICAL_RATIO = 2.0; // if deltaY/deltaX > this, it's vertical scroll

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
  /** Shared navigation lock for coordinating gesture handlers */
  navLock: NavigationLock;
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
  navLock,
}: IOSTapZonesProps) {
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastDescClickTimeRef = useRef<number>(0);
  const pendingNavRef = useRef<'next' | 'prev' | null>(null);

  const isIOSDevice = isIOS();

  /**
   * Debounce with guaranteed-last pattern:
   * - First tap executes immediately (acquires lock)
   * - Subsequent taps while locked are stored in pendingNavRef (only last one kept)
   * - After navigation completes and lock is released, pending tap executes
   */
  const handleNavigation = useCallback(
    async (action: 'next' | 'prev') => {
      if (!navLock.acquire()) {
        // Lock is held -- remember last tap (guaranteed-last)
        pendingNavRef.current = action;
        return;
      }

      try {
        if (action === 'prev') {
          await onPrevPage();
        } else {
          await onNextPage();
        }
      } finally {
        navLock.release();
        // Execute pending tap if any
        const pending = pendingNavRef.current;
        pendingNavRef.current = null;
        if (pending) {
          // Recursive call -- will try to acquire again
          handleNavigation(pending);
        }
      }
    },
    [navLock, onPrevPage, onNextPage]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      if (!touch) return;
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    },
    [enabled]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent, action: 'prev' | 'next') => {
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

      const isTap =
        duration < TAP_MAX_DURATION && deltaX < TAP_MAX_MOVEMENT && deltaY < TAP_MAX_MOVEMENT;
      if (!isTap) return;

      handleNavigation(action);
    },
    [enabled, handleNavigation]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent, action: 'prev' | 'next') => {
      e.preventDefault();
      e.stopPropagation();
      if (!enabled) return;

      handleNavigation(action);
    },
    [enabled, handleNavigation]
  );

  const handleCenterTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      if (!touch) return;
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    },
    [enabled]
  );

  const handleCenterTouchEnd = useCallback(
    (e: React.TouchEvent) => {
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
        const isVerticalScroll = deltaY > 10 && deltaY / deltaX > SWIPE_MAX_VERTICAL_RATIO;
        const isSwipe = deltaX >= SWIPE_MIN_DISTANCE && !isVerticalScroll;

        if (isSwipe) {
          const swipeDirection = rawDeltaX > 0 ? 'prev' : 'next';

          if (import.meta.env.DEV) {
            logger.debug('[IOSTapZones] Swipe detected!', { deltaX, direction: swipeDirection });
          }

          handleNavigation(swipeDirection);
          return; // Don't process as tap
        }
      }

      const isTap =
        duration < TAP_MAX_DURATION && deltaX < TAP_MAX_MOVEMENT && deltaY < TAP_MAX_MOVEMENT;

      if (!isTap) {
        if (import.meta.env.DEV) {
          logger.debug('[IOSTapZones] Center: Not a tap - ignoring', { deltaX, deltaY, duration });
        }
        return;
      }

      const now = Date.now();
      if (now - lastDescClickTimeRef.current < 300) {
        if (import.meta.env.DEV) {
          logger.debug('[IOSTapZones] Center: Debounced - ignoring');
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
        if (import.meta.env.DEV) {
          logger.debug('[IOSTapZones] Center: No iframe found');
        }
        return;
      }

      // Use iframe rect for coordinate calculation
      // These are the exact coordinates needed for elementFromPoint inside iframe
      const iframeRect = iframe.getBoundingClientRect();

      const viewportX = touch.clientX - iframeRect.left;
      const viewportY = touch.clientY - iframeRect.top;

      // NEW APPROACH (January 2026): Use callback instead of postMessage
      // BroadcastChannel and postMessage do NOT work reliably with blob: URL iframes
      // on iOS Safari due to storage partitioning and security restrictions.
      // Instead, we pass coordinates to parent component which uses
      // rendition.getContents()[0].document.elementFromPoint() - this works!
      if (onCenterTap) {
        onCenterTap(viewportX, viewportY);
      }
    },
    [enabled, navigationEnabled, handleNavigation, onCenterTap]
  );

  // Early return for non-iOS devices (after all hooks are called)
  if (!isIOSDevice) {
    return null;
  }

  if (import.meta.env.DEV) {
    logger.debug('[IOSTapZones] Rendering overlay zones on iOS', {
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
        <TapZone
          testId="ios-tap-zone-left"
          style={{
            ...baseStyle,
            left: 'env(safe-area-inset-left)',
            width: `${ZONE_WIDTH_PERCENT}%`,
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={(e) => handleTouchEnd(e, 'prev')}
          onClick={(e) => handleClick(e, 'prev')}
          ariaLabel="Previous page"
        />
      )}

      {/* Right tap zone - only when navigation is enabled (tap mode) */}
      {navigationEnabled && (
        <TapZone
          testId="ios-tap-zone-right"
          style={{
            ...baseStyle,
            right: 'env(safe-area-inset-right)',
            width: `${ZONE_WIDTH_PERCENT}%`,
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={(e) => handleTouchEnd(e, 'next')}
          onClick={(e) => handleClick(e, 'next')}
          ariaLabel="Next page"
        />
      )}

      {/* Center tap zone - for description clicks via bidirectional postMessage */}
      {/* Always rendered - sends tap coordinates to iframe, iframe finds description */}
      {/* When navigation is disabled (swipe mode), covers entire width except safe areas */}
      <TapZone
        testId="ios-tap-zone-center"
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
        ariaLabel="Content area"
        role="region"
      />

      <TapFeedback
        navigationEnabled={navigationEnabled}
        zoneWidthPercent={ZONE_WIDTH_PERCENT}
        isStandalone={isStandalone()}
      />
    </>
  );
});

export default IOSTapZones;
