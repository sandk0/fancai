/**
 * useAnnotationRendering - Renders bookmark annotations as DOM spans in epub.js
 *
 * Replaces the previous SVG overlay approach (rendition.annotations.highlight)
 * with direct DOM span wrapping for full CSS control over:
 * - Background color (with opacity)
 * - Text color
 * - Bold, italic, underline styles
 *
 * Uses TreeWalker + Range to wrap text nodes, similar to useDescriptionHighlighting.
 * Skips nodes already wrapped by description-highlight or entity-mention.
 *
 * Exports flashAnnotation(bookmarkId) for navigate-to-note animation.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { useBookmarks } from '@/hooks/api/useSync';
import type { BookmarkResponse } from '@/hooks/api/useSync';
import type { Rendition } from '@/types/epub';
import { logger } from '@/lib/logger';

interface UseAnnotationRenderingOptions {
  rendition: Rendition | null;
  bookId: string;
  currentChapter: number;
  enabled?: boolean;
}

interface HighlightPopup {
  bookmarkId: string;
  cfiRange: string;
  note: string | null;
  color: string | null;
  text_color: string | null;
  style: string;
  position: { x: number; y: number };
}

const ANNOTATION_CSS = `
  .user-annotation {
    cursor: pointer;
    transition: background-color 0.2s, opacity 0.2s;
  }
  .user-annotation:hover {
    opacity: 0.8;
  }
  @keyframes annotation-flash {
    0% { outline: 3px solid rgba(59, 130, 246, 0.8); outline-offset: 2px; }
    50% { outline: 3px solid rgba(59, 130, 246, 0.4); outline-offset: 4px; }
    100% { outline: 3px solid transparent; outline-offset: 2px; }
  }
  .user-annotation-flash {
    animation: annotation-flash 1.5s ease-out;
  }
`;

/**
 * Get the iframe document from rendition contents
 */
function getContentDocument(rendition: Rendition): Document | null {
  try {
    const contents = rendition.getContents();
    if (!contents?.length) return null;
    const c = contents[0] as { document?: Document };
    return c.document ?? null;
  } catch {
    return null;
  }
}

/**
 * Fallback CFI range resolver using getElementById.
 *
 * epub.js may wrap body content in an anonymous <span>, shifting CFI paths.
 * When rendition.getRange() fails (path mismatch), this function extracts the
 * element ID assertion from the CFI, finds the element via getElementById,
 * then navigates to the correct child and text offsets to build a Range.
 *
 * CFI format: epubcfi(/6/N!/path[elementId]/childStep,/1:startOffset,/1:endOffset)
 */
function resolveRangeFallback(doc: Document, cfi: string): Range | null {
  // Parse: ....[elementId]/childStep,/textStep:startOffset,/textStep:endOffset
  const match = cfi.match(/\[([^\]]+)\]\/(\d+),\/(\d+):(\d+),\/(\d+):(\d+)/);
  if (!match) return null;

  const [, elementId, childStepStr, , startOffsetStr, , endOffsetStr] = match;
  const element = doc.getElementById(elementId);
  if (!element) return null;

  // CFI child step: even numbers = element nodes (/2N = Nth element, 1-indexed)
  const childElementIndex = Math.floor(parseInt(childStepStr) / 2) - 1;
  const targetChild = element.children[childElementIndex];
  if (!targetChild) return null;

  const startOffset = parseInt(startOffsetStr);
  const endOffset = parseInt(endOffsetStr);

  // Walk text nodes to find correct positions (handles split text nodes from highlighting)
  const walker = doc.createTreeWalker(targetChild, NodeFilter.SHOW_TEXT);
  let accum = 0;
  let startNode: Text | null = null;
  let startNodeOffset = 0;
  let endNode: Text | null = null;
  let endNodeOffset = 0;

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = (node as Text).length;
    if (!startNode && accum + len > startOffset) {
      startNode = node as Text;
      startNodeOffset = startOffset - accum;
    }
    if (!endNode && accum + len >= endOffset) {
      endNode = node as Text;
      endNodeOffset = endOffset - accum;
      break;
    }
    accum += len;
  }

  if (!startNode || !endNode) return null;

  try {
    const range = doc.createRange();
    range.setStart(startNode, Math.min(startNodeOffset, startNode.length));
    range.setEnd(endNode, Math.min(endNodeOffset, endNode.length));
    return range;
  } catch {
    return null;
  }
}

/**
 * Clean up all existing user-annotation spans, restoring original text nodes
 */
function cleanupAnnotations(doc: Document): void {
  const existing = doc.querySelectorAll('.user-annotation');
  existing.forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(doc.createTextNode(el.textContent || ''), el);
      parent.normalize();
    }
  });
}

/**
 * Apply inline styles to a span based on bookmark properties
 */
function applyBookmarkStyles(span: HTMLElement, bookmark: BookmarkResponse): void {
  if (bookmark.color) {
    span.style.backgroundColor = bookmark.color + '4D'; // 30% opacity
  }
  if (bookmark.text_color) {
    span.style.color = bookmark.text_color;
  }
  if (bookmark.style === 'bold') {
    span.style.fontWeight = 'bold';
  }
  if (bookmark.style === 'italic') {
    span.style.fontStyle = 'italic';
  }
  if (bookmark.style === 'underline') {
    span.style.textDecoration = 'underline';
    span.style.textDecorationThickness = '2px';
    if (bookmark.color) {
      span.style.textDecorationColor = bookmark.color;
    }
  }
}

/**
 * Check if a node is inside a protected highlight (description/entity/annotation)
 */
function isInsideProtectedHighlight(node: Node): boolean {
  let el = node.parentElement;
  while (el) {
    if (
      el.classList.contains('description-highlight') ||
      el.classList.contains('entity-mention') ||
      el.classList.contains('user-annotation')
    ) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Wrap text nodes within a Range with annotation spans.
 *
 * TreeWalker walks descendants of root — it does NOT include the root itself.
 * When a range is entirely within one text node, commonAncestorContainer IS
 * that text node (no descendants), so we use parentNode as walker root.
 */
function wrapRangeWithSpan(doc: Document, range: Range, bookmark: BookmarkResponse): void {
  // Use parent element as walker root when range ancestor is a text node
  const walkerRoot =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? (range.commonAncestorContainer.parentNode ?? range.commonAncestorContainer)
      : range.commonAncestorContainer;

  const walker = doc.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Skip nodes entirely outside range:
      // - START_TO_END compares this.END vs source.START → < 0 means node ends before range starts
      // - END_TO_START compares this.START vs source.END → > 0 means node starts after range ends
      const nodeRange = doc.createRange();
      nodeRange.selectNodeContents(node);
      if (
        nodeRange.compareBoundaryPoints(Range.START_TO_END, range) < 0 ||
        nodeRange.compareBoundaryPoints(Range.END_TO_START, range) > 0
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip protected highlights
      if (isInsideProtectedHighlight(node)) {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip empty text nodes
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    textNodes.push(current as Text);
  }

  // Wrap each text node
  for (const textNode of textNodes) {
    const parent = textNode.parentNode;
    if (!parent) continue;

    // Determine the portion of this text node that falls within the range
    let startOffset = 0;
    let endOffset = textNode.length;

    if (textNode === range.startContainer) {
      startOffset = range.startOffset;
    }
    if (textNode === range.endContainer) {
      endOffset = range.endOffset;
    }

    const fullText = textNode.textContent || '';
    const before = fullText.substring(0, startOffset);
    const match = fullText.substring(startOffset, endOffset);
    const after = fullText.substring(endOffset);

    if (!match) continue;

    const frag = doc.createDocumentFragment();

    if (before) {
      frag.appendChild(doc.createTextNode(before));
    }

    const span = doc.createElement('span');
    span.className = 'user-annotation';
    span.setAttribute('data-bookmark-id', bookmark.id);
    span.textContent = match;
    applyBookmarkStyles(span, bookmark);
    frag.appendChild(span);

    if (after) {
      frag.appendChild(doc.createTextNode(after));
    }

    parent.replaceChild(frag, textNode);
  }
}

export function useAnnotationRendering({
  rendition,
  bookId,
  currentChapter,
  enabled = true,
}: UseAnnotationRenderingOptions) {
  const { data: bookmarks = [] } = useBookmarks(bookId);
  const [highlightPopup, setHighlightPopup] = useState<HighlightPopup | null>(null);
  const applyingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closePopup = useCallback(() => {
    setHighlightPopup(null);
  }, []);

  // Inject CSS styles into epub content
  useEffect(() => {
    if (!rendition || !enabled) return;

    const injectStyles = (contents: unknown) => {
      try {
        const c = contents as { document: Document };
        if (!c.document) return;

        const existing = c.document.getElementById('user-annotation-styles');
        if (existing) return;

        const style = c.document.createElement('style');
        style.id = 'user-annotation-styles';
        style.textContent = ANNOTATION_CSS;
        c.document.head.appendChild(style);
      } catch (err) {
        logger.error('[useAnnotationRendering] Failed to inject styles:', err);
      }
    };

    rendition.hooks.content.register(injectStyles);

    // Inject into already-rendered content
    const contents = rendition.getContents();
    contents.forEach(injectStyles);

    return () => {
      rendition.hooks.content.deregister(injectStyles);
    };
  }, [rendition, enabled]);

  // Click handler via event delegation on rendition
  useEffect(() => {
    if (!rendition || !enabled) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target?.classList?.contains('user-annotation')) return;

      const bookmarkId = target.getAttribute('data-bookmark-id');
      if (!bookmarkId) return;

      const bookmark = bookmarks.find((b) => b.id === bookmarkId);
      if (!bookmark) return;

      event.preventDefault();
      event.stopPropagation();

      try {
        const contents = rendition.getContents();
        if (!contents.length) return;

        const rect = target.getBoundingClientRect();
        const iframe = (contents[0] as { document: Document }).document.defaultView
          ?.frameElement as HTMLIFrameElement | null;
        const iframeRect = iframe?.getBoundingClientRect();

        setHighlightPopup({
          bookmarkId: bookmark.id,
          cfiRange: bookmark.cfi_range,
          note: bookmark.note,
          color: bookmark.color,
          text_color: bookmark.text_color,
          style: bookmark.style,
          position: {
            x: (iframeRect?.left || 0) + rect.left + rect.width / 2,
            y: (iframeRect?.top || 0) + rect.top,
          },
        });
      } catch (err) {
        logger.error('[useAnnotationRendering] Failed to show popup:', err);
      }
    };

    // Register click on all rendition contents
    const registerClick = (contents: unknown) => {
      const c = contents as { document: Document };
      c.document?.addEventListener('click', handleClick);
    };

    rendition.hooks.content.register(registerClick);
    rendition.getContents().forEach(registerClick);

    return () => {
      rendition.hooks.content.deregister(registerClick);
      try {
        const contents = rendition.getContents();
        contents.forEach((c: unknown) => {
          (c as { document: Document }).document?.removeEventListener('click', handleClick);
        });
      } catch {
        // Content may already be destroyed
      }
    };
  }, [rendition, enabled, bookmarks]);

  // Apply annotations function
  const applyAnnotations = useCallback(() => {
    if (!rendition || !enabled || applyingRef.current) return;

    const doc = getContentDocument(rendition);
    if (!doc?.body) return;

    const chapterBookmarks = bookmarks.filter(
      (b) => b.chapter_number === currentChapter && (b.style !== 'none' || b.color || b.text_color)
    );

    applyingRef.current = true;

    try {
      cleanupAnnotations(doc);

      if (!chapterBookmarks.length) return;

      for (const bookmark of chapterBookmarks) {
        try {
          // Try native getRange first, fallback for CFI path mismatches
          let range = rendition.getRange(bookmark.cfi_range);
          if (!range) {
            range = resolveRangeFallback(doc, bookmark.cfi_range);
          }
          if (!range) continue;

          wrapRangeWithSpan(doc, range, bookmark);
        } catch (err) {
          logger.error('[useAnnotationRendering] Failed to apply annotation:', bookmark.id, err);
        }
      }
    } finally {
      applyingRef.current = false;
    }
  }, [rendition, enabled, bookmarks, currentChapter]);

  // Debounced apply — waits for description/entity hooks to finish first
  const debouncedApply = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(applyAnnotations, 200);
  }, [applyAnnotations]);

  // Restore annotations when chapter renders or bookmarks change
  useEffect(() => {
    if (!rendition || !enabled) return;

    // Apply on initial render
    debouncedApply();

    // Re-apply on rendered event (chapter navigation)
    const handleRendered = () => {
      debouncedApply();
    };

    rendition.on('rendered', handleRendered as (...args: unknown[]) => void);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      rendition.off('rendered', handleRendered as (...args: unknown[]) => void);
    };
  }, [rendition, enabled, bookmarks, currentChapter, debouncedApply]);

  // Flash animation for navigate-to-note
  const flashAnnotation = useCallback(
    (bookmarkId: string) => {
      if (!rendition) return;
      const doc = getContentDocument(rendition);
      if (!doc) return;

      const spans = doc.querySelectorAll(`.user-annotation[data-bookmark-id="${bookmarkId}"]`);
      spans.forEach((span) => {
        span.classList.add('user-annotation-flash');
        setTimeout(() => span.classList.remove('user-annotation-flash'), 1500);
      });
    },
    [rendition]
  );

  return {
    highlightPopup,
    closePopup,
    flashAnnotation,
  };
}
