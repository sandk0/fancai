import { useCallback } from 'react';
import type { Rendition, Book } from '@/types/epub';

interface UseCFIGeneratorOptions {
  rendition: Rendition | null;
  book: Book | null;
}

interface UseCFIGeneratorReturn {
  findTextCFI: (text: string, chapterIndex?: number) => string | null;
}

const normalizeText = (text: string): string => {
  return text
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[«»""]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .trim();
};

export const useCFIGenerator = ({
  rendition,
  book,
}: UseCFIGeneratorOptions): UseCFIGeneratorReturn => {

  const findTextCFI = useCallback((searchText: string, _chapterIndex?: number): string | null => {
    if (!rendition || !searchText || searchText.length < 3) {
      return null;
    }

    try {
      const contents = rendition.getContents();
      if (!contents || contents.length === 0) {
        return null;
      }

      const content = contents[0];
      const doc = content.document;

      if (!doc || !doc.body) {
        return null;
      }

      const normalizedSearch = normalizeText(searchText);
      const searchPattern = normalizedSearch.substring(0, Math.min(40, normalizedSearch.length));

      const walker = doc.createTreeWalker(
        doc.body,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node: Node | null;
      while ((node = walker.nextNode())) {
        const nodeText = node.nodeValue || '';
        const normalizedNodeText = normalizeText(nodeText);

        const index = normalizedNodeText.toLowerCase().indexOf(searchPattern.toLowerCase());
        if (index !== -1) {
          const range = doc.createRange();
          range.setStart(node, index);
          range.setEnd(node, Math.min(index + searchPattern.length, nodeText.length));

          const location = rendition.currentLocation();
          if (location && location.start?.cfi) {
            return location.start.cfi;
          }

          if (book?.spine) {
            const spineItem = book.spine.get(0);
            if (spineItem) {
              return `epubcfi(/6/${(spineItem.index + 1) * 2}!)`;
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error('[useCFIGenerator] Error finding text CFI:', error);
      return null;
    }
  }, [rendition, book]);

  return { findTextCFI };
};
