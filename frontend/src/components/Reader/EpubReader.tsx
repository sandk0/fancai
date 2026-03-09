import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { booksAPI } from '@/api/books';
import { STORAGE_KEYS } from '@/types/state';
import type { BookDetail } from '@/types/api';
import {
  useEpubLoader,
  useLocationGeneration,
  useCFITracking,
  useProgressSync,
  useEpubNavigation,
  useKeyboardNavigation,
  useChapterManagement,
  useChapterMapping,
  useDescriptionHighlighting,
  useImageModal,
  useEpubThemes,
  useContentHooks,
  useResizeHandler,
  useBookMetadata,
  useTextSelection,
  useToc,
} from '@/hooks/epub';
import { useGestureController } from '@/hooks/epub/useGestureController';
import { useRenditionHealthGuard } from '@/hooks/epub/useRenditionHealthGuard';
import { useBookmarkActions } from '@/hooks/epub/useBookmarks';
import { useAnnotationRendering } from '@/hooks/epub/useAnnotationRendering';
import { useReaderStore } from '@/stores/reader';
import { useAutoHideUI } from '@/hooks/reader/useAutoHideUI';
import { useReaderPosition } from '@/hooks/reader/useReaderPosition';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useReadingSession } from '@/hooks/useReadingSession';
import { notify } from '@/stores/ui';
import { useEntityNetwork, usePrefetchEntityNetwork } from '@/hooks/useEntityNetwork';
import { getCurrentUserId } from '@/hooks/api/queryKeys';
import { mapApiError } from '@/utils/errorMessages';

import { ReaderModals } from './Core/ReaderModals';
import { ReaderOverlays } from './Core/ReaderOverlays';
import { ReaderUI } from './Core/ReaderUI';
import { FollowFingerContainer } from './FollowFingerContainer';
import { ExtractionIndicator } from './ExtractionIndicator';
import { SearchPanel } from './SearchPanel';
import { EntityPopup } from './EntityPopup';
import { useEntityNameHighlighting } from '@/hooks/epub/useEntityNameHighlighting';
import { useNavigationLock } from '@/hooks/shared/useNavigationLock';
import { logger } from '@/lib/logger';

const WAKE_LOCK_STORAGE_KEY = `${STORAGE_KEYS.READER_SETTINGS}_wake_lock`;

interface EpubReaderProps {
  book: BookDetail;
}

export const EpubReader: React.FC<EpubReaderProps> = ({ book }) => {
  const { t } = useTranslation();
  const viewerRef = useRef<HTMLDivElement>(null);
  const [renditionReady, setRenditionReady] = useState(false);
  const navigate = useNavigate();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isEntityDrawerOpen, setIsEntityDrawerOpen] = useState(false);
  const [isBookInfoOpen, setIsBookInfoOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(
    () => localStorage.getItem(`${STORAGE_KEYS.READER_SETTINGS}_toc_open`) === 'true'
  );
  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEYS.READER_SETTINGS}_toc_open`, String(isTocOpen));
  }, [isTocOpen]);
  const { navigationMode, updateNavigationMode } = useReaderStore();
  const [wakeLockEnabled, setWakeLockEnabled] = useState(
    () => localStorage.getItem(WAKE_LOCK_STORAGE_KEY) !== 'false'
  );
  const {
    request: requestWakeLock,
    release: releaseWakeLock,
    isActive: isWakeLockActive,
    isSupported: isWakeLockSupported,
  } = useWakeLock();

  const authToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  const userId = getCurrentUserId();

  const {
    book: epubBook,
    rendition,
    isLoading,
    error,
    reload,
  } = useEpubLoader({
    bookUrl: booksAPI.getBookFileUrl(book.id),
    viewerRef,
    authToken,
    bookId: book.id,
    userId: userId || undefined,
    onReady: () => requestAnimationFrame(() => setRenditionReady(true)),
  });

  const { locations, isGenerating } = useLocationGeneration(epubBook, book.id);
  const {
    currentCFI,
    progress,
    scrollOffsetPercent,
    currentPage,
    totalPages,
    goToCFI,
    skipNextRelocated,
    setInitialProgress,
  } = useCFITracking({
    rendition,
    locations,
    book: epubBook,
  });

  const { toc, currentHref, setCurrentHref } = useToc(epubBook);
  const { getChapterNumberByLocation } = useChapterMapping(toc, book.chapters || [], epubBook);

  const { isRestoringPosition, positionConflict, resolveConflict } = useReaderPosition({
    rendition,
    renditionReady,
    bookId: book.id,
    locations,
    goToCFI,
    skipNextRelocated,
    setInitialProgress,
  });

  const {
    currentChapter,
    descriptions,
    images,
    isLoadingChapter,
    descriptionError,
    refetchDescriptions,
  } = useChapterManagement({
    book: epubBook,
    rendition,
    bookId: book.id,
    getChapterNumberByLocation,
    isRestoringPosition,
  });

  // Debounce isLoadingChapter — only show extraction indicator after 2s
  // (fast cache/API fetches won't flash the "AI analyzing" UI)
  const [showExtractionIndicator, setShowExtractionIndicator] = useState(false);
  useEffect(() => {
    if (!isLoadingChapter) {
      setShowExtractionIndicator(false);
      return;
    }
    const timer = setTimeout(() => setShowExtractionIndicator(true), 2000);
    return () => clearTimeout(timer);
  }, [isLoadingChapter]);

  // Extraction retry state
  const [extractionRetryCount, setExtractionRetryCount] = useState(0);
  const MAX_EXTRACTION_RETRIES = 3;

  const handleExtractionRetry = useCallback(() => {
    if (extractionRetryCount < MAX_EXTRACTION_RETRIES) {
      setExtractionRetryCount((prev) => prev + 1);
      refetchDescriptions();
    }
  }, [extractionRetryCount, refetchDescriptions]);

  // Reset retry count on chapter change
  useEffect(() => {
    setExtractionRetryCount(0);
  }, [currentChapter]);

  // max_chapter_reached приходит с сервера (монотонно возрастающее значение)
  // Дополнительно берём max с currentChapter на случай задержки синхронизации
  const maxChapterReached = useMemo(() => {
    const serverMax = book.reading_progress?.max_chapter_reached || 1;
    return Math.max(currentChapter, serverMax);
  }, [currentChapter, book.reading_progress?.max_chapter_reached]);

  const { isSaving, lastSaved } = useProgressSync({
    bookId: book.id,
    currentCFI,
    progress,
    scrollOffset: scrollOffsetPercent,
    currentChapter,
    onSave: async (cfi, prog, scroll, ch) => {
      await booksAPI.updateReadingProgress(book.id, {
        current_chapter: ch,
        current_position_percent: prog,
        reading_location_cfi: cfi,
        scroll_offset_percent: scroll,
      });
    },
    enabled: renditionReady,
    isRestoringPosition, // Prevent save during restoration
  });

  const { nextPage, prevPage } = useEpubNavigation(rendition);
  const navLock = useNavigationLock({ maxLockDuration: 2000 });
  const {
    selectedImage,
    isOpen: isModalOpen,
    openModal,
    closeModal,
    updateImage,
    generationStatus,
    generationError,
    descriptionPreview,
    cancelGeneration,
  } = useImageModal({ bookId: book.id });

  const hasActiveOperations = isGenerating;
  const {
    isHealthy: isRenditionHealthy,
    isChecking: isCheckingHealth,
    markHealthy,
  } = useRenditionHealthGuard({
    rendition,
    bookId: book.id,
    enabled: renditionReady && !!rendition,
    isStable: renditionReady && !isLoading && !isRestoringPosition,
    hasActiveOperations,
    isRestoringPosition,
  });

  useEffect(() => {
    if (renditionReady && isRenditionHealthy && !isCheckingHealth) markHealthy();
  }, [renditionReady, isRenditionHealthy, isCheckingHealth, markHealthy]);

  // Description click and center-tap handlers (needed before gesture controller)
  const handleDescriptionClick = useCallback(
    async (id: string) => {
      const d = descriptions.find((x) => x.id === id);
      if (d)
        await openModal(
          d,
          images.find((x) => x.description_id === id)
        );
    },
    [descriptions, images, openModal]
  );

  const handleCenterTap = useCallback(
    async (x: number, y: number) => {
      if (!rendition) return;
      try {
        const contents = rendition.getContents();
        if (!contents?.length) return;
        const doc = contents[0].document;
        if (!doc) return;
        let target = doc.elementFromPoint(x, y) as HTMLElement | null;
        while (target && target !== doc.body) {
          if (target.classList?.contains('description-highlight')) {
            const id = target.getAttribute('data-description-id');
            if (id) handleDescriptionClick(id);
            break;
          }
          target = target.parentElement;
        }
      } catch (err) {
        logger.error(err);
      }
    },
    [rendition, handleDescriptionClick]
  );

  // Auto-hide UI: immersive mode (header hidden by default)
  const autoHide = useAutoHideUI({ initialVisible: false });

  // Compute isPanelOpen for gesture blocking
  const isPanelOpen =
    isTocOpen || isSettingsOpen || isEntityDrawerOpen || isSearchOpen || isBookInfoOpen;

  // Unified gesture controller replaces useFollowFingerSwipe + useTouchNavigation + IOSTapZones
  const gestureController = useGestureController({
    rendition,
    enabled: renditionReady && !isModalOpen,
    onNavigate: async (dir) => {
      if (dir === 'next') await nextPage();
      else await prevPage();
    },
    onChapterChange: async (dir) => {
      if (dir === 'next') await rendition?.next();
      else await rendition?.prev();
    },
    onEdgeTap: (dir) => {
      // Edge tap: navigate with navLock (slide animation handled by controller)
      if (navLock.acquire()) {
        (dir === 'next' ? nextPage() : prevPage()).finally(() => navLock.release());
      }
    },
    onCenterTap: handleCenterTap,
    onToggleUI: autoHide.toggleUI,
    onSwipeStart: autoHide.onSwipeStart,
    onTapNavigate: autoHide.onTapNavigate,
    navLock,
    isPanelOpen,
  });

  useKeyboardNavigation({
    onNext: nextPage,
    onPrev: prevPage,
    enabled: renditionReady && !isModalOpen,
    rendition,
  });

  const { theme, fontSize, setTheme, increaseFontSize, decreaseFontSize } =
    useEpubThemes(rendition);
  useContentHooks(rendition, theme);

  useDescriptionHighlighting({
    rendition,
    descriptions,
    images,
    onDescriptionClick: async (d, i) => await openModal(d, i),
    enabled: renditionReady,
  });

  useResizeHandler({ rendition, enabled: renditionReady, onResized: () => {} });
  const { metadata: bookMetadata } = useBookMetadata(epubBook);
  const { selection, clearSelection } = useTextSelection(rendition, renditionReady && !isModalOpen);
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useReadingSession({
    bookId: book.id,
    currentPosition: progress,
    enabled: renditionReady && !isGenerating,
    onSessionEnd: (s) =>
      notify.success(
        t('reader.notification.session_complete'),
        t('reader.notification.session_stats', { minutes: s.duration_minutes, pages: s.pages_read })
      ),
  });

  // Unified bookmark hooks
  const { bookmarks, createBookmark, updateBookmark, deleteBookmark } = useBookmarkActions({
    bookId: book.id,
    currentChapter,
  });

  const { flashAnnotation } = useAnnotationRendering({
    rendition,
    bookId: book.id,
    currentChapter,
    enabled: renditionReady,
  });

  const handleBookmark = useCallback(
    (opts: {
      color?: string | null;
      style?: string;
      note?: string;
      text_color?: string | null;
    }) => {
      if (!selection) return;
      createBookmark(
        selection.cfiRange,
        selection.text,
        opts.color ?? undefined,
        opts.style,
        opts.note,
        opts.text_color
      );
      clearSelection();
    },
    [selection, createBookmark, clearSelection]
  );

  const handleNavigateToCfi = useCallback(
    async (cfi: string, bookmarkId?: string) => {
      if (!rendition) return;
      try {
        await rendition.display(cfi);
        if (bookmarkId) {
          const onRendered = () => {
            setTimeout(() => flashAnnotation(bookmarkId), 350);
            rendition.off('rendered', onRendered as (...args: unknown[]) => void);
          };
          rendition.on('rendered', onRendered as (...args: unknown[]) => void);
        }
      } catch (err) {
        logger.error('[EpubReader] Failed to navigate to CFI:', err);
      }
    },
    [rendition, flashAnnotation]
  );

  const handleUpdateBookmarkNote = useCallback(
    (bookmarkId: string, note: string) => {
      updateBookmark(bookmarkId, { note });
    },
    [updateBookmark]
  );

  const [popupEntity, setPopupEntity] = useState<import('@/types/entity').EntityDetail | null>(
    null
  );
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [drawerInitialEntityId, setDrawerInitialEntityId] = useState<string | null>(null);
  const { data: entityNetwork, isLoading: isEntityNetworkLoading } = useEntityNetwork(
    book.id,
    maxChapterReached
  );
  const prefetchEntityNetwork = usePrefetchEntityNetwork();
  useEffect(() => {
    if (book.id) prefetchEntityNetwork(book.id);
  }, [book.id, prefetchEntityNetwork]);

  const { nameHighlightingEnabled, updateNameHighlighting } = useReaderStore();

  const handleEntityClick = useCallback(
    (entity: import('@/types/entity').EntityDetail, position: { x: number; y: number }) => {
      setPopupEntity(entity);
      setPopupPosition(position);
    },
    []
  );

  const entityList = useMemo(() => {
    if (!entityNetwork?.entities) return [];
    return Object.values(entityNetwork.entities);
  }, [entityNetwork?.entities]);

  useEntityNameHighlighting({
    rendition,
    entities: entityList,
    currentChapter,
    currentCFI,
    enabled: renditionReady && nameHighlightingEnabled,
    onEntityClick: handleEntityClick,
  });

  const handleEntityPopupOpenDrawer = useCallback((entityId: string) => {
    setDrawerInitialEntityId(entityId);
    setIsEntityDrawerOpen(true);
    setPopupEntity(null);
    setPopupPosition(null);
  }, []);

  const handleEntityPopupClose = useCallback(() => {
    setPopupEntity(null);
    setPopupPosition(null);
  }, []);

  const handleEntitiesOpen = useCallback(() => {
    setDrawerInitialEntityId(null);
    setIsEntityDrawerOpen(true);
  }, []);

  useEffect(() => {
    if (!isWakeLockSupported) return;
    if (wakeLockEnabled && renditionReady && !isRestoringPosition) requestWakeLock();
    else releaseWakeLock();
    return () => {
      releaseWakeLock();
    };
  }, [
    wakeLockEnabled,
    renditionReady,
    isRestoringPosition,
    isWakeLockSupported,
    requestWakeLock,
    releaseWakeLock,
  ]);

  const handleWakeLockToggle = useCallback((e: boolean) => {
    setWakeLockEnabled(e);
    localStorage.setItem(WAKE_LOCK_STORAGE_KEY, String(e));
  }, []);

  useEffect(() => {
    if (currentCFI && selectionRef.current) clearSelection();
  }, [currentCFI, clearSelection]);

  const handleTocChapterClick = useCallback(
    async (href: string) => {
      if (!rendition) return;
      try {
        await rendition.display(href);
        setCurrentHref(href);
      } catch (err) {
        logger.error(err);
      }
    },
    [rendition, setCurrentHref]
  );

  const handleCopy = useCallback(async () => {
    if (!selection?.text) return;
    try {
      await navigator.clipboard.writeText(selection.text);
      notify.success(t('reader.notification.copied'));
      clearSelection();
    } catch (err) {
      logger.error(err);
    }
  }, [selection, clearSelection, t]);

  const handleImageRegenerated = useCallback((url: string) => updateImage(url), [updateImage]);
  const handleUseServerPosition = useCallback(() => resolveConflict('server'), [resolveConflict]);
  const handleUseLocalPosition = useCallback(() => resolveConflict('local'), [resolveConflict]);

  const backgroundColor = useMemo(() => {
    if (theme === 'sepia') return 'bg-[#FBF0D9]';
    if (theme === 'dark') return 'bg-[#121212]';
    if (theme === 'night') return 'bg-black';
    return 'bg-white';
  }, [theme]);

  return (
    <div className={`relative h-full w-full transition-colors ${backgroundColor}`}>
      <FollowFingerContainer
        translateX={gestureController.translateX}
        phase={gestureController.phase}
        isAtBoundary={gestureController.isAtBoundary}
        showChapterHint={gestureController.showChapterHint}
        chapterHintDirection={gestureController.chapterHintDirection}
      >
        <div
          ref={viewerRef}
          id="epub-viewer"
          tabIndex={-1}
          className={`h-full w-full ${backgroundColor} outline-hidden`}
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            touchAction: 'pan-x pan-y',
          }}
        />
      </FollowFingerContainer>

      <ReaderOverlays
        loading={{
          isLoading,
          isGenerating,
          isRestoringPosition,
          isCheckingHealth,
          isRenditionHealthy,
          renditionReady,
        }}
        error={{
          message: error,
          readableMessage: error ? mapApiError(error).message : '',
          isRetryable: error ? mapApiError(error).isRetryable : true,
          onRetry: reload,
          onHome: () => navigate('/library'),
        }}
        backgroundColor={backgroundColor}
      />

      <ExtractionIndicator
        isExtracting={showExtractionIndicator}
        extractionError={descriptionError ? mapApiError(descriptionError).message : null}
        retryCount={extractionRetryCount}
        maxRetries={MAX_EXTRACTION_RETRIES}
        onRetry={
          descriptionError && mapApiError(descriptionError).isRetryable
            ? handleExtractionRetry
            : undefined
        }
      />

      <ReaderUI
        isVisible={
          renditionReady && !isLoading && !isGenerating && !isRestoringPosition && !!bookMetadata
        }
        isHeaderVisible={autoHide.isHeaderVisible}
        header={{
          metadata: { title: bookMetadata?.title ?? '', author: bookMetadata?.creator ?? '' },
          progress,
          currentPage: currentPage ?? undefined,
          totalPages: totalPages ?? undefined,
          onBack: () => navigate('/'),
          onTocToggle: () => setIsTocOpen(!isTocOpen),
          onInfoOpen: () => setIsBookInfoOpen(true),
          onSettingsOpen: () => setIsSettingsOpen(!isSettingsOpen),
          onEntitiesOpen: handleEntitiesOpen,
          onSearchToggle: () => setIsSearchOpen((prev) => !prev),
        }}
        settings={{
          isOpen: isSettingsOpen,
          onOpenChange: setIsSettingsOpen,
          theme,
          fontSize,
          onThemeChange: setTheme,
          onFontSizeIncrease: increaseFontSize,
          onFontSizeDecrease: decreaseFontSize,
          wakeLockEnabled,
          wakeLockSupported: isWakeLockSupported,
          wakeLockActive: isWakeLockActive,
          onWakeLockChange: handleWakeLockToggle,
          navigationMode,
          onNavigationModeChange: updateNavigationMode,
          nameHighlightingEnabled,
          onNameHighlightingChange: updateNameHighlighting,
        }}
        imageStatus={{
          status: generationStatus,
          error: generationError,
          onCancel: cancelGeneration,
          descriptionPreview,
        }}
        saveStatus={{ lastSaved: lastSaved ? new Date(lastSaved) : null, isSaving }}
      />

      <EntityPopup
        entity={popupEntity}
        position={popupPosition}
        onClose={handleEntityPopupClose}
        onOpenDrawer={handleEntityPopupOpenDrawer}
      />

      <SearchPanel
        book={epubBook}
        rendition={rendition}
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        isHeaderVisible={autoHide.isHeaderVisible}
      />

      <ReaderModals
        imageModal={{
          isOpen: isModalOpen,
          selectedImage,
          onClose: closeModal,
          onImageRegenerated: handleImageRegenerated,
        }}
        bookInfo={{
          isOpen: isBookInfoOpen,
          onClose: () => setIsBookInfoOpen(false),
          metadata: book,
        }}
        entityDrawer={{
          isOpen: isEntityDrawerOpen,
          onClose: () => setIsEntityDrawerOpen(false),
          network: entityNetwork,
          isLoading: isEntityNetworkLoading,
          currentChapter,
          maxChapterReached,
          currentCFI,
          initialEntityId: drawerInitialEntityId,
        }}
        selection={{
          data: selection,
          onCopy: handleCopy,
          onBookmark: handleBookmark,
          onClose: clearSelection,
        }}
        toc={{
          isOpen: isTocOpen,
          onClose: () => setIsTocOpen(false),
          items: toc,
          currentHref: currentHref || '',
          onChapterClick: handleTocChapterClick,
          bookId: book.id,
          bookmarks,
          onNavigateToCfi: handleNavigateToCfi,
          onDeleteBookmark: deleteBookmark,
          onUpdateBookmarkNote: handleUpdateBookmarkNote,
        }}
        positionConflict={{
          data: positionConflict,
          onUseServer: handleUseServerPosition,
          onUseLocal: handleUseLocalPosition,
        }}
      />
    </div>
  );
};
