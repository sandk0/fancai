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

export const useContentHooks = (rendition: Rendition | null, theme: ThemeName): void => {
  useEffect(() => {
    if (!rendition) return;

    /**
     * Content hook - runs when section content is loaded
     * Perfect for injecting custom styles, manipulating images, etc.
     */
    const contentHook = (contents: Contents, _view?: unknown) => {
      const doc = contents.document;
      if (!doc) return;

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

        /* Mobile touch optimizations */
        /* iOS Safari fix: cursor:pointer enables click event delegation */
        /* https://www.quirksmode.org/blog/archives/2010/09/click_event_del.html */
        /* NOTE: Safe-area is handled by reducing rendition height in useEpubLoader.ts */
        /* NOTE: padding is managed by epub.js layout.format() -> columns() — no override here */
        body {
          margin: 0 !important;
          -webkit-overflow-scrolling: touch;
          /* pan-x pan-y: allows JS scrolling, explicitly EXCLUDES pinch-zoom */
          /* Note: manipulation = pan-x pan-y pinch-zoom, which ALLOWS zoom! */
          touch-action: pan-x pan-y;
          overscroll-behavior: contain;
          cursor: pointer;
        }

        /* iOS Safari Fix (January 2026): Force single-column layout */
        /* Only applied on iOS devices via @supports with iOS-specific check */
        /* This prevents double-page turn bug on iOS without affecting Android */
        @supports (-webkit-touch-callout: none) {
          /* -webkit-touch-callout is iOS-only, not supported on Android Chrome */
          html, body {
            column-count: 1 !important;
            -webkit-column-count: 1 !important;
            column-width: auto !important;
            -webkit-column-width: auto !important;
            /* pan-x pan-y: allows JS-controlled scrolling (stage.scrollTo), excludes pinch-zoom */
            /* pan-y alone was blocking horizontal scrolling */
            touch-action: pan-x pan-y !important;
            overscroll-behavior-x: none !important;
          }
        }

        /* Selection blocked during animation (toggled via JS from gesture controller) */
        body.selection-blocked * {
          -webkit-user-select: none !important;
          user-select: none !important;
        }

        /* Smooth scrolling and mobile tap highlight removal */
        * {
          scroll-behavior: smooth !important;
          -webkit-tap-highlight-color: transparent;
        }

        /* Ensure description highlights are tappable on mobile */
        .description-highlight {
          touch-action: pan-x pan-y;
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

      // Suppress native context menu on mobile (show only SelectionMenu)
      // On desktop, keep both menus (native right-click + SelectionMenu)
      const handleContextMenu = (e: Event) => {
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
          e.preventDefault();
        }
      };
      doc.addEventListener('contextmenu', handleContextMenu);

      // BUG-1 fix: Suppress Chrome Touch to Search on short taps
      // Touch to Search ignores CSS touch-action; selectstart prevention is the correct approach
      // Additional layer: selection-blocked CSS class adds -webkit-user-select: none on body
      // See: https://developer.chrome.com/blog/tap-to-search
      let touchStartTime = 0;
      const LONG_PRESS_THRESHOLD = 300; // ms

      doc.addEventListener(
        'touchstart',
        () => {
          touchStartTime = Date.now();
          // Add selection-blocked immediately on touch — prevents Touch to Search
          doc.body.classList.add('selection-blocked');
        },
        { passive: true }
      );

      doc.addEventListener(
        'touchend',
        () => {
          // Always remove selection-blocked on touchend
          // For long-press, the selection already started before touchend
          doc.body.classList.remove('selection-blocked');
          touchStartTime = 0;
        },
        { passive: true }
      );

      doc.addEventListener('selectstart', (e: Event) => {
        const elapsed = Date.now() - touchStartTime;
        if (touchStartTime > 0 && elapsed < LONG_PRESS_THRESHOLD) {
          e.preventDefault();
        }
        // long-press (>=300ms) — selection allowed for note creation
      });

      // Fix broken images (optional)
      const images = doc.querySelectorAll('img');
      images.forEach((img: HTMLImageElement) => {
        img.addEventListener('error', () => {
          // Hide broken images
          img.style.display = 'none';
        });
      });

      // NOTE (January 2026): iOS description click handling moved to EpubReader.tsx
      // The old BroadcastChannel/postMessage approach didn't work with blob: iframes
      // due to Safari's storage partitioning. Now using rendition.getContents() API
      // via onCenterTap callback in IOSTapZones → EpubReader.
    };

    // Register the hook
    rendition.hooks.content.register(contentHook);

    // Cleanup
    return () => {
      try {
        rendition.hooks.content.deregister(contentHook);
      } catch {
        // Ignore deregistration errors during cleanup
      }
    };
  }, [rendition, theme]);
};
