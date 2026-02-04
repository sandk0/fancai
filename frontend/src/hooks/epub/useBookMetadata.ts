/**
 * useBookMetadata - Fetches book metadata from EPUB
 *
 * Extracts and provides all available metadata from the EPUB file including:
 * - Title, creator (author)
 * - Description, publisher, publication date
 * - Language, rights (copyright)
 * - Cover image (if available)
 *
 * @module hooks/epub/useBookMetadata
 */

import { useState, useEffect } from 'react';
import type { Book } from '@/types/epub';
import { logger } from '@/lib/logger';

/**
 * Book metadata interface
 */
export interface BookMetadata {
  title: string;
  creator: string; // Author
  description?: string;
  publisher?: string;
  language?: string;
  rights?: string; // Copyright
  pubdate?: string; // Publication date
}

/**
 * Hook return type
 */
interface UseBookMetadataReturn {
  metadata: BookMetadata | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Custom hook to fetch and manage EPUB book metadata
 *
 * @param book - EPUB.js Book instance
 * @returns Object containing metadata, loading state, and error
 *
 * @example
 * ```tsx
 * const { metadata, isLoading } = useBookMetadata(epubBook);
 *
 * if (metadata) {
 *   logger.debug(`Reading: ${metadata.title} by ${metadata.creator}`);
 * }
 * ```
 */
export const useBookMetadata = (book: Book | null): UseBookMetadataReturn => {
  const [metadata, setMetadata] = useState<BookMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!book) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const loadMetadata = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Wait for metadata to be loaded
        await book.loaded.metadata;

        if (!isMounted) return;

        // Extract metadata from packaging
        const meta = book.packaging.metadata;

        setMetadata({
          title: meta.title || 'Untitled',
          creator: meta.creator || 'Unknown Author',
          description: meta.description,
          publisher: meta.publisher,
          language: meta.language,
          rights: meta.rights,
          pubdate: meta.pubdate,
        });

        setIsLoading(false);
      } catch (err) {
        logger.error('[useBookMetadata] Error loading metadata:', err);

        if (!isMounted) return;

        setError(err instanceof Error ? err.message : 'Failed to load metadata');
        setMetadata({
          title: 'Untitled',
          creator: 'Unknown Author',
        });
        setIsLoading(false);
      }
    };

    loadMetadata();

    return () => {
      isMounted = false;
    };
  }, [book]);

  return { metadata, isLoading, error };
};
