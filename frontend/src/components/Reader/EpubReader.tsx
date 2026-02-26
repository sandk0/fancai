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
  useTouchNavigation,
} from '@/hooks/epub';
import { useSwipeNavigation } from '@/hooks/epub/useSwipeNavigation';
import { useRenditionHealthGuard } from '@/hooks/epub/useRenditionHealthGuard';
import { isIOS } from '@/utils/iosSupport';
import { useReaderStore } from '@/stores/reader';
import { useReaderPosition } from '@/hooks/reader/useReaderPosition';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useReadingSession } from '@/hooks/useReadingSession';
import { notify } from '@/stores/ui';
import { useEntityNetwork, usePrefetchEntityNetwork } from '@/hooks/useEntityNetwork';
import { getCurrentUserId } from '@/hooks/api/queryKeys';

import { ReaderModals } from './Core/ReaderModals';
import { ReaderOverlays } from './Core/ReaderOverlays';
import { ReaderUI } from './Core/ReaderUI';
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

  const getReadableError = useCallback((errorStr: string) => {
    const lowerError = errorStr.toLowerCase();
    if (lowerError.includes('network') || lowerError.includes('failed to fetch')) return t('reader.error.network');
    if (lowerError.includes('404')) return t('reader.error.not_found');
    if (lowerError.includes('401')) return t('reader.error.session_expired');
    if (lowerError.includes('403')) return t('reader.error.forbidden');
    if (lowerError.includes('500')) return t('reader.error.server_error');
    if (lowerError.includes('timeout')) return t('reader.error.timeout');
    if (lowerError.includes('epub') || lowerError.includes('parse')) return t('reader.error.format_error');
    return t('reader.error.unknown');
  }, [t]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { navigationMode, updateNavigationMode } = useReaderStore();
  const effectiveNavigationMode = isIOS() ? 'swipe' : navigationMode;
  const [wakeLockEnabled, setWakeLockEnabled] = useState(() => localStorage.getItem(WAKE_LOCK_STORAGE_KEY) !== 'false');
  const { request: requestWakeLock, release: releaseWakeLock, isActive: isWakeLockActive, isSupported: isWakeLockSupported } = useWakeLock();

  const authToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  const userId = getCurrentUserId();

  const { book: epubBook, rendition, isLoading, error, reload } = useEpubLoader({
    bookUrl: booksAPI.getBookFileUrl(book.id),
    viewerRef,
    authToken,
    bookId: book.id,
    userId: userId || undefined,
    onReady: () => requestAnimationFrame(() => setRenditionReady(true)),
  });

  const { locations, isGenerating } = useLocationGeneration(epubBook, book.id);
  const { currentCFI, progress, scrollOffsetPercent, currentPage, totalPages, goToCFI, skipNextRelocated, setInitialProgress } = useCFITracking({
    rendition, locations, book: epubBook,
  });

  const { toc, currentHref, setCurrentHref } = useToc(epubBook);
  const { getChapterNumberByLocation } = useChapterMapping(toc, book.chapters || [], epubBook);

  const { isRestoringPosition, positionConflict, resolveConflict } = useReaderPosition({
    rendition, renditionReady, bookId: book.id, locations, goToCFI, skipNextRelocated, setInitialProgress,
  });

  const { currentChapter, descriptions, images } = useChapterManagement({
    book: epubBook, rendition, bookId: book.id, getChapterNumberByLocation, isRestoringPosition,
  });

  // max_chapter_reached приходит с сервера (монотонно возрастающее значение)
  // Дополнительно берём max с currentChapter на случай задержки синхронизации
  const maxChapterReached = useMemo(() => {
    const serverMax = book.reading_progress?.max_chapter_reached || 1;
    return Math.max(currentChapter, serverMax);
  }, [currentChapter, book.reading_progress?.max_chapter_reached]);

  const { isSaving, lastSaved } = useProgressSync({
    bookId: book.id, currentCFI, progress, scrollOffset: scrollOffsetPercent, currentChapter,
    onSave: async (cfi, prog, scroll, ch) => {
      await booksAPI.updateReadingProgress(book.id, {
        current_chapter: ch, current_position_percent: prog, reading_location_cfi: cfi, scroll_offset_percent: scroll,
      });
    },
    enabled: renditionReady,
    isRestoringPosition, // Prevent save during restoration
  });

  const { nextPage, prevPage } = useEpubNavigation(rendition);
  const { selectedImage, isOpen: isModalOpen, openModal, closeModal, updateImage, generationStatus, generationError, descriptionPreview, cancelGeneration } = useImageModal({ bookId: book.id });

  const hasActiveOperations = isGenerating;
  const { isHealthy: isRenditionHealthy, isChecking: isCheckingHealth, markHealthy } = useRenditionHealthGuard({
    rendition, bookId: book.id, enabled: renditionReady && !!rendition, isStable: renditionReady && !isLoading && !isRestoringPosition, hasActiveOperations, isRestoringPosition,
  });

  useEffect(() => { if (renditionReady && isRenditionHealthy && !isCheckingHealth) markHealthy(); }, [renditionReady, isRenditionHealthy, isCheckingHealth, markHealthy]);

  const { swipeState, touchHandlers: swipeTouchHandlers } = useSwipeNavigation({
    rendition, enabled: renditionReady && effectiveNavigationMode === 'swipe' && !isModalOpen,
    onNavigate: async (dir) => { if (dir === 'next') await nextPage(); else await prevPage(); },
  });

  useKeyboardNavigation({ onNext: nextPage, onPrev: prevPage, enabled: renditionReady && !isModalOpen, rendition });
  useTouchNavigation({ rendition, viewerRef, nextPage, prevPage, enabled: renditionReady && !isModalOpen && effectiveNavigationMode === 'tap' });

  const { theme, fontSize, setTheme, increaseFontSize, decreaseFontSize } = useEpubThemes(rendition);
  useContentHooks(rendition, theme);

  useDescriptionHighlighting({ rendition, descriptions, images, onDescriptionClick: async (d, i) => await openModal(d, i), enabled: renditionReady });

  useResizeHandler({ rendition, enabled: renditionReady, onResized: () => {} });
  const { metadata: bookMetadata } = useBookMetadata(epubBook);
  const { selection, clearSelection } = useTextSelection(rendition, renditionReady && !isModalOpen);
  const selectionRef = useRef(selection);
  useEffect(() => { selectionRef.current = selection; }, [selection]);

  useReadingSession({
    bookId: book.id, currentPosition: progress, enabled: renditionReady && !isGenerating,
    onSessionEnd: (s) => notify.success(t('reader.notification.session_complete'), t('reader.notification.session_stats', { minutes: s.duration_minutes, pages: s.pages_read })),
  });

  const [isEntityDrawerOpen, setIsEntityDrawerOpen] = useState(false);
  const { data: entityNetwork, isLoading: isEntityNetworkLoading } = useEntityNetwork(book.id, maxChapterReached);
  const prefetchEntityNetwork = usePrefetchEntityNetwork();
  useEffect(() => { if (book.id) prefetchEntityNetwork(book.id); }, [book.id, prefetchEntityNetwork]);

  const handleEntitiesOpen = useCallback(() => setIsEntityDrawerOpen(true), []);
  const [isBookInfoOpen, setIsBookInfoOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(() => localStorage.getItem(`${STORAGE_KEYS.READER_SETTINGS}_toc_open`) === 'true');
  useEffect(() => { localStorage.setItem(`${STORAGE_KEYS.READER_SETTINGS}_toc_open`, String(isTocOpen)); }, [isTocOpen]);

  useEffect(() => {
    if (!isWakeLockSupported) return;
    if (wakeLockEnabled && renditionReady && !isRestoringPosition) requestWakeLock();
    else releaseWakeLock();
    return () => { releaseWakeLock(); };
  }, [wakeLockEnabled, renditionReady, isRestoringPosition, isWakeLockSupported, requestWakeLock, releaseWakeLock]);

  const handleWakeLockToggle = useCallback((e: boolean) => {
    setWakeLockEnabled(e);
    localStorage.setItem(WAKE_LOCK_STORAGE_KEY, String(e));
  }, []);

  useEffect(() => { if (currentCFI && selectionRef.current) clearSelection(); }, [currentCFI, clearSelection]);

  const handleTocChapterClick = useCallback(async (href: string) => {
    if (!rendition) return;
    try { await rendition.display(href); setCurrentHref(href); } catch (err) { logger.error(err); }
  }, [rendition, setCurrentHref]);

  const handleCopy = useCallback(async () => {
    if (!selection?.text) return;
    try {
      await navigator.clipboard.writeText(selection.text);
      notify.success(t('reader.notification.copied'));
      clearSelection();
    } catch (err) { logger.error(err); }
  }, [selection, clearSelection, t]);

  const handleImageRegenerated = useCallback((url: string) => updateImage(url), [updateImage]);
  const handleUseServerPosition = useCallback(() => resolveConflict('server'), [resolveConflict]);
  const handleUseLocalPosition = useCallback(() => resolveConflict('local'), [resolveConflict]);

  const handleDescriptionClick = useCallback(async (id: string) => {
    const d = descriptions.find(x => x.id === id);
    if (d) await openModal(d, images.find(x => x.description_id === id));
  }, [descriptions, images, openModal]);

  const handleCenterTap = useCallback(async (x: number, y: number) => {
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
    } catch (err) { logger.error(err); }
  }, [rendition, handleDescriptionClick]);

  const backgroundColor = useMemo(() => {
    if (theme === 'sepia') return 'bg-[#FBF0D9]';
    if (theme === 'dark') return 'bg-[#121212]';
    if (theme === 'night') return 'bg-black';
    return 'bg-white';
  }, [theme]);

  return (
    <div className={`relative h-full w-full transition-colors ${backgroundColor}`}>
      <div
        ref={viewerRef} id="epub-viewer" tabIndex={-1}
        className={`h-full w-full ${backgroundColor} outline-hidden`}
        style={{
          paddingTop: 'calc(70px + env(safe-area-inset-top))',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          touchAction: 'pan-x pan-y',
        }}
        {...(effectiveNavigationMode === 'swipe' ? swipeTouchHandlers : {})}
      />

      <ReaderOverlays
        loading={{ isLoading, isGenerating, isRestoringPosition, isCheckingHealth, isRenditionHealthy, renditionReady }}
        error={{ message: error, readableMessage: error ? getReadableError(error) : '', onRetry: reload, onHome: () => navigate('/library') }}
        theme={theme} backgroundColor={backgroundColor} navigationMode={navigationMode}
        swipe={{ state: swipeState, viewportWidth: window.innerWidth, headerHeight: 70 }}
        tapZones={{ onPrevPage: prevPage, onNextPage: nextPage, onDescriptionClick: handleDescriptionClick, onCenterTap: handleCenterTap }}
      />

      <ReaderUI
        isVisible={renditionReady && !isLoading && !isGenerating && !isRestoringPosition && !!bookMetadata}
        header={{
          metadata: { title: bookMetadata?.title ?? '', author: bookMetadata?.creator ?? '' },
          progress, currentPage: currentPage ?? undefined, totalPages: totalPages ?? undefined,
          onBack: () => navigate('/'), onTocToggle: () => setIsTocOpen(!isTocOpen),
          onInfoOpen: () => setIsBookInfoOpen(true), onSettingsOpen: () => setIsSettingsOpen(!isSettingsOpen),
          onEntitiesOpen: handleEntitiesOpen,
        }}
        settings={{
          isOpen: isSettingsOpen, onOpenChange: setIsSettingsOpen, theme, fontSize,
          onThemeChange: setTheme, onFontSizeIncrease: increaseFontSize, onFontSizeDecrease: decreaseFontSize,
          wakeLockEnabled, wakeLockSupported: isWakeLockSupported, wakeLockActive: isWakeLockActive,
          onWakeLockChange: handleWakeLockToggle, navigationMode, onNavigationModeChange: updateNavigationMode,
        }}
        imageStatus={{ status: generationStatus, error: generationError, onCancel: cancelGeneration, descriptionPreview }}
        saveStatus={{ lastSaved: lastSaved ? new Date(lastSaved) : null, isSaving }}
      />

      <ReaderModals
        imageModal={{ isOpen: isModalOpen, selectedImage, onClose: closeModal, onImageRegenerated: handleImageRegenerated }}
        bookInfo={{ isOpen: isBookInfoOpen, onClose: () => setIsBookInfoOpen(false), metadata: book }}
        entityDrawer={{ 
          isOpen: isEntityDrawerOpen, 
          onClose: () => setIsEntityDrawerOpen(false), 
          network: entityNetwork, 
          isLoading: isEntityNetworkLoading, 
          currentChapter, 
          maxChapterReached,
          currentCFI 
        }}
        selection={{ data: selection, onCopy: handleCopy, onClose: clearSelection }}
        toc={{ isOpen: isTocOpen, onClose: () => setIsTocOpen(false), items: toc, currentHref: currentHref || '', onChapterClick: handleTocChapterClick }}
        positionConflict={{ data: positionConflict, onUseServer: handleUseServerPosition, onUseLocal: handleUseLocalPosition }}
      />
    </div>
  );
};
