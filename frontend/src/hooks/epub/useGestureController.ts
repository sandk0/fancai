/**
 * useGestureController - Unified gesture controller for EPUB reader
 *
 * Replaces three parallel gesture systems:
 * - useFollowFingerSwipe (swipe navigation with follow-finger)
 * - useTouchNavigation (tap navigation via iframe for Android/desktop)
 * - IOSTapZones (tap navigation overlay for iOS)
 *
 * Architecture: Coordinator with FSM
 * - FSM states: idle -> pending -> swiping | tap | cancelled
 * - All touch state is ref-based (no re-renders on touchmove)
 * - Reuses exported utilities from gestureUtils
 * - Hybrid iOS/Android: swipe via iframe hooks.content.register(),
 *   taps via iframe on Android/desktop, overlay on iOS for center-tap
 *
 * @module hooks/epub/useGestureController
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useMotionValue, animate } from 'motion/react';
import type { MotionValue } from 'motion/react';
import type { Rendition, Contents } from '@/types/epub';
import type { NavigationLock } from '@/hooks/shared/useNavigationLock';
import { isIOS } from '@/utils/iosSupport';
import { logger } from '@/lib/logger';
import {
  SPRING_FAST,
  SPRING_TAP,
  INITIAL_TOUCH,
  getStageInfo,
  processTouchStart,
  processTouchMove,
  processSwipeCompletion,
  processTouchCancel,
} from './gestureUtils';
import type {
  FollowFingerPhase,
  TouchState,
  GestureFSMDeps,
  SwipeCompletionDeps,
} from './gestureUtils';

// ---------------------------------------------------------------------------
// FSM types
// ---------------------------------------------------------------------------

type InteractiveType = 'description' | 'entity' | 'annotation' | 'link' | null;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TAP_MAX_MOVEMENT = 20; // px
const LONG_PRESS_TIMEOUT = 250; // ms -- after this, release without action = long-press

// Tap zone boundaries (fraction of viewport width)
const EDGE_ZONE_IFRAME = 0.15; // 15% edges for iframe-based taps (matches iOS zone)
const EDGE_ZONE_IOS = 0.15; // 15% edges for iOS overlay

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface GestureControllerOptions {
  rendition: Rendition | null;
  enabled: boolean;
  /** Navigate within chapter (page turn) */
  onNavigate: (dir: 'next' | 'prev') => Promise<void>;
  /** Navigate between chapters (at boundary) */
  onChapterChange?: (dir: 'next' | 'prev') => Promise<void>;
  /** Edge tap navigation callback */
  onEdgeTap: (dir: 'next' | 'prev') => void;
  /** Center tap callback (coordinates relative to iframe for description/entity detection).
   *  Returns true if an interactive element was found and handled. */
  onCenterTap: (x: number, y: number) => boolean | Promise<boolean>;
  /** Toggle UI visibility (header show/hide) */
  onToggleUI: () => void;
  /** Called when swipe starts (>10px) for auto-hide */
  onSwipeStart: () => void;
  /** Called on tap navigation for auto-hide */
  onTapNavigate: () => void;
  /** Shared navigation lock */
  navLock: NavigationLock;
  /** Whether any panel (drawer, settings, TOC) is open */
  isPanelOpen: boolean;
  /** Whether page turn animations are enabled */
  pageAnimationEnabled?: boolean;
  /** Called when user taps inside iframe while a panel is open — dismisses all panels */
  onPanelDismiss?: () => void;
  /** Whether header is visible (for dynamic iOS overlay top) */
  isHeaderVisible?: boolean;
  /** Whether text selection is currently active (iOS: keeps overlay hidden) */
  isSelectionActive?: boolean;
}

export interface GestureControllerReturn {
  /** Motion value for follow-finger transform */
  translateX: MotionValue<number>;
  /** Current visual phase (for FollowFingerContainer) */
  phase: FollowFingerPhase;
  /** Boundary state for rubber-band */
  isAtBoundary: 'start' | 'end' | null;
  /** Whether chapter hint should be shown */
  showChapterHint: boolean;
  /** Direction of chapter hint */
  chapterHintDirection: 'next' | 'prev' | null;
  /** Trigger slide-in animation for tap navigation */
  triggerSlideAnimation: (direction: 'next' | 'prev') => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useGestureController = (
  options: GestureControllerOptions
): GestureControllerReturn => {
  const {
    rendition,
    enabled,
    onNavigate,
    onChapterChange,
    onEdgeTap,
    onCenterTap,
    onToggleUI,
    onSwipeStart,
    onTapNavigate,
    navLock,
    isPanelOpen,
    pageAnimationEnabled = true,
    onPanelDismiss,
    isHeaderVisible,
    isSelectionActive,
  } = options;

  // Motion value for GPU-accelerated transform
  const translateX = useMotionValue(0);

  // Minimal state for rendering
  const [phase, setPhase] = useState<FollowFingerPhase>('idle');
  const [isAtBoundary, setIsAtBoundary] = useState<'start' | 'end' | null>(null);
  const [showChapterHint, setShowChapterHint] = useState(false);
  const [chapterHintDirection, setChapterHintDirection] = useState<'next' | 'prev' | null>(null);

  // Refs for hint state to minimize setState calls in touchmove (performance)
  const showChapterHintRef = useRef(false);
  const chapterHintDirectionRef = useRef<'next' | 'prev' | null>(null);
  const isAtBoundaryRef = useRef<'start' | 'end' | null>(null);

  // Refs for touch state and callbacks
  const touchRef = useRef<TouchState>({ ...INITIAL_TOUCH });
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const enabledRef = useRef(enabled);
  const isPanelOpenRef = useRef(isPanelOpen);
  const onNavigateRef = useRef(onNavigate);
  const onChapterChangeRef = useRef(onChapterChange);
  const onEdgeTapRef = useRef(onEdgeTap);
  const onCenterTapRef = useRef(onCenterTap);
  const onToggleUIRef = useRef(onToggleUI);
  const onSwipeStartRef = useRef(onSwipeStart);
  const onTapNavigateRef = useRef(onTapNavigate);
  const onPanelDismissRef = useRef(onPanelDismiss);
  const navLockRef = useRef(navLock);
  const pageAnimationEnabledRef = useRef(pageAnimationEnabled);

  // Pending nav ref for guaranteed-last pattern
  const pendingNavRef = useRef<'next' | 'prev' | null>(null);

  // iOS selection mode: overlay hide/show for text selection passthrough
  const selectionModeRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    isPanelOpenRef.current = isPanelOpen;
  }, [isPanelOpen]);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);
  useEffect(() => {
    onChapterChangeRef.current = onChapterChange;
  }, [onChapterChange]);
  useEffect(() => {
    onEdgeTapRef.current = onEdgeTap;
  }, [onEdgeTap]);
  useEffect(() => {
    onCenterTapRef.current = onCenterTap;
  }, [onCenterTap]);
  useEffect(() => {
    onToggleUIRef.current = onToggleUI;
  }, [onToggleUI]);
  useEffect(() => {
    onSwipeStartRef.current = onSwipeStart;
  }, [onSwipeStart]);
  useEffect(() => {
    onTapNavigateRef.current = onTapNavigate;
  }, [onTapNavigate]);
  useEffect(() => {
    onPanelDismissRef.current = onPanelDismiss;
  }, [onPanelDismiss]);
  useEffect(() => {
    navLockRef.current = navLock;
  }, [navLock]);
  useEffect(() => {
    pageAnimationEnabledRef.current = pageAnimationEnabled;
  }, [pageAnimationEnabled]);

  const isHeaderVisibleRef = useRef(isHeaderVisible ?? false);
  useEffect(() => {
    isHeaderVisibleRef.current = isHeaderVisible ?? false;
  }, [isHeaderVisible]);

  const isSelectionActiveRef = useRef(isSelectionActive ?? false);
  useEffect(() => {
    isSelectionActiveRef.current = isSelectionActive ?? false;
  }, [isSelectionActive]);

  // Stable reset
  const resetState = useCallback(() => {
    touchRef.current = { ...INITIAL_TOUCH };
    setPhase('idle');
    setIsAtBoundary(null);
    setShowChapterHint(false);
    setChapterHintDirection(null);
    showChapterHintRef.current = false;
    chapterHintDirectionRef.current = null;
    isAtBoundaryRef.current = null;
  }, []);

  // -------------------------------------------------------------------------
  // Navigation with guaranteed-last pattern (from IOSTapZones)
  // -------------------------------------------------------------------------
  const handleTapNavigation = useCallback(async (action: 'next' | 'prev') => {
    if (!navLockRef.current.acquire()) {
      // Lock held -- store last tap (guaranteed-last)
      pendingNavRef.current = action;
      return;
    }

    try {
      if (action === 'prev') {
        await onNavigateRef.current('prev');
      } else {
        await onNavigateRef.current('next');
      }
    } finally {
      navLockRef.current.release();
      // Execute pending tap if any
      const pending = pendingNavRef.current;
      pendingNavRef.current = null;
      if (pending) {
        handleTapNavigation(pending);
      }
    }
  }, []);

  // -------------------------------------------------------------------------
  // Get iframe offset for zone detection (screen X coordinate)
  // -------------------------------------------------------------------------
  const getIframeOffset = useCallback((contents: Contents): number => {
    try {
      const iframeWindow = contents.window;
      if (iframeWindow && iframeWindow.frameElement) {
        const rect = (iframeWindow.frameElement as HTMLElement).getBoundingClientRect();
        return rect.left;
      }
    } catch {
      // Ignore
    }
    return 0;
  }, []);

  // -------------------------------------------------------------------------
  // Determine tap zone from screen X position
  // -------------------------------------------------------------------------
  const getTapAction = useCallback(
    (screenX: number, isIOSOverlay: boolean): 'prev' | 'next' | 'center' => {
      const screenWidth = window.innerWidth;
      const edgeZone = isIOSOverlay ? EDGE_ZONE_IOS : EDGE_ZONE_IFRAME;
      const leftThreshold = screenWidth * edgeZone;
      const rightThreshold = screenWidth * (1 - edgeZone);

      if (screenX < leftThreshold) return 'prev';
      if (screenX > rightThreshold) return 'next';
      return 'center';
    },
    []
  );

  // -------------------------------------------------------------------------
  // Check if target is interactive and return its type
  // -------------------------------------------------------------------------
  const getInteractiveType = useCallback((target: EventTarget | null): InteractiveType => {
    // Duck-type check instead of `instanceof HTMLElement` — iframe elements
    // have a different HTMLElement constructor than the parent window,
    // so cross-frame instanceof always returns false.
    if (!target || !('classList' in target)) return null;
    const el = target as HTMLElement;
    if (el.classList?.contains('description-highlight') || el.closest?.('.description-highlight'))
      return 'description';
    if (el.classList?.contains('entity-mention') || el.closest?.('.entity-mention'))
      return 'entity';
    if (el.classList?.contains('user-annotation') || el.closest?.('.user-annotation'))
      return 'annotation';
    if (el.tagName === 'A' || el.closest?.('a')) return 'link';
    if (el.tagName === 'BUTTON' || el.closest?.('button')) return 'link';
    return null;
  }, []);

  // -------------------------------------------------------------------------
  // Main effect: bind touch events to iframe via hooks.content.register
  // Handles BOTH swipe and tap detection through unified FSM
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!rendition) return;

    const contentHook = (contents: Contents) => {
      const doc = contents.document;
      if (!doc) return;

      // iOS Safari fix: cursor:pointer for click delegation
      const body = doc.body;
      if (body) {
        body.style.cursor = 'pointer';
      }

      // Shared FSM deps (created inside useEffect closure -- refs are stable)
      const deps: GestureFSMDeps = {
        touchRef,
        translateX,
        animationRef,
        enabledRef,
        isPanelOpenRef,
        rendition,
        setPhase,
        setIsAtBoundary,
        setShowChapterHint,
        setChapterHintDirection,
        showChapterHintRef,
        chapterHintDirectionRef,
        isAtBoundaryRef,
        onSwipeStartRef,
        resetState,
      };
      const swipeDeps: SwipeCompletionDeps = {
        ...deps,
        onNavigateRef,
        onChapterChangeRef,
        navLockRef,
        pageAnimationEnabledRef,
      };

      // Selection check for iframe (overlay doesn't need this)
      const checkSelection = () => {
        const sel = doc.defaultView?.getSelection?.();
        return !!(sel && sel.toString().length > 0);
      };

      // ----- touchstart (shared FSM) -----
      const handleTouchStart = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        processTouchStart(touch, deps, checkSelection);
      };

      // ----- touchmove (shared FSM) -----
      const handleTouchMove = (e: TouchEvent) => {
        processTouchMove(e, deps, checkSelection);
      };

      // ----- touchend -----
      const handleTouchEnd = (e: TouchEvent) => {
        if (!enabledRef.current) return;

        const t = touchRef.current;
        if (t.state === 'idle' || t.state === 'cancelled') {
          touchRef.current = { ...INITIAL_TOUCH };
          return;
        }

        const touch = e.changedTouches[0];
        if (!touch) {
          resetState();
          return;
        }

        // ---------- TAP DETECTION (state === 'pending') ----------
        if (t.state === 'pending') {
          const deltaX = Math.abs(touch.clientX - t.startX);
          const deltaY = Math.abs(touch.clientY - t.startY);
          const duration = Date.now() - t.startTime;

          touchRef.current = { ...INITIAL_TOUCH };

          // Long press -- don't handle (native text selection)
          if (duration >= LONG_PRESS_TIMEOUT) {
            return;
          }

          // Check interactive elements FIRST — before movement check
          // At screen edges, finger jitter can exceed TAP_MAX_MOVEMENT (20px),
          // but user is clearly tapping on a highlight, not swiping.
          // Use relaxed movement threshold (40px) for interactive targets.
          const tapDoc = contents?.document;
          const el = tapDoc?.elementFromPoint(touch.clientX, touch.clientY);
          const interactiveType = getInteractiveType(el ?? e.target);
          const INTERACTIVE_MAX_MOVEMENT = 40; // px — relaxed for edge highlights

          logger.debug(
            '[gesture] TAP detection -- clientX:',
            touch.clientX,
            'clientY:',
            touch.clientY,
            'elementFromPoint:',
            el?.tagName,
            el?.className,
            'interactiveType:',
            interactiveType,
            'deltaX:',
            deltaX,
            'deltaY:',
            deltaY
          );

          if (
            interactiveType &&
            deltaX < INTERACTIVE_MAX_MOVEMENT &&
            deltaY < INTERACTIVE_MAX_MOVEMENT
          ) {
            if (interactiveType === 'description' || interactiveType === 'entity') {
              onCenterTapRef.current(touch.clientX, touch.clientY);
              return;
            }
            // Other interactive (links, annotations) — let native handler process
            return;
          }

          // Too much movement -- not a tap
          if (deltaX >= TAP_MAX_MOVEMENT || deltaY >= TAP_MAX_MOVEMENT) {
            return;
          }

          // Bridge: tap in iframe while panel open → dismiss all panels
          if (isPanelOpenRef.current) {
            onPanelDismissRef.current?.();
            return;
          }

          // Convert to screen coords for zone detection (ADD offset, not subtract)
          const iframeOffset = getIframeOffset(contents);
          const screenX = touch.clientX + iframeOffset;

          const action = getTapAction(screenX, false);

          logger.debug(
            '[gesture] Zone detection -- screenX:',
            screenX,
            'iframeOffset:',
            iframeOffset,
            'action:',
            action,
            'screenWidth:',
            window.innerWidth
          );

          if (action === 'center') {
            // Center tap: clientX/clientY are already iframe-viewport coords
            void (async () => {
              const handled = await onCenterTapRef.current(touch.clientX, touch.clientY);
              if (!handled) onToggleUIRef.current();
            })();
            return;
          }

          // Notify auto-hide: tap navigate
          onTapNavigateRef.current();

          // Two-phase tap navigation:
          // 1. Instant navigate FIRST (no visual scroll -- visual handled by spring)
          // 2. Spring slide-in: new page "arrives" from edge
          void (async () => {
            const stageInfo = getStageInfo(rendition);
            const vw = stageInfo?.viewportWidth || window.innerWidth;

            // Phase 1: instant navigation
            if (navLockRef.current.acquire()) {
              try {
                await onNavigateRef.current(action);
              } finally {
                navLockRef.current.release();
              }
            }

            // Phase 2: visual spring slide-in (page arrives from edge)
            if (pageAnimationEnabledRef.current) {
              const slideFrom = action === 'next' ? vw : -vw;
              translateX.set(slideFrom);
              setPhase('animating');
              if (animationRef.current) {
                animationRef.current.stop();
                animationRef.current = null;
              }
              animationRef.current = animate(translateX, 0, {
                ...SPRING_TAP,
                onComplete: () => {
                  animationRef.current = null;
                  resetState();
                },
              });
            } else {
              translateX.set(0);
              resetState();
            }
          })();

          return;
        }

        // ---------- SWIPE COMPLETION (shared FSM) ----------
        processSwipeCompletion(
          touch,
          t.startX,
          t.lastTouchX,
          t.lastTouchTime,
          t.boundary,
          swipeDeps
        );
      };

      // ----- touchcancel (shared FSM) -----
      const handleTouchCancel = () => {
        processTouchCancel(deps);
      };

      // ----- click (desktop fallback) -----
      const lastTouchTimeRef = { value: 0 };

      const handleClick = (e: MouseEvent) => {
        if (!enabledRef.current) return;

        // Ignore click shortly after touch (prevents double navigation on mobile)
        if (Date.now() - lastTouchTimeRef.value < 500) return;

        // Bridge: click in iframe while panel open → dismiss all panels
        if (isPanelOpenRef.current) {
          onPanelDismissRef.current?.();
          return;
        }

        // Check for interactive elements via elementFromPoint
        // BUG-5 fix: click events in iframe doc have clientX/clientY in iframe-viewport coords
        const clickDoc = contents?.document;
        const clickEl = clickDoc?.elementFromPoint(e.clientX, e.clientY);
        const interactiveType = getInteractiveType(clickEl ?? e.target);
        if (interactiveType === 'description' || interactiveType === 'entity') {
          onCenterTapRef.current(e.clientX, e.clientY);
          return;
        }
        if (interactiveType) {
          return;
        }

        const iframeOffset = getIframeOffset(contents);
        const screenX = e.clientX + iframeOffset;
        const action = getTapAction(screenX, false);

        if (action === 'center') {
          void (async () => {
            const handled = await onCenterTapRef.current(e.clientX, e.clientY);
            if (!handled) onToggleUIRef.current();
          })();
          return;
        }

        onTapNavigateRef.current();

        // Two-phase click navigation (same pattern as touch tap):
        // 1. Instant navigate FIRST
        // 2. Spring slide-in from edge
        void (async () => {
          const stageInfo = getStageInfo(rendition);
          const vw = stageInfo?.viewportWidth || window.innerWidth;

          // Phase 1: instant navigation
          if (navLockRef.current.acquire()) {
            try {
              await onNavigateRef.current(action);
            } finally {
              navLockRef.current.release();
            }
          }

          // Phase 2: visual spring slide-in
          if (pageAnimationEnabledRef.current) {
            const slideFrom = action === 'next' ? vw : -vw;
            translateX.set(slideFrom);
            setPhase('animating');
            if (animationRef.current) {
              animationRef.current.stop();
              animationRef.current = null;
            }
            animationRef.current = animate(translateX, 0, {
              ...SPRING_TAP,
              onComplete: () => {
                animationRef.current = null;
                resetState();
              },
            });
          } else {
            translateX.set(0);
            resetState();
          }
        })();
      };

      // Wrap touchstart to track timing for click dedup
      const wrappedTouchStart = (e: TouchEvent) => {
        lastTouchTimeRef.value = Date.now();
        handleTouchStart(e);
      };

      // Bind events to iframe document
      doc.addEventListener('touchstart', wrappedTouchStart, { passive: true });
      doc.addEventListener('touchmove', handleTouchMove, { passive: false });
      doc.addEventListener('touchend', handleTouchEnd, { passive: true });
      doc.addEventListener('touchcancel', handleTouchCancel, { passive: true });
      doc.addEventListener('click', handleClick, { capture: false });

      // Store cleanup
      // @ts-expect-error - custom property for cleanup
      doc.__gestureControllerCleanup = () => {
        doc.removeEventListener('touchstart', wrappedTouchStart);
        doc.removeEventListener('touchmove', handleTouchMove);
        doc.removeEventListener('touchend', handleTouchEnd);
        doc.removeEventListener('touchcancel', handleTouchCancel);
        doc.removeEventListener('click', handleClick);
      };
    };

    // Register hook
    rendition.hooks.content.register(contentHook);

    // Setup for already-rendered contents
    try {
      const existingContents = rendition.getContents();
      if (existingContents && existingContents.length > 0) {
        existingContents.forEach(contentHook);
      }
    } catch {
      // Ignore
    }

    return () => {
      if (animationRef.current) {
        animationRef.current.stop();
        animationRef.current = null;
      }
      translateX.set(0);

      try {
        rendition.hooks.content.deregister(contentHook);
      } catch {
        // Ignore
      }

      try {
        const contents = rendition.getContents();
        if (contents) {
          contents.forEach((c) => {
            // @ts-expect-error - custom property for cleanup
            if (c.document && c.document.__gestureControllerCleanup) {
              // @ts-expect-error - custom property for cleanup
              c.document.__gestureControllerCleanup();
            }
          });
        }
      } catch {
        // Ignore
      }
    };
  }, [rendition, translateX, resetState, getIframeOffset, getTapAction, getInteractiveType]);

  // -------------------------------------------------------------------------
  // iOS full-screen gesture overlay
  // iOS Safari does not deliver touch/pointer events to iframe contentDocument
  // (confirmed: 100% events source:parent, 0% source:iframe).
  // This overlay handles ALL gestures on iOS: edge taps, center taps,
  // horizontal swipes with follow-finger, rubber-band at boundaries,
  // vertical cancel, and touchcancel.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isIOS() || !rendition || !enabled) return;

    const overlayId = 'gesture-controller-ios-overlay';

    // Remove existing if present
    const existing = document.getElementById(overlayId);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.cssText = `
      position: absolute;
      top: calc(env(safe-area-inset-top) + 64px);
      bottom: env(safe-area-inset-bottom);
      left: 10px;
      right: 0;
      z-index: 5;
      background-color: transparent;
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
      -webkit-user-select: none;
      user-select: none;
    `;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('role', 'presentation');

    // Shared FSM deps for overlay (created inside useEffect closure -- refs are stable)
    const deps: GestureFSMDeps = {
      touchRef,
      translateX,
      animationRef,
      enabledRef,
      isPanelOpenRef,
      rendition,
      setPhase,
      setIsAtBoundary,
      setShowChapterHint,
      setChapterHintDirection,
      showChapterHintRef,
      chapterHintDirectionRef,
      isAtBoundaryRef,
      onSwipeStartRef,
      resetState,
    };
    const swipeDeps: SwipeCompletionDeps = {
      ...deps,
      onNavigateRef,
      onChapterChangeRef,
      navLockRef,
      pageAnimationEnabledRef,
    };

    // --- Selection mode: hide/show overlay for text selection passthrough ---
    const enterSelectionMode = () => {
      if (selectionModeRef.current) return;
      overlay.style.pointerEvents = 'none';
      overlay.style.display = 'none';
      selectionModeRef.current = true;
    };

    // ----- handleOverlayTouchStart (shared FSM) -----
    const handleOverlayTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      processTouchStart(touch, deps);

      // Long-press detection for text selection passthrough (iOS only)
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        if (touchRef.current.state === 'pending') {
          enterSelectionMode();
        }
      }, 200); // 200ms < LONG_PRESS_TIMEOUT (250ms): overlay hides BEFORE iOS Safari hit-test
    };

    // ----- handleOverlayTouchMove (shared FSM) -----
    const handleOverlayTouchMove = (e: TouchEvent) => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      processTouchMove(e, deps);
    };

    // ----- handleOverlayTouchEnd -----
    const handleOverlayTouchEnd = (e: TouchEvent) => {
      // Cancel long-press timer
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      // If in selection mode, overlay is hidden -- skip gesture processing
      if (selectionModeRef.current) {
        touchRef.current = { ...INITIAL_TOUCH };
        return;
      }
      if (!enabledRef.current) return;

      const t = touchRef.current;
      if (t.state === 'idle' || t.state === 'cancelled') {
        touchRef.current = { ...INITIAL_TOUCH };
        return;
      }

      const touch = e.changedTouches[0];
      if (!touch) {
        resetState();
        return;
      }

      // ---------- TAP DETECTION (state === 'pending') ----------
      if (t.state === 'pending') {
        const deltaX = Math.abs(touch.clientX - t.startX);
        const deltaY = Math.abs(touch.clientY - t.startY);
        const duration = Date.now() - t.startTime;

        touchRef.current = { ...INITIAL_TOUCH };

        // Long press -- don't handle (native text selection)
        if (duration >= LONG_PRESS_TIMEOUT) {
          return;
        }

        // FIX: don't fire toggleUI if tap is in header area (fallback guard)
        const headerThreshold = 80; // safe-area + header height
        if (touch.clientY < headerThreshold) {
          return;
        }

        // Bridge: iOS overlay tap while panel open -> dismiss all panels
        if (isPanelOpenRef.current) {
          onPanelDismissRef.current?.();
          return;
        }

        // Interactive element detection through iframe boundary
        const iframe = document.querySelector('#epub-viewer iframe') as HTMLIFrameElement | null;
        if (iframe) {
          const iframeRect = iframe.getBoundingClientRect();
          const viewportX = touch.clientX - iframeRect.left;
          const viewportY = touch.clientY - iframeRect.top;

          // Check interactive elements FIRST -- before zone detection
          const iframeDoc = iframe.contentDocument;
          const el = iframeDoc?.elementFromPoint(viewportX, viewportY);
          const interactiveType = getInteractiveType(el ?? null);

          // Relaxed movement threshold for interactive targets (finger jitter at edges)
          const INTERACTIVE_MAX_MOVEMENT = 40;

          logger.debug(
            '[gesture:overlay] TAP detection -- clientX:',
            touch.clientX,
            'clientY:',
            touch.clientY,
            'viewportX:',
            viewportX,
            'viewportY:',
            viewportY,
            'interactiveType:',
            interactiveType,
            'deltaX:',
            deltaX,
            'deltaY:',
            deltaY
          );

          if (
            interactiveType &&
            deltaX < INTERACTIVE_MAX_MOVEMENT &&
            deltaY < INTERACTIVE_MAX_MOVEMENT
          ) {
            if (interactiveType === 'description' || interactiveType === 'entity') {
              onCenterTapRef.current(viewportX, viewportY);
              return;
            }
            // Other interactive (links, annotations) -- dispatch synthetic click
            if (el) (el as HTMLElement).click?.();
            return;
          }

          // Too much movement -- not a tap
          if (deltaX >= TAP_MAX_MOVEMENT || deltaY >= TAP_MAX_MOVEMENT) {
            return;
          }
        } else {
          // No iframe -- still check movement
          if (deltaX >= TAP_MAX_MOVEMENT || deltaY >= TAP_MAX_MOVEMENT) {
            return;
          }
        }

        // Zone detection -- coordinates already in screen space (overlay in parent document)
        const action = getTapAction(touch.clientX, true);

        logger.debug(
          '[gesture:overlay] Zone detection -- clientX:',
          touch.clientX,
          'action:',
          action,
          'screenWidth:',
          window.innerWidth
        );

        if (action === 'center') {
          // Center tap: try interactive detection via iframe, then toggle UI
          const iframeForCenter = document.querySelector(
            '#epub-viewer iframe'
          ) as HTMLIFrameElement | null;
          if (iframeForCenter) {
            const iframeRect = iframeForCenter.getBoundingClientRect();
            void (async () => {
              const handled = await onCenterTapRef.current(
                touch.clientX - iframeRect.left,
                touch.clientY - iframeRect.top
              );
              if (!handled) onToggleUIRef.current();
            })();
          } else {
            onToggleUIRef.current();
          }
          return;
        }

        // Edge tap -> navigation with two-phase spring animation
        onTapNavigateRef.current();

        void (async () => {
          const stageInfo = getStageInfo(rendition);
          const vw = stageInfo?.viewportWidth || window.innerWidth;

          // Phase 1: instant navigation
          if (navLockRef.current.acquire()) {
            try {
              await onNavigateRef.current(action);
            } finally {
              navLockRef.current.release();
            }
          }

          // Phase 2: visual spring slide-in (page arrives from edge)
          if (pageAnimationEnabledRef.current) {
            const slideFrom = action === 'next' ? vw : -vw;
            translateX.set(slideFrom);
            setPhase('animating');
            if (animationRef.current) {
              animationRef.current.stop();
              animationRef.current = null;
            }
            animationRef.current = animate(translateX, 0, {
              ...SPRING_TAP,
              onComplete: () => {
                animationRef.current = null;
                resetState();
              },
            });
          } else {
            translateX.set(0);
            resetState();
          }
        })();

        return;
      }

      // ---------- SWIPE COMPLETION (shared FSM) ----------
      processSwipeCompletion(touch, t.startX, t.lastTouchX, t.lastTouchTime, t.boundary, swipeDeps);
    };

    // ----- handleOverlayTouchCancel (shared FSM) -----
    const handleOverlayTouchCancel = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      processTouchCancel(deps);
    };

    // Bind events to overlay
    overlay.addEventListener('touchstart', handleOverlayTouchStart, { passive: true });
    overlay.addEventListener('touchmove', handleOverlayTouchMove, { passive: false });
    overlay.addEventListener('touchend', handleOverlayTouchEnd, { passive: true });
    overlay.addEventListener('touchcancel', handleOverlayTouchCancel, { passive: true });

    // Find the reader container to append the overlay
    const container = document.querySelector('.relative.h-full.w-full');
    if (container) {
      container.appendChild(overlay);
    }

    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      overlay.removeEventListener('touchstart', handleOverlayTouchStart);
      overlay.removeEventListener('touchmove', handleOverlayTouchMove);
      overlay.removeEventListener('touchend', handleOverlayTouchEnd);
      overlay.removeEventListener('touchcancel', handleOverlayTouchCancel);
      overlay.remove();
    };
  }, [rendition, enabled, translateX, resetState, getTapAction, getInteractiveType]);

  // -------------------------------------------------------------------------
  // Restore iOS overlay when selection is dismissed (isSelectionActive: true -> false)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isIOS()) return;
    // Selection still active or never entered selection mode -- skip
    if (isSelectionActive || !selectionModeRef.current) return;
    // Selection dismissed -- restore overlay with debounce
    selectionModeRef.current = false;
    const restoreTimer = setTimeout(() => {
      if (selectionModeRef.current) return; // re-entered selection mode
      const ol = document.getElementById('gesture-controller-ios-overlay');
      if (ol) {
        ol.style.display = '';
        ol.style.pointerEvents = '';
      }
    }, 100);
    return () => clearTimeout(restoreTimer);
  }, [isSelectionActive]);

  // -------------------------------------------------------------------------
  // Dynamic iOS overlay top (separate effect to avoid recreating overlay)
  // In immersive mode (header hidden): top=0 for full-screen touch area.
  // When header visible: top=safe-area+64px to avoid overlapping header.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isIOS()) return;
    const overlay = document.getElementById('gesture-controller-ios-overlay');
    if (!overlay) return;
    overlay.style.top = isHeaderVisible ? 'calc(env(safe-area-inset-top) + 64px)' : '0';
  }, [isHeaderVisible]);

  // -------------------------------------------------------------------------
  // Slide-in animation for tap navigation
  // -------------------------------------------------------------------------
  const triggerSlideAnimation = useCallback(
    (direction: 'next' | 'prev') => {
      if (phase !== 'idle') return;
      if (!pageAnimationEnabledRef.current) return;

      const info = getStageInfo(rendition);
      const viewportWidth = info?.viewportWidth || window.innerWidth;
      const target = direction === 'next' ? -viewportWidth : viewportWidth;

      setPhase('animating');

      if (animationRef.current) {
        animationRef.current.stop();
        animationRef.current = null;
      }

      animationRef.current = animate(translateX, target, {
        ...SPRING_FAST,
        onComplete: () => {
          animationRef.current = null;
          translateX.set(0);
          setPhase('idle');
        },
      });
    },
    [phase, rendition, translateX]
  );

  // Log once on mount
  useEffect(() => {
    if (rendition && enabled) {
      logger.debug('[GestureController] Initialized', {
        isIOS: isIOS(),
        hasiOSOverlay: isIOS(),
      });
    }
  }, [rendition, enabled]);

  // -------------------------------------------------------------------------
  // Toggle selection-blocked class based on animation phase
  // Prevents text selection during spring animations (DOM is moving)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!rendition) return;
    try {
      const contents = rendition.getContents();
      contents.forEach((c: unknown) => {
        const doc = (c as { document: Document }).document;
        if (!doc?.body) return;
        if (phase !== 'idle') {
          doc.body.classList.add('selection-blocked');
        } else {
          doc.body.classList.remove('selection-blocked');
        }
      });
    } catch {
      // Ignore errors when contents not available
    }
  }, [rendition, phase]);

  return {
    translateX,
    phase,
    isAtBoundary,
    showChapterHint,
    chapterHintDirection,
    triggerSlideAnimation,
  };
};

export default useGestureController;
