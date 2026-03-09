/**
 * BookReader - Refactored book reading component
 *
 * Reduced from 1,037 lines to ~200 lines by extracting logic into custom hooks and sub-components.
 *
 * Features:
 * - Paginated text reading with HTML support
 * - Reading progress tracking and restoration
 * - Description highlighting with image modals
 * - Auto-parsing for books without descriptions
 * - Customizable font size and theme
 * - Keyboard navigation support
 *
 * @component
 */

import React, { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { booksAPI } from '@/api/books';
import { useReaderStore } from '@/stores/reader';
import { useTranslation } from 'react-i18next';
import type { BookDetail, Description } from '@/types/api';

// Import custom hooks
import {
  usePagination,
  useReadingProgress,
  useAutoParser,
  useDescriptionManagement,
  useChapterNavigation,
  useKeyboardNavigation,
  useReaderImageModal,
} from '@/hooks/reader';

// Import sub-components
import { ReaderHeader } from './ReaderHeader';
import { ReaderSettingsPanel } from './ReaderSettingsPanel';
import { ReaderContent } from './ReaderContent';
import { ReaderNavigationControls } from './ReaderNavigationControls';
import { ImageModal } from '@/components/Images/ImageModal';

// Import UI components
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import ErrorMessage from '@/components/UI/ErrorMessage';
import { STORAGE_KEYS } from '@/types/state';
import { logger } from '@/lib/logger';

interface BookReaderProps {
  bookId?: string;
  chapterNumber?: number;
}

export const BookReader: React.FC<BookReaderProps> = ({
  bookId: propBookId,
  chapterNumber: propChapterNumber,
}) => {
  const { t } = useTranslation();
  const params = useParams();
  const bookId = propBookId || params.bookId!;
  const initialChapter = propChapterNumber || parseInt(params.chapterNumber || '1');

  // Local state
  const [currentChapter, setCurrentChapter] = useState(initialChapter);
  const [showSettings, setShowSettings] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const isFirstMount = useRef(true);

  // Reader settings from store
  const {
    fontSize,
    fontFamily,
    lineHeight,
    theme,
    maxWidth,
    margin,
    updateFontSize,
    updateFontFamily,
    updateLineHeight,
    updateTheme,
    updateMaxWidth,
    updateMargin,
    resetSettings,
  } = useReaderStore();

  // Fetch book data
  const { data: book, isLoading: bookLoading } = useQuery<BookDetail>({
    queryKey: ['book', bookId],
    queryFn: () => booksAPI.getBook(bookId),
  });

  // Fetch chapter data
  const {
    data: chapter,
    isLoading: chapterLoading,
    error: chapterError,
    refetch,
  } = useQuery({
    queryKey: ['chapter', bookId, currentChapter],
    queryFn: () => booksAPI.getChapter(bookId, currentChapter),
    enabled: !!bookId,
  });

  // Hook 1: Pagination
  const { pages, currentPage, setCurrentPage } = usePagination(chapter, contentRef, {
    fontSize,
    lineHeight,
  });

  // Hook 2: Reading progress
  const { hasRestoredPosition } = useReadingProgress({
    bookId,
    currentChapter,
    currentPage,
    totalPages: pages.length,
    initialChapter,
    onPositionRestored: (_chapter, page) => {
      setCurrentPage(page);
    },
  });

  // Hook 3: Auto-parser
  useAutoParser(bookId, chapter, refetch);

  // Hook 4: Image modal
  const {
    selectedImage,
    isOpen: isModalOpen,
    openModal,
    closeModal,
    updateImageUrl,
  } = useReaderImageModal();

  // Hook 5: Description management
  const {
    highlightedDescriptions,
    setHighlightedDescriptions,
    highlightDescription,
    handleDescriptionClick,
  } = useDescriptionManagement({
    descriptions: chapter?.descriptions || [],
    onImageGenerated: (description, imageUrl, imageId) => {
      openModal(description, imageUrl, imageId);
    },
  });

  // Hook 6: Chapter navigation
  const { nextPage, prevPage, jumpToChapter, canGoNext, canGoPrev } = useChapterNavigation({
    currentChapter,
    setCurrentChapter,
    currentPage,
    setCurrentPage,
    totalPages: pages.length,
    totalChapters: book?.chapters?.length || book?.chapters_count || 0,
  });

  // Hook 7: Keyboard navigation
  useKeyboardNavigation({ onNext: nextPage, onPrev: prevPage });

  /**
   * Update highlighted descriptions when chapter data changes
   */
  useEffect(() => {
    if (!chapter) return;

    let descriptions: Description[] = [];

    if (chapter.descriptions && Array.isArray(chapter.descriptions)) {
      descriptions = chapter.descriptions;
    } else if (chapter.chapter?.descriptions && Array.isArray(chapter.chapter.descriptions)) {
      descriptions = chapter.chapter.descriptions;
    }

    setHighlightedDescriptions(descriptions);
  }, [chapter, setHighlightedDescriptions]);

  /**
   * Reset to first page when chapter changes (skip first mount)
   */
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    setCurrentPage(1);

    // Save progress for chapter change
    if (book && hasRestoredPosition) {
      booksAPI
        .updateReadingProgress(bookId, {
          current_chapter: currentChapter,
          current_position_percent: 0,
        })
        .catch((err) => {
          logger.error('[BookReader] Failed to update progress:', err);
        });
    }
  }, [currentChapter, book, bookId, hasRestoredPosition, setCurrentPage]);

  /**
   * Add click listener for description highlights
   */
  useEffect(() => {
    const handleClick = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('description-highlight')) {
        const descriptionId = target.dataset.descriptionId;
        if (descriptionId) {
          handleDescriptionClick(descriptionId);
        }
      }
    };

    const container = contentRef.current;
    if (container) {
      container.addEventListener('click', handleClick);
      return () => container.removeEventListener('click', handleClick);
    }
  }, [handleDescriptionClick]);

  /**
   * Handle image regeneration
   */
  const handleImageRegenerated = (newImageUrl: string) => {
    updateImageUrl(newImageUrl);

    // Update highlighted descriptions
    if (selectedImage?.description) {
      const updatedDescriptions = highlightedDescriptions.map((d) => {
        if (d.id === selectedImage.description!.id && d.generated_image) {
          return {
            ...d,
            generated_image: {
              ...d.generated_image,
              image_url: newImageUrl,
            },
          };
        }
        return d;
      });

      setHighlightedDescriptions(updatedDescriptions);
    }
  };

  // Loading state
  if (bookLoading || chapterLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" text={t('reader.loadingChapter')} />
      </div>
    );
  }

  // Error states
  if (chapterError || !book || !chapter) {
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (!token) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <ErrorMessage
            title={t('reader.authRequired')}
            message={t('reader.authRequiredDesc')}
            action={{
              label: t('reader.goToLogin'),
              onClick: () => (window.location.href = '/login'),
            }}
          />
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center min-h-screen">
        <ErrorMessage
          title={t('reader.chapterNotFound')}
          message={t('reader.chapterNotFoundDesc')}
          action={{ label: t('reader.goBack'), onClick: () => window.history.back() }}
        />
      </div>
    );
  }

  // Main render
  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'dark' : ''}`}>
      {/* Description highlight styles */}
      <style>{`
        .description-highlight {
          background-color: rgba(59, 130, 246, 0.1);
          border-bottom: 2px solid rgba(59, 130, 246, 0.3);
          padding: 2px 4px;
          margin: 0 1px;
          border-radius: 3px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .description-highlight:hover {
          background-color: rgba(59, 130, 246, 0.2);
          border-bottom-color: rgba(59, 130, 246, 0.6);
          transform: translateY(-1px);
        }
        .dark .description-highlight {
          background-color: rgba(59, 130, 246, 0.15);
          border-bottom-color: rgba(59, 130, 246, 0.4);
        }
        .dark .description-highlight:hover {
          background-color: rgba(59, 130, 246, 0.25);
          border-bottom-color: rgba(59, 130, 246, 0.7);
        }
      `}</style>

      <div className="bg-background min-h-screen">
        {/* Header */}
        <ReaderHeader
          isVisible={true}
          title={book.title}
          author={book.author}
          progress={book.reading_progress?.progress_percent || 0}
          currentPage={currentPage}
          totalPages={pages.length}
          onBack={() => window.history.back()}
          onTocToggle={() => {}}
          onInfoOpen={() => {}}
          onSettingsOpen={() => setShowSettings(!showSettings)}
          onEntitiesOpen={() => {}}
          onSearchToggle={() => {}}
        />

        {/* Settings Panel */}
        <ReaderSettingsPanel
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          theme={theme}
          maxWidth={maxWidth}
          margin={margin}
          onFontSizeChange={updateFontSize}
          onFontFamilyChange={updateFontFamily}
          onLineHeightChange={updateLineHeight}
          onThemeChange={updateTheme}
          onMaxWidthChange={updateMaxWidth}
          onMarginChange={updateMargin}
          onReset={resetSettings}
        />

        {/* Reading Area */}
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="relative">
            {/* Content */}
            <ReaderContent
              pages={pages}
              currentPage={currentPage}
              currentChapter={currentChapter}
              highlightedDescriptions={highlightedDescriptions}
              highlightDescription={highlightDescription}
              fontSize={fontSize}
              fontFamily={fontFamily}
              lineHeight={lineHeight}
              contentRef={contentRef}
            />

            {/* Navigation Controls */}
            <ReaderNavigationControls
              book={book}
              currentChapter={currentChapter}
              currentPage={currentPage}
              totalPages={pages.length}
              canGoPrev={canGoPrev}
              canGoNext={canGoNext}
              onPrevPage={prevPage}
              onNextPage={nextPage}
              onJumpToChapter={jumpToChapter}
            />
          </div>
        </div>

        {/* Keyboard Navigation Hint */}
        <div className="fixed bottom-4 right-4 text-xs text-muted-foreground bg-card px-3 py-2 rounded-lg shadow-xs border border-border">
          {t('reader.navigationHint')}
        </div>

        {/* Image Modal */}
        <AnimatePresence>
          {isModalOpen && selectedImage && (
            <ImageModal
              imageUrl={selectedImage.imageUrl}
              isOpen={isModalOpen}
              onClose={closeModal}
              title={selectedImage.description?.type || t('reader.generatedImage')}
              description={selectedImage.description?.content}
              imageId={selectedImage.imageId || undefined}
              descriptionData={selectedImage.description || undefined}
              onImageRegenerated={handleImageRegenerated}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
