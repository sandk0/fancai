/**
 * BookCard - Redesigned book card with hover effects, mobile menu, and animations
 *
 * Features:
 * - Aspect ratio 2:3 for cover
 * - Skeleton loading animation for cover images with fade-in transition
 * - Progress bar overlay at bottom of cover
 * - Hover overlay with Read/Delete actions (desktop)
 * - Always visible MoreVertical menu (mobile)
 * - Title and author with line-clamp
 * - Framer-motion animations
 * - Touch-friendly tap areas (min 44px)
 * - Offline download indicator and controls
 *
 * @param book - Book data
 * @param onClick - Callback when clicking to read
 * @param onParsingComplete - Callback when AI parsing completes
 * @param onDelete - Callback for delete action
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import {
  Book,
  BookOpen,
  Trash2,
  MoreVertical,
  AlertCircle,
  X,
  Download,
  CheckCircle2,
  Loader2,
  CloudOff,
  Sparkles,
  RefreshCw,
  Circle,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ParsingOverlay } from '@/components/UI/ParsingOverlay';
import { AuthenticatedImage } from '@/components/UI/AuthenticatedImage';
import type { Book as BookType } from '@/types/api';
import { useEpubOffline } from '@/hooks/useEpubOffline';
import { useHaptics } from '@/hooks/useHaptics';
import { useBookProcessing } from '@/hooks/useBookProcessing';

interface BookCardProps {
  book: BookType;
  onClick: () => void;
  onParsingComplete?: () => void;
  onDelete?: (bookId: string) => void;
  onProcessStart?: (bookId: string) => void;  // NEW: triggered when user clicks process button
}

/**
 * BookCard - Memoized book card component with animations
 */
export const BookCard = memo(function BookCard({
  book,
  onClick,
  onParsingComplete,
  onDelete,
  onProcessStart,
}: BookCardProps) {
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Haptic feedback for mobile interactions
  const haptics = useHaptics();

  // Description processing state
  const {
    processingState,
    startProcessing,
    cancelProcessing,
    isStarting,
  } = useBookProcessing(book);

  // Offline book management
  const {
    isAvailableOffline,
    isDownloading,
    downloadProgress,
    downloadEpub,
    removeEpub,
  } = useEpubOffline(book.id);

  // Memoize coverUrl
  const coverUrl = useMemo(() => {
    return book.has_cover
      ? `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/books/${book.id}/cover`
      : null;
  }, [book.has_cover, book.id]);

  // Reset imageLoaded when cover URL changes (component reuse)
  useEffect(() => {
    setImageLoaded(false);
  }, [coverUrl]);

  const isClickable = book.is_parsed && !book.is_processing;
  const progressPercent = book.reading_progress_percent ?? 0;

  // Memoize click handler
  const handleClick = useCallback(() => {
    if (isClickable) {
      haptics.tap();
      onClick();
    }
  }, [isClickable, onClick, haptics]);

  // Handle read button click
  const handleReadClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isClickable) {
        onClick();
      }
    },
    [isClickable, onClick]
  );

  // Handle delete button click
  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowMobileMenu(false);
      onDelete?.(book.id);
    },
    [book.id, onDelete]
  );

  // Handle offline download/remove
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

  // Handle mobile menu toggle
  const handleMobileMenuToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    haptics.select();
    setShowMobileMenu((prev) => !prev);
  }, [haptics]);

  // Handle image load complete
  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  // Close mobile menu
  const handleCloseMobileMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMobileMenu(false);
  }, []);

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
      {/* Main Card Container */}
      <div
        className={cn(
          'cursor-pointer transition-shadow duration-300',
          isClickable ? 'hover:shadow-xl' : 'opacity-70',
          !isClickable && 'pointer-events-none'
        )}
        onClick={handleClick}
      >
        {/* Book Cover Container - 2:3 aspect ratio */}
        <div className="relative aspect-[2/3] rounded-xl overflow-hidden shadow-lg bg-muted">
          {/* Skeleton Loading Placeholder */}
          {!imageLoaded && coverUrl && (
            <div className="absolute inset-0 bg-muted animate-pulse" />
          )}

          {/* Cover Image */}
          <AuthenticatedImage
            src={coverUrl}
            alt={`${book.title} cover`}
            className={cn(
              "w-full h-full object-cover transition-opacity duration-300",
              imageLoaded ? "opacity-100" : "opacity-0"
            )}
            onLoad={handleImageLoad}
            fallback={
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                <Book className="w-12 h-12 text-muted-foreground/50" />
              </div>
            }
          />

          {/* === CENTER ACTION BUTTON for Description Processing === */}
          <AnimatePresence>
            {/* NOT PROCESSED - show sparkles button always */}
            {processingState === 'not_processed' && !book.is_processing && (
              <m.div
                className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
              >
                <m.button
                  className={cn(
                    "pointer-events-auto",
                    "p-3.5 rounded-full shadow-xl backdrop-blur-md",
                    "bg-[var(--color-accent-500)]/95 text-white",
                    "hover:bg-[var(--color-accent-600)] hover:scale-110",
                    "active:scale-95",
                    "min-w-[52px] min-h-[52px]",
                    "transition-all duration-200",
                    "ring-2 ring-white/20"
                  )}
                  whileHover={{ scale: 1.1, boxShadow: "0 8px 30px rgba(0,0,0,0.3)" }}
                  whileTap={{ scale: 0.95 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    haptics.tap();
                    startProcessing();
                    onProcessStart?.(book.id);
                  }}
                  disabled={isStarting}
                  aria-label="Обработать описания"
                >
                  {isStarting ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <Sparkles className="w-6 h-6" />
                  )}
                </m.button>
              </m.div>
            )}

            {/* PROCESSED - REMOVED central refresh button to avoid overlap with menu */}
            {/* The reprocess action is now in the desktop hover menu */}

            {/* ERROR - show retry button always */}
            {processingState === 'error' && !book.is_processing && (
              <m.div
                className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <m.button
                  className={cn(
                    "pointer-events-auto",
                    "p-3.5 rounded-full shadow-xl backdrop-blur-md",
                    "bg-destructive/90 text-white",
                    "hover:bg-destructive hover:scale-110",
                    "min-w-[52px] min-h-[52px]"
                  )}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    haptics.tap();
                    startProcessing();
                    onProcessStart?.(book.id);
                  }}
                  disabled={isStarting}
                  aria-label="Повторить обработку"
                >
                  <AlertTriangle className="w-6 h-6" />
                </m.button>
              </m.div>
            )}
          </AnimatePresence>

          {/* Parsing Overlay */}
          {book.is_processing && onParsingComplete && (
            <ParsingOverlay
              bookId={book.id}
              onParsingComplete={onParsingComplete}
              onCancel={cancelProcessing}
              forceBlock={false}
            />
          )}

          {/* Progress Bar Overlay - at bottom of cover */}
          {progressPercent > 0 && !book.is_processing && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
              <div className="flex items-center justify-between text-white text-xs mb-1">
                <span className="font-medium">{Math.round(progressPercent)}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/30 overflow-hidden">
                <m.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(progressPercent, 100)}%` }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                />
              </div>
            </div>
          )}

          {/* Processing Indicator */}
          {book.is_processing && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-900/80 to-transparent p-3">
              <div className="flex items-center gap-2 text-amber-100 text-xs">
                <AlertCircle className="w-4 h-4 animate-pulse" />
                <span>AI обработка...</span>
              </div>
            </div>
          )}

          {/* Offline Status Badge - top left corner */}
          {isClickable && !book.is_processing && (
            <div className="absolute top-2 left-2 pointer-events-none">
              {isDownloading ? (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/90 text-primary-foreground text-xs font-medium backdrop-blur-sm shadow-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{downloadProgress}%</span>
                </div>
              ) : isAvailableOffline ? (
                <div
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-500/90 text-white text-xs font-medium backdrop-blur-sm shadow-sm"
                  title="Доступна офлайн"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
              ) : null}
            </div>
          )}

          {/* Hover Overlay with Actions - Desktop only */}
          <AnimatePresence>
            {isHovered && isClickable && !book.is_processing && (
              <m.div
                className="absolute inset-0 bg-black/60 hidden md:flex flex-col items-center justify-center gap-2 p-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Read Button */}
                <m.button
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg min-h-[44px] min-w-[120px] justify-center"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleReadClick}
                >
                  <BookOpen className="w-5 h-5" />
                  <span>Читать</span>
                </m.button>

                {/* Process/Reprocess Button (Desktop Menu) */}
                {!book.is_processing && (
                  <m.button
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-xl font-medium shadow-lg min-h-[44px] min-w-[120px] justify-center',
                      processingState === 'error'
                        ? 'bg-destructive/90 text-white'
                        : 'bg-white/20 text-white hover:bg-white/30'
                    )}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      haptics.tap();
                      startProcessing();
                      onProcessStart?.(book.id);
                    }}
                  >
                    {processingState === 'not_processed' && (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Обработать</span>
                      </>
                    )}
                    {processingState === 'processed' && (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        <span>Обновить</span>
                      </>
                    )}
                    {processingState === 'error' && (
                      <>
                        <AlertTriangle className="w-4 h-4" />
                        <span>Повторить</span>
                      </>
                    )}
                  </m.button>
                )}

                {/* Offline Download/Remove Button */}
                <m.button
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-xl font-medium shadow-lg min-h-[44px] min-w-[120px] justify-center',
                    isAvailableOffline
                      ? 'bg-green-600/90 text-white'
                      : 'bg-white/20 text-white hover:bg-white/30'
                  )}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleOfflineClick}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{downloadProgress}%</span>
                    </>
                  ) : isAvailableOffline ? (
                    <>
                      <CloudOff className="w-4 h-4" />
                      <span>Удалить</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Офлайн</span>
                    </>
                  )}
                </m.button>

                {/* Delete Button */}
                {onDelete && (
                  <m.button
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive/90 text-white font-medium shadow-lg min-h-[44px] min-w-[100px] justify-center"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleDeleteClick}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Удалить</span>
                  </m.button>
                )}
              </m.div>
            )}
          </AnimatePresence>

          {/* Mobile Menu Button - Always visible on mobile */}
          <button
            className="absolute top-2 right-2 p-2 rounded-lg bg-black/50 text-white md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center backdrop-blur-sm"
            onClick={handleMobileMenuToggle}
            aria-label="Меню книги"
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {/* Mobile Menu Dropdown */}
          <AnimatePresence>
            {showMobileMenu && (
              <>
                {/* Backdrop */}
                <m.div
                  className="fixed inset-0 z-40 md:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={handleCloseMobileMenu}
                />
                {/* Menu */}
                <m.div
                  className="absolute top-12 right-2 z-[100] bg-card border border-border rounded-xl shadow-xl overflow-hidden w-52 sm:w-56 md:hidden"
                  initial={{ opacity: 0, scale: 0.9, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -10 }}
                  transition={{ duration: 0.15 }}
                >
                  {isClickable && (
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-foreground hover:bg-muted transition-colors min-h-[44px] whitespace-nowrap"
                      onClick={handleReadClick}
                    >
                      <BookOpen className="w-5 h-5 flex-shrink-0 text-primary" />
                      <span className="font-medium">Читать</span>
                    </button>
                  )}
                  {/* Offline Download/Remove - Mobile */}
                  {isClickable && (
                    <button
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 transition-colors min-h-[44px] whitespace-nowrap',
                        isAvailableOffline
                          ? 'text-green-600 hover:bg-green-500/10'
                          : 'text-foreground hover:bg-muted'
                      )}
                      onClick={handleOfflineClick}
                      disabled={isDownloading}
                    >
                      {isDownloading ? (
                        <>
                          <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" />
                          <span className="font-medium">Загрузка {downloadProgress}%</span>
                        </>
                      ) : isAvailableOffline ? (
                        <>
                          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                          <span className="font-medium">Удалить офлайн</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-5 h-5 flex-shrink-0" />
                          <span className="font-medium">Скачать офлайн</span>
                        </>
                      )}
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-destructive hover:bg-destructive/10 transition-colors min-h-[44px] whitespace-nowrap"
                      onClick={handleDeleteClick}
                    >
                      <Trash2 className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Удалить</span>
                    </button>
                  )}
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-muted-foreground hover:bg-muted transition-colors min-h-[44px] border-t border-border whitespace-nowrap"
                    onClick={handleCloseMobileMenu}
                  >
                    <X className="w-5 h-5 flex-shrink-0" />
                    <span>Закрыть</span>
                  </button>
                </m.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Book Info with Status Badge */}
        <div className="mt-3 px-1">
          <div className="flex items-start gap-2">
            {/* Title and Author */}
            <div className="flex-1 min-w-0">
              {/* Title - 2 lines max */}
              <h3 className="font-semibold text-sm leading-tight line-clamp-2 text-foreground mb-1">
                {book.title}
              </h3>
              {/* Author - 1 line max */}
              <p className="text-xs text-muted-foreground line-clamp-1">
                {book.author}
              </p>
            </div>

            {/* Status Badge */}
            <div className="flex-shrink-0 mt-0.5">
              {processingState === 'processed' && (
                <span title="Описания обработаны">
                  <CheckCircle2 className="w-4 h-4 text-[var(--color-success)]" />
                </span>
              )}
              {processingState === 'not_processed' && (
                <span title="Описания не обработаны">
                  <Circle className="w-4 h-4 text-muted-foreground" />
                </span>
              )}
              {processingState === 'processing' && (
                <span title="Обработка...">
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                </span>
              )}
              {processingState === 'error' && (
                <span title="Ошибка обработки">
                  <AlertCircle className="w-4 h-4 text-destructive" />
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </m.div>
  );
});
