import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'motion/react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ParsingOverlay } from '@/components/UI/ParsingOverlay';
import { useEpubOffline } from '@/hooks/useEpubOffline';
import { useHaptics } from '@/hooks/useHaptics';
import { useBookProcessing } from '@/hooks/useBookProcessing';
import type { BookCardProps } from './types';
import { BookCover } from './BookCover';
import { ProcessingButtons } from './ProcessingButtons';
import { DesktopHoverOverlay } from './DesktopHoverOverlay';
import { MobileMenu } from './MobileMenu';
import { BookInfo } from './BookInfo';

export const BookCard = memo(function BookCard({
  book,
  onClick,
  onParsingComplete,
  onDelete,
  onProcessStart,
}: BookCardProps) {
  const { t } = useTranslation();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const haptics = useHaptics();

  const {
    processingState,
    startProcessing,
    cancelProcessing,
    isStarting,
  } = useBookProcessing(book);

  const {
    isAvailableOffline,
    isDownloading,
    downloadProgress,
    downloadEpub,
    removeEpub,
  } = useEpubOffline(book.id);

  const coverUrl = useMemo(() => {
    return book.has_cover
      ? `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/books/${book.id}/cover`
      : null;
  }, [book.has_cover, book.id]);

  useEffect(() => {
    setImageLoaded(false);
  }, [coverUrl]);

  const isClickable = book.is_parsed && !book.is_processing;
  const progressPercent = book.reading_progress_percent ?? 0;

  const handleClick = useCallback(() => {
    if (isClickable) {
      haptics.tap();
      onClick();
    }
  }, [isClickable, onClick, haptics]);

  const handleReadClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isClickable) {
        onClick();
      }
    },
    [isClickable, onClick]
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowMobileMenu(false);
      onDelete?.(book.id);
    },
    [book.id, onDelete]
  );

  const handleOfflineClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowMobileMenu(false);
      if (isAvailableOffline) {
        await removeEpub();
      } else if (!isDownloading) {
        await downloadEpub();
      }
    },
    [isAvailableOffline, isDownloading, downloadEpub, removeEpub]
  );

  const handleMobileMenuToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    haptics.select();
    setShowMobileMenu((prev) => !prev);
  }, [haptics]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  const handleCloseMobileMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMobileMenu(false);
  }, []);

  const handleProcessClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      haptics.tap();
      startProcessing();
      onProcessStart?.(book.id);
    },
    [haptics, startProcessing, onProcessStart, book.id]
  );

  const handleStartProcessing = useCallback(() => {
    startProcessing();
    onProcessStart?.(book.id);
  }, [startProcessing, onProcessStart, book.id]);

  return (
    <m.div
      className="group relative"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      whileHover={{ y: -4 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
    >
      <div
        className={cn(
          'cursor-pointer transition-shadow duration-300',
          isClickable ? 'hover:shadow-xl' : 'opacity-70',
          !isClickable && !book.is_processing && 'pointer-events-none'
        )}
        onClick={handleClick}
      >
        <div className="relative aspect-[2/3] rounded-xl overflow-hidden shadow-lg bg-muted">
          <BookCover
            book={book}
            imageLoaded={imageLoaded}
            onImageLoad={handleImageLoad}
            coverUrl={coverUrl}
            isClickable={isClickable}
            progressPercent={progressPercent}
            isAvailableOffline={isAvailableOffline}
            isDownloading={isDownloading}
            downloadProgress={downloadProgress}
          />

          <ProcessingButtons
            book={book}
            processingState={processingState}
            isStarting={isStarting}
            onStartProcessing={handleStartProcessing}
          />

          {book.is_processing && onParsingComplete && (
            <ParsingOverlay
              bookId={book.id}
              onParsingComplete={onParsingComplete}
              onCancel={cancelProcessing}
              forceBlock={false}
            />
          )}

          {book.is_processing && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-900/80 to-transparent p-3">
              <div className="flex items-center gap-2 text-amber-100 text-xs">
                <AlertCircle className="w-4 h-4 animate-pulse" />
                <span>{t('bookCard.ai_processing')}</span>
              </div>
            </div>
          )}

          <AnimatePresence>
            {isHovered && (
              <DesktopHoverOverlay
                isClickable={isClickable}
                isProcessing={book.is_processing ?? false}
                processingState={processingState}
                isAvailableOffline={isAvailableOffline}
                isDownloading={isDownloading}
                downloadProgress={downloadProgress}
                onReadClick={handleReadClick}
                onDeleteClick={handleDeleteClick}
                onOfflineClick={handleOfflineClick}
                onProcessClick={handleProcessClick}
                showDelete={!!onDelete}
              />
            )}
          </AnimatePresence>

          <MobileMenu
            isOpen={showMobileMenu}
            isClickable={isClickable}
            isAvailableOffline={isAvailableOffline}
            isDownloading={isDownloading}
            downloadProgress={downloadProgress}
            showDelete={!!onDelete}
            onToggle={handleMobileMenuToggle}
            onClose={handleCloseMobileMenu}
            onReadClick={handleReadClick}
            onDeleteClick={handleDeleteClick}
            onOfflineClick={handleOfflineClick}
          />
        </div>

        <BookInfo book={book} processingState={processingState} />
      </div>
    </m.div>
  );
});
