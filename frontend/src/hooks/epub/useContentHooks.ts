/**
 * useContentHooks - epub.js content hooks for custom styling and manipulation
 *
 * Uses epub.js hooks system to inject custom styles and manipulate content
 * before rendering. More reliable than manual DOM manipulation.
 *
 * Updated: Reduced internal padding from 1.5em to 0.75em for compact layout
 *
 * @param rendition - epub.js Rendition instance
 * @param theme - Current theme
 *
 * @example
 * useContentHooks(rendition, theme);
 */

import { useEffect } from 'react';
import type { Rendition, Contents } from '@/types/epub';
import type { ThemeName } from './useEpubThemes';

/**
 * Measure safe-area-inset-bottom from the parent window.
 * CSS env() variables may not work inside blob: iframes, so we measure from parent.
 */
const getSafeAreaInsetBottom = (): number => {
  if (typeof window === 'undefined') return 0;

  try {
    // Create a temporary element to measure the CSS env() value
    const measureDiv = document.createElement('div');
    measureDiv.style.cssText = 'position:fixed;bottom:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden;';
    document.body.appendChild(measureDiv);
    const computed = window.getComputedStyle(measureDiv);
    const safeAreaBottom = parseFloat(computed.paddingBottom) || 0;
    document.body.removeChild(measureDiv);
    return safeAreaBottom;
  } catch {
    return 0;
  }
};

export const useContentHooks = (
  rendition: Rendition | null,
  theme: ThemeName
): void => {
  useEffect(() => {
    if (!rendition) return;

    /**
     * Content hook - runs when section content is loaded
     * Perfect for injecting custom styles, manipulating images, etc.
     */
    const contentHook = (contents: Contents, _view?: unknown) => {
      const doc = contents.document;
      if (!doc) return;

      // Measure safe-area-inset-bottom from parent window
      // CSS env() may not cascade into blob: iframes on iOS
      const safeAreaBottom = getSafeAreaInsetBottom();

      // Inject custom CSS for better readability
      const style = doc.createElement('style');
      style.textContent = `
        /* Image optimization */
        img {
          max-width: 100% !important;
          height: auto !important;
          display: block !important;
          margin: 1em auto !important;
        }

        /* Better paragraph spacing */
        p {
          margin-bottom: 1em !important;
          text-align: justify !important;
          hyphens: auto !important;
        }

        /* Headings */
        h1, h2, h3, h4, h5, h6 {
          margin-top: 1.5em !important;
          margin-bottom: 0.5em !important;
          font-weight: bold !important;
        }

        /* Quotes */
        blockquote {
          margin: 1em 2em !important;
          padding-left: 1em !important;
          border-left: 3px solid currentColor !important;
          opacity: 0.8 !important;
        }

        /* Links */
        a {
          text-decoration: none !important;
          border-bottom: 1px dotted currentColor !important;
        }

        a:hover {
          opacity: 0.8 !important;
        }

        /* Lists */
        ul, ol {
          margin: 1em 0 !important;
          padding-left: 2em !important;
        }

        li {
          margin-bottom: 0.5em !important;
        }

        /* Tables */
        table {
          width: 100% !important;
          border-collapse: collapse !important;
          margin: 1em 0 !important;
        }

        th, td {
          padding: 0.5em !important;
          border: 1px solid currentColor !important;
        }

        /* Code blocks */
        pre, code {
          font-family: 'Courier New', monospace !important;
          font-size: 0.9em !important;
        }

        pre {
          padding: 1em !important;
          overflow-x: auto !important;
          border-radius: 4px !important;
          opacity: 0.9 !important;
        }

        /* Horizontal rules */
        hr {
          margin: 2em 0 !important;
          border: none !important;
          border-top: 1px solid currentColor !important;
          opacity: 0.3 !important;
        }

        /* Minimal padding on body for compact layout */
        /* Mobile touch optimizations */
        /* iOS Safari fix: cursor:pointer enables click event delegation */
        /* https://www.quirksmode.org/blog/archives/2010/09/click_event_del.html */
        /* Safe-area-inset-bottom: measured from parent, added as bottom padding */
        /* This prevents last lines from being hidden behind iOS/Android nav elements */
        body {
          margin: 0 !important;
          padding: 0.75em 0.75em calc(0.75em + ${safeAreaBottom}px) 0.75em !important;
          -webkit-overflow-scrolling: touch;
          touch-action: manipulation;
          overscroll-behavior: contain;
          cursor: pointer;
        }

        /* iOS Safari Fix (January 2026): Force single-column layout */
        /* Only applied on iOS devices via @supports with iOS-specific check */
        /* This prevents double-page turn bug on iOS without affecting Android */
        /* NOTE: touch-action changed from pan-y to manipulation to allow JS scrolling */
        @supports (-webkit-touch-callout: none) {
          /* -webkit-touch-callout is iOS-only, not supported on Android Chrome */
          html, body {
            column-count: 1 !important;
            -webkit-column-count: 1 !important;
            column-width: auto !important;
            -webkit-column-width: auto !important;
            /* Use manipulation instead of pan-y to allow JS-controlled horizontal scrolling */
            /* pan-y was blocking stage.scrollTo() from working properly */
            touch-action: manipulation !important;
            overscroll-behavior-x: none !important;
          }
        }

        /* Disable text selection on touch devices (mobile) */
        /* Prevents accidental text selection when tapping to navigate */
        @media (pointer: coarse), (hover: none) {
          body, p, span, div, h1, h2, h3, h4, h5, h6, li, td, th, blockquote {
            -webkit-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
            user-select: none !important;
            -webkit-touch-callout: none !important;
          }
        }

        /* Smooth scrolling and mobile tap highlight removal */
        * {
          scroll-behavior: smooth !important;
          -webkit-tap-highlight-color: transparent;
        }

        /* Ensure description highlights are tappable on mobile */
        .description-highlight {
          touch-action: manipulation;
          -webkit-touch-callout: none;
          cursor: pointer;
        }

        /* Selection color based on theme */
        ::selection {
          ${theme === 'dark' ? 'background-color: rgba(96, 165, 250, 0.3);' : ''}
          ${theme === 'light' ? 'background-color: rgba(37, 99, 235, 0.3);' : ''}
          ${theme === 'sepia' ? 'background-color: rgba(139, 90, 43, 0.3);' : ''}
        }
      `;

      doc.head.appendChild(style);

      // Fix broken images (optional)
      const images = doc.querySelectorAll('img');
      images.forEach((img: HTMLImageElement) => {
        img.addEventListener('error', () => {
          // Hide broken images
          img.style.display = 'none';
        });
      });

      /**
       * iOS PWA FIX (January 2026): Bidirectional postMessage for description clicks
       *
       * Problem: On iOS PWA standalone mode:
       * 1. Touch events don't propagate from iframe to parent (WebKit Bug 128924)
       * 2. Parent cannot access iframe.contentDocument (security restrictions, returns null)
       * 3. elementFromPoint from parent doesn't work
       *
       * Solution: Bidirectional postMessage communication
       * 1. Parent sends tap coordinates to iframe via postMessage
       * 2. Iframe receives coordinates, does elementFromPoint INSIDE iframe (works!)
       * 3. Iframe sends descriptionId back to parent via postMessage
       *
       * This completely bypasses all iframe security and touch event issues.
       */
      const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      if (isIOSDevice) {
        /**
         * BroadcastChannel name must match parent (IOSTapZones.tsx)
         */
        const TAP_CHANNEL_NAME = 'ios-tap-coordinates';

        /**
         * Send debug message to parent for visual feedback
         */
        const sendDebug = (message: string) => {
          try {
            const targetWindow = window.top || window.parent;
            targetWindow.postMessage({ type: 'IFRAME_DEBUG', message }, '*');
          } catch (_e) {
            // Ignore
          }
        };

        /**
         * Process tap coordinates and find description
         */
        const processTapCoordinates = (x: number, y: number, source: string) => {
          sendDebug(`${source}:${Math.round(x)},${Math.round(y)}`);

          // Use elementFromPoint INSIDE the iframe (this works!)
          const elementAtPoint = doc.elementFromPoint(x, y);

          if (!elementAtPoint) {
            sendDebug('NO_EL');
            return;
          }

          // Walk up the DOM tree to find description-highlight
          let target: HTMLElement | null = elementAtPoint as HTMLElement;
          let descriptionId: string | null = null;

          while (target && target !== doc.body) {
            if (target.classList?.contains('description-highlight')) {
              descriptionId = target.getAttribute('data-description-id');
              break;
            }
            target = target.parentElement;
          }

          if (descriptionId) {
            sendDebug(`FOUND:${descriptionId.slice(0, 8)}`);

            // Send description ID back to parent
            try {
              const targetWindow = window.top || window.parent;
              targetWindow.postMessage({
                type: 'DESCRIPTION_CLICK',
                descriptionId: descriptionId,
              }, '*');
            } catch (_err) {
              try {
                window.parent.postMessage({
                  type: 'DESCRIPTION_CLICK',
                  descriptionId: descriptionId,
                }, '*');
              } catch (_e) {
                // Ignore errors
              }
            }
          } else {
            // Show what element we found instead
            sendDebug(`EL:${elementAtPoint.tagName}.${(elementAtPoint.className || '').toString().slice(0, 10)}`);
          }
        };

        /**
         * Method 1: BroadcastChannel listener (most reliable for iOS PWA)
         * BroadcastChannel works with blob: iframes on same origin
         */
        let tapChannel: BroadcastChannel | null = null;
        try {
          tapChannel = new BroadcastChannel(TAP_CHANNEL_NAME);
          tapChannel.onmessage = (event) => {
            if (event.data?.type !== 'TAP_COORDINATES') return;
            const { x, y } = event.data;
            if (typeof x !== 'number' || typeof y !== 'number') return;
            processTapCoordinates(x, y, 'BC');
          };
          if (import.meta.env.DEV) {
            console.log('[useContentHooks] iOS PWA: BroadcastChannel listener registered');
          }
        } catch (_e) {
          // BroadcastChannel not supported
          if (import.meta.env.DEV) {
            console.log('[useContentHooks] iOS PWA: BroadcastChannel not supported');
          }
        }

        /**
         * Method 2: postMessage listener (backup)
         * Listen for tap coordinates from parent window
         */
        const handleParentMessage = (event: MessageEvent) => {
          if (event.data?.type !== 'TAP_COORDINATES') return;
          const { x, y } = event.data;
          if (typeof x !== 'number' || typeof y !== 'number') return;
          processTapCoordinates(x, y, 'PM');
        };

        // Listen for messages from parent
        window.addEventListener('message', handleParentMessage);

        if (import.meta.env.DEV) {
          console.log('[useContentHooks] iOS PWA: postMessage listener registered');
        }

        // Also keep touch handlers as fallback (in case touch events do work)
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;

        const handleTouchStart = (e: TouchEvent) => {
          const touch = e.touches[0];
          if (touch) {
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchStartTime = Date.now();
          }
        };

        const handleTouchEnd = (e: TouchEvent) => {
          const touch = e.changedTouches[0];
          if (!touch) return;

          const deltaX = Math.abs(touch.clientX - touchStartX);
          const deltaY = Math.abs(touch.clientY - touchStartY);
          const duration = Date.now() - touchStartTime;

          const isTap = deltaX < 20 && deltaY < 20 && duration < 350;
          if (!isTap) return;

          let target = e.target as HTMLElement | null;
          let descriptionId: string | null = null;

          while (target && target !== doc.body) {
            if (target.classList?.contains('description-highlight')) {
              descriptionId = target.getAttribute('data-description-id');
              break;
            }
            target = target.parentElement;
          }

          if (descriptionId) {
            e.preventDefault();
            e.stopPropagation();

            try {
              const targetWindow = window.top || window.parent;
              targetWindow.postMessage({
                type: 'DESCRIPTION_CLICK',
                descriptionId: descriptionId,
              }, '*');

              if (import.meta.env.DEV) {
                console.log('[useContentHooks] iOS: Touch fallback - sent postMessage:', descriptionId);
              }
            } catch (_err) {
              // Ignore errors
            }
          }
        };

        doc.body.addEventListener('touchstart', handleTouchStart, { passive: true });
        doc.body.addEventListener('touchend', handleTouchEnd, { passive: false });

        // NOTE (January 2026): Removed horizontal swipe prevention code
        // The previous code was blocking stage.scrollTo() from working properly
        // Navigation is now handled by:
        // 1. directScroll() with correct layout.delta scroll unit
        // 2. IOSTapZones overlay for tap/swipe detection
        // epub.js internal swipe handlers are controlled by touch-action CSS

        if (import.meta.env.DEV) {
          console.log('[useContentHooks] iOS PWA: Touch handlers registered (swipe prevention removed)');
        }
      }
    };

    // Register the hook
    rendition.hooks.content.register(contentHook);

    // Cleanup
    return () => {
      try {
        rendition.hooks.content.deregister(contentHook);
      } catch (_err) {
        // Ignore deregistration errors during cleanup
      }
    };
  }, [rendition, theme]);
};
