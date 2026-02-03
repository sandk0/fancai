/**
 * ReaderContent - Book content display component
 *
 * Renders paginated book content with description highlighting.
 * Handles HTML sanitization and animations.
 *
 * @component
 */

import React from 'react';
import { m } from 'framer-motion';
import DOMPurify from 'dompurify';
import type { Description } from '@/types/api';

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'span', 'div', 'br', 'strong', 'em', 'b', 'i', 'u', 's',
    'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'figure', 'figcaption', 'sup', 'sub', 'hr',
  ],
  ALLOWED_ATTR: [
    'class', 'id', 'href', 'src', 'alt', 'title', 'target', 'rel',
    'data-description-id', 'data-description-type', 'data-entity-id',
    'width', 'height', 'colspan', 'rowspan',
  ],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button', 'style', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onsubmit', 'onchange', 'onkeydown', 'onkeyup'],
  ALLOW_DATA_ATTR: false,
} satisfies Partial<DOMPurify.Config>;

interface ReaderContentProps {
  pages: string[];
  currentPage: number;
  currentChapter: number;
  highlightedDescriptions: Description[];
  highlightDescription: (text: string, descriptions: Description[]) => string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export const ReaderContent: React.FC<ReaderContentProps> = React.memo(({
  pages,
  currentPage,
  currentChapter,
  highlightedDescriptions,
  highlightDescription,
  fontSize,
  fontFamily,
  lineHeight,
  contentRef,
}) => {
  const pageContent = pages[currentPage - 1];

  const highlightedHtml = React.useMemo(() => {
    if (!pageContent) return '';

    let content = pageContent;
    if (highlightedDescriptions.length > 0) {
      content = highlightDescription(pageContent, highlightedDescriptions);
    }

    return DOMPurify.sanitize(content, PURIFY_CONFIG);
  }, [pageContent, highlightedDescriptions, highlightDescription]);

  return (
    <m.div
      ref={contentRef}
      className="prose prose-lg dark:prose-invert max-w-none"
      style={{
        fontSize: `${fontSize}px`,
        fontFamily: fontFamily,
        lineHeight: lineHeight,
        minHeight: '60vh',
      }}
      key={`${currentChapter}-${currentPage}`}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div
        dangerouslySetInnerHTML={{
          __html: highlightedHtml
        }}
        className="select-text epub-content"
      />
    </m.div>
  );
});

ReaderContent.displayName = 'ReaderContent';
