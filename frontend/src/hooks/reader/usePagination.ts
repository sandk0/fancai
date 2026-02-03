/**
 * usePagination - Custom hook for content pagination
 *
 * Handles splitting chapter content into pages based on container size and font settings.
 * Supports both HTML and plain text content.
 *
 * @param chapter - Chapter data with content
 * @param containerRef - Reference to container element
 * @param fontSize - Current font size in pixels
 * @param lineHeight - Line height multiplier
 * @returns Pagination state and pages array
 *
 * @example
 * const { pages, currentPage, setCurrentPage } = usePagination(
 *   chapter,
 *   contentRef,
 *   18,
 *   1.6
 * );
 */

import { useState, useEffect } from 'react';
import { logger } from '@/lib/logger';

interface PaginationOptions {
  fontSize: number;
  lineHeight: number;
}

interface UsePaginationReturn {
  pages: string[];
  currentPage: number;
  totalPages: number;
  setCurrentPage: (page: number) => void;
  goToPage: (page: number) => void;
}

export const usePagination = (
  chapter: unknown,
  containerRef: React.RefObject<HTMLDivElement | null>,
  { fontSize, lineHeight }: PaginationOptions
): UsePaginationReturn => {
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const chapterData = chapter as Record<string, unknown> | null;
    const nestedChapter = chapterData?.chapter as Record<string, unknown> | undefined;
    if (!nestedChapter?.content) return;

    const paginateContent = () => {
      const content = (nestedChapter.html_content as string) || (nestedChapter.content as string);
      if (!content) {
        setPages(['']);
        return;
      }

      // Calculate pagination parameters
      const container = containerRef.current;
      const containerHeight = container?.clientHeight || 600;
      const containerWidth = container?.clientWidth || 800;

      const lineHeightPx = fontSize * lineHeight;
      const linesPerPage = Math.max(15, Math.floor((containerHeight - 120) / lineHeightPx));
      const charsPerLine = Math.max(40, Math.floor(containerWidth / (fontSize * 0.55)));
      const charsPerPage = Math.max(800, Math.min(4000, linesPerPage * charsPerLine));

      logger.debug(`[usePagination] Params: lines=${linesPerPage}, chars/line=${charsPerLine}, chars/page=${charsPerPage}`);

      // Calculate total pages needed
      const textLength = content.replace(/<[^>]*>/g, '').length;
      const totalPages = Math.max(1, Math.ceil(textLength / charsPerPage));

      logger.debug(`[usePagination] Content: ${textLength} chars, ${totalPages} pages`);

      const newPages: string[] = [];

      if (totalPages === 1) {
        newPages.push(content);
      } else {
        // Split content
        if (content.includes('<')) {
          // HTML content - split at paragraph boundaries
          const paragraphs = content.split(/<\/p>|<\/div>|<br\s*\/?>/i).filter((p: string) => p.trim());

          let currentPageContent = '';
          let currentLength = 0;

          for (const paragraph of paragraphs) {
            const paragraphText = paragraph.replace(/<[^>]*>/g, '');
            const paragraphLength = paragraphText.length;

            if (currentLength + paragraphLength > charsPerPage && currentPageContent) {
              newPages.push(currentPageContent);
              currentPageContent = paragraph;
              currentLength = paragraphLength;
            } else {
              currentPageContent += (currentPageContent ? '</p>' : '') + paragraph;
              currentLength += paragraphLength;
            }
          }

          if (currentPageContent) {
            newPages.push(currentPageContent);
          }
        } else {
          // Plain text - character-based splitting
          for (let i = 0; i < content.length; i += charsPerPage) {
            const pageContent = content.substring(i, Math.min(i + charsPerPage, content.length));
            newPages.push(pageContent);
          }
        }
      }

      // Ensure at least one page
      if (newPages.length === 0) {
        newPages.push(content);
      }

      logger.debug(`[usePagination] Final: ${newPages.length} pages created`);
      setPages(newPages);
    };

    // Debounce pagination
    const timeoutId = setTimeout(paginateContent, 200);
    return () => clearTimeout(timeoutId);
  }, [chapter, fontSize, lineHeight, containerRef]);

  const goToPage = (page: number) => {
    if (page >= 1 && page <= pages.length) {
      setCurrentPage(page);
    }
  };

  return {
    pages,
    currentPage,
    totalPages: pages.length,
    setCurrentPage,
    goToPage,
  };
};
