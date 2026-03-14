import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { booksAPI } from '@/api/books';
import { STORAGE_KEYS } from '@/types/state';
import type { BookDetail, Description, GeneratedImage } from '@/types/api';
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
  suppressSelection,
  useToc,
} from '@/hooks/epub';
import { useGestureController } from '@/hooks/epub/useGestureController';
import { useRenditionHealthGuard } from '@/hooks/epub/useRenditionHealthGuard';
import { useBookmarkActions } from '@/hooks/epub/useBookmarks';
import { useAnnotationRendering } from '@/hooks/epub/useAnnotationRendering';
import { useReaderStore } from '@/stores/reader';
import { useAutoHideUI } from '@/hooks/reader/useAutoHideUI';
import { useReaderPosition } from '@/hooks/reader/useReaderPosition';
import { useVisualViewportHandler } from '@/hooks/shared/useVisualViewportHandler';
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
import { EntityBottomSheet } from './EntityBottomSheet';
import { DescriptionDrawer } from './DescriptionDrawer';
import { useEntityNameHighlighting } from '@/hooks/epub/useEntityNameHighlighting';
import { useNavigationLock } from '@/hooks/shared/useNavigationLock';
import { rangeCfiToPoint } from '@/utils/epubPatches';
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
  const [tocTab, setTocTab] = useState<'toc' | 'notes' | 'info'>('toc');
  const [isTocOpen, setIsTocOpen] = useState(
    () => localStorage.getItem(`${STORAGE_KEYS.READER_SETTINGS}_toc_open`) === 'true'
  );
  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEYS.READER_SETTINGS}_toc_open`, String(isTocOpen));
  }, [isTocOpen]);
  const [drawerDescription, setDrawerDescription] = useState<Description | null>(null);
  const [drawerImage, setDrawerImage] = useState<GeneratedImage | undefined>(undefined);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [popupEntity, setPopupEntity] = useState<import('@/types/entity').EntityDetail | null>(
    null
  );
  const {
    navigationMode,
    updateNavigationMode,
    descriptionHighlightingEnabled,
    updateDescriptionHighlighting,
    descriptionHighlightMode,
    updateDescriptionHighlightMode,
    pageAnimationEnabled,
    updatePageAnimation,
  } = useReaderStore();
  const [wakeLockEnabled, setWakeLockEnabled] = useState(
    () => localStorage.getItem(WAKE_LOCK_STORAGE_KEY) !== 'false'
  );
  const {
    request: requestWakeLock,
    release: releaseWakeLock,
    isActive: isWakeLockActive,
    isSupported: isWakeLockSupported,
  } = useWakeLock();
  useVisualViewportHandler();

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
    chapterPage,
    chapterTotalPages,
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

  const { nextPage, prevPage, instantNextPage, instantPrevPage } = useEpubNavigation(rendition);
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
    (id: string) => {
      const d = descriptions.find((x) => x.id === id);
      if (d) {
        setDrawerDescription(d);
        setDrawerImage(images.find((x) => x.description_id === id));
        setIsDrawerOpen(true);
      }
    },
    [descriptions, images]
  );

  // Entity click handler and entity list (needed before handleCenterTap)
  const [drawerInitialEntityId, setDrawerInitialEntityId] = useState<string | null>(null);
  const { data: entityNetwork, isLoading: isEntityNetworkLoading } = useEntityNetwork(
    book.id,
    maxChapterReached
  );
  const prefetchEntityNetwork = usePrefetchEntityNetwork();
  useEffect(() => {
    if (book.id) prefetchEntityNetwork(book.id);
  }, [book.id, prefetchEntityNetwork]);

  const handleEntityClick = useCallback((entity: import('@/types/entity').EntityDetail) => {
    setPopupEntity(entity);
  }, []);

  const entityList = useMemo(() => {
    if (!entityNetwork?.entities) return [];
    return Object.values(entityNetwork.entities);
  }, [entityNetwork?.entities]);

  const handleCenterTap = useCallback(
    async (x: number, y: number): Promise<boolean> => {
      if (!rendition) return false;
      try {
        const contents = rendition.getContents();
        if (!contents?.length) return false;
        const doc = contents[0].document;
        if (!doc) return false;
        let target = doc.elementFromPoint(x, y) as HTMLElement | null;
        while (target && target !== doc.body) {
          if (target.classList?.contains('description-highlight')) {
            const id = target.getAttribute('data-description-id');
            if (id) handleDescriptionClick(id);
            return true;
          }
          if (target.classList?.contains('entity-mention')) {
            const entityId = target.getAttribute('data-entity-id');
            if (entityId) {
              const entity = entityList.find((e) => e.id === entityId);
              if (entity) handleEntityClick(entity);
            }
            return true;
          }
          target = target.parentElement;
        }
      } catch (err) {
        logger.error(err);
      }
      return false;
    },
    [rendition, handleDescriptionClick, entityList, handleEntityClick]
  );

  // Auto-hide UI: immersive mode (header hidden by default)
  const autoHide = useAutoHideUI({ initialVisible: false });

  // Standalone hint: delayed show + auto-dismiss
  const [hintVisible, setHintVisible] = useState(false);
  useEffect(() => {
    if (!autoHide.showStandaloneHint || !renditionReady || isRestoringPosition) {
      setHintVisible(false);
      return;
    }
    // Fade in after 1.5s
    const showTimer = setTimeout(() => setHintVisible(true), 1500);
    // Auto-dismiss after 4s (total 5.5s from renditionReady)
    const hideTimer = setTimeout(() => {
      autoHide.dismissStandaloneHint();
      setHintVisible(false);
    }, 5500);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [
    autoHide.showStandaloneHint,
    renditionReady,
    isRestoringPosition,
    autoHide.dismissStandaloneHint,
  ]);

  // Compute isPanelOpen for gesture blocking
  const isPanelOpen =
    isTocOpen ||
    isSettingsOpen ||
    isEntityDrawerOpen ||
    isSearchOpen ||
    isDrawerOpen ||
    !!popupEntity;

  // Dismiss all panels when user taps inside epub iframe
  const handlePanelDismiss = useCallback(() => {
    setIsTocOpen(false);
    setIsSettingsOpen(false);
    setIsEntityDrawerOpen(false);
    setIsSearchOpen(false);
    setIsDrawerOpen(false);
    setPopupEntity(null);
  }, []);

  // Unified gesture controller (swipe + tap navigation via iframe and iOS overlay)
  const gestureController = useGestureController({
    rendition,
    enabled: renditionReady && !isModalOpen,
    // onNavigate is called from onComplete of spring animation.
    // Must use INSTANT scroll (visual already handled by spring transform).
    onNavigate: async (dir) => {
      if (dir === 'next') await instantNextPage();
      else await instantPrevPage();
    },
    onChapterChange: async (dir) => {
      if (dir === 'next') await rendition?.next();
      else await rendition?.prev();
    },
    // onEdgeTap: navigation now handled inside controller (two-phase pattern)
    onEdgeTap: () => {},
    onCenterTap: handleCenterTap,
    onToggleUI: autoHide.toggleUI,
    onSwipeStart: autoHide.onSwipeStart,
    onTapNavigate: autoHide.onTapNavigate,
    navLock,
    isPanelOpen,
    pageAnimationEnabled,
    onPanelDismiss: handlePanelDismiss,
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
    onDescriptionClick: (d, i) => {
      setDrawerDescription(d);
      setDrawerImage(i);
      setIsDrawerOpen(true);
    },
    enabled: renditionReady && descriptionHighlightingEnabled,
    highlightMode: descriptionHighlightMode,
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

  const { highlightPopup, closePopup, flashAnnotation } = useAnnotationRendering({
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
      autoHide.hideUI();
      try {
        // Convert range CFI to point CFI to avoid epub.js IndexSizeError
        // on same-section navigation (locationOf() throws on range CFIs)
        const displayCfi = rangeCfiToPoint(cfi);
        await rendition.display(displayCfi);
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

  // Highlight tooltip: edit mode state and handlers
  const [editingBookmark, setEditingBookmark] = useState<{
    bookmarkId: string;
    note: string | null;
    color: string | null;
    text_color: string | null;
    style: string;
    position: { x: number; y: number };
  } | null>(null);

  const handleHighlightEdit = useCallback(
    (bookmarkId: string) => {
      closePopup();
      const bookmark = bookmarks.find((b) => b.id === bookmarkId);
      if (!bookmark) return;
      setEditingBookmark({
        bookmarkId,
        note: bookmark.note ?? null,
        color: bookmark.color ?? null,
        text_color: bookmark.text_color ?? null,
        style: bookmark.style ?? 'none',
        position: highlightPopup?.position ?? {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        },
      });
    },
    [closePopup, bookmarks, highlightPopup]
  );

  const handleEditSave = useCallback(
    (
      bookmarkId: string,
      opts: { color?: string | null; style?: string; note?: string; text_color?: string | null }
    ) => {
      updateBookmark(bookmarkId, opts);
      setEditingBookmark(null);
    },
    [updateBookmark]
  );

  const handleHighlightDelete = useCallback(
    (bookmarkId: string) => {
      deleteBookmark(bookmarkId);
      closePopup();
    },
    [deleteBookmark, closePopup]
  );

  const handleCloseEditMode = useCallback(() => {
    setEditingBookmark(null);
  }, []);

  // Shared dismiss logic: close popup + suppress selection so the dismiss-tap
  // doesn't create a ghost selection. Used by BOTH backdrop (parent DOM) and
  // iframe click paths to ensure consistent behavior.
  const handleDismissHighlight = useCallback(() => {
    closePopup();
    suppressSelection(300);
    try {
      const contents = rendition?.getContents()[0];
      contents?.window?.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }
  }, [closePopup, rendition]);

  const handleDismissSelection = useCallback(() => {
    clearSelection();
    suppressSelection(300);
    try {
      const contents = rendition?.getContents()[0];
      contents?.window?.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }
  }, [clearSelection, rendition]);

  // Dismiss popups when user taps inside the epub.js iframe.
  // Backdrop handles parent DOM taps (via handleDismissHighlight/handleDismissSelection);
  // this handles iframe taps (cross-frame boundary, where backdrop can't intercept).
  useEffect(() => {
    if (!rendition) return;
    if (!editingBookmark && !highlightPopup) return;
    const dismiss = () => {
      logger.debug(
        '[EpubReader] iframe dismiss fired -- editingBookmark:',
        !!editingBookmark,
        'highlightPopup:',
        !!highlightPopup
      );
      if (editingBookmark) setEditingBookmark(null);
      if (highlightPopup) handleDismissHighlight();
      else handleDismissSelection();
    };
    rendition.on('click', dismiss);
    return () => {
      rendition.off('click', dismiss);
    };
  }, [rendition, editingBookmark, highlightPopup, handleDismissHighlight, handleDismissSelection]);

  const { nameHighlightingEnabled, updateNameHighlighting } = useReaderStore();

  useEntityNameHighlighting({
    rendition,
    entities: entityList,
    currentChapter,
    currentCFI,
    enabled: renditionReady && nameHighlightingEnabled,
    onEntityClick: (entity, _position) => handleEntityClick(entity),
  });

  const handleEntityPopupOpenDrawer = useCallback((entityId: string) => {
    setDrawerInitialEntityId(entityId);
    setIsEntityDrawerOpen(true);
    setPopupEntity(null);
  }, []);

  const handleEntityPopupClose = useCallback(() => {
    setPopupEntity(null);
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
    if (currentCFI && selectionRef.current) {
      logger.debug('[EpubReader] CFI changed while selection active -- clearing');
      clearSelection();
    }
  }, [currentCFI, clearSelection]);

  const handleTocChapterClick = useCallback(
    async (href: string) => {
      if (!rendition) return;
      autoHide.hideUI();
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
          onBack: () => navigate('/'),
          onTocToggle: () => setIsTocOpen(!isTocOpen),
          onSettingsOpen: () => setIsSettingsOpen(!isSettingsOpen),
          onEntitiesOpen: handleEntitiesOpen,
          onSearchToggle: () => setIsSearchOpen((prev) => !prev),
        }}
        footer={{
          progress,
          currentPage: currentPage ?? undefined,
          totalPages: totalPages ?? undefined,
          chapterPage: chapterPage ?? undefined,
          chapterTotalPages: chapterTotalPages ?? undefined,
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
          descriptionHighlightingEnabled,
          onDescriptionHighlightingChange: updateDescriptionHighlighting,
          descriptionHighlightMode,
          onDescriptionHighlightModeChange: updateDescriptionHighlightMode,
          pageAnimationEnabled,
          onPageAnimationChange: updatePageAnimation,
        }}
        imageStatus={{
          status: generationStatus,
          error: generationError,
          onCancel: cancelGeneration,
          descriptionPreview,
        }}
        saveStatus={{ lastSaved: lastSaved ? new Date(lastSaved) : null, isSaving }}
      />

      <EntityBottomSheet
        entity={popupEntity}
        isOpen={!!popupEntity}
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

      {/* Standalone mode: center-tap hint (shown once on first book open) */}
      <AnimatePresence>
        {hintVisible && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center"
            onClick={() => {
              autoHide.dismissStandaloneHint();
              setHintVisible(false);
            }}
          >
            <div className="rounded-xl bg-black/60 px-6 py-4 text-center text-white shadow-lg">
              <p className="text-base font-medium">{t('reader.standalone_hint')}</p>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      <DescriptionDrawer
        description={drawerDescription}
        image={drawerImage}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onOpenImage={(d, i) => {
          setIsDrawerOpen(false);
          openModal(d, i);
        }}
        bookId={book.id}
      />

      <ReaderModals
        imageModal={{
          isOpen: isModalOpen,
          selectedImage,
          onClose: closeModal,
          onImageRegenerated: handleImageRegenerated,
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
          onClose: handleDismissSelection,
        }}
        highlight={{
          popup: highlightPopup,
          onEdit: handleHighlightEdit,
          onDelete: handleHighlightDelete,
          onClose: handleDismissHighlight,
        }}
        selectionEditMode={
          editingBookmark
            ? {
                ...editingBookmark,
                onSave: handleEditSave,
              }
            : undefined
        }
        onCloseEditMode={handleCloseEditMode}
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
          metadata: book,
          activeTab: tocTab,
          onTabChange: setTocTab,
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
