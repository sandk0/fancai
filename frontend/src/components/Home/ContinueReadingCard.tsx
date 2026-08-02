import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { m } from 'motion/react';
import { BookOpen, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AuthenticatedImage } from '@/components/UI/AuthenticatedImage';
import { SkeletonCard } from '@/components/Home/Skeletons';
import type { Book } from '@/types/api';

interface ContinueReadingCardProps {
  book: Book | null;
  isLoading: boolean;
}

export const ContinueReadingCard: React.FC<ContinueReadingCardProps> = ({
  book,
  isLoading,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="mb-8 sm:mb-10" aria-busy="true" aria-live="polite">
        <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-4">
          {t('home.continue_reading')}
        </h2>
        <SkeletonCard className="h-32 sm:h-40 rounded-xl" />
      </div>
    );
  }

  if (!book) return null;

  const isClickable = !book.is_processing;

  return (
    <m.section
      className="mb-8 sm:mb-10"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
    >
      <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-4">
        {t('home.continue_reading')}
      </h2>

      <m.div
        onClick={() => isClickable && navigate(`/book/${book.id}`)}
        onKeyDown={(e) => {
          if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            navigate(`/book/${book.id}`);
          }
        }}
        role="button"
        tabIndex={isClickable ? 0 : -1}
        aria-label={book.is_processing
          ? `${book.title} - ${t('home.processing')}`
          : `${t('home.continue_reading')} ${book.title} - ${book.author}, ${Math.round(book.reading_progress_percent)}%`
        }
        className={cn(
          'relative overflow-hidden rounded-xl',
          isClickable ? 'cursor-pointer' : 'cursor-default',
          'bg-gradient-to-r from-card via-card to-accent/20',
          'border border-border',
          isClickable && 'hover:border-primary/50',
          'transition-all duration-300',
          'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        )}
        whileHover={isClickable ? { scale: 1.01 } : undefined}
        whileTap={isClickable ? { scale: 0.99 } : undefined}
      >
        {/* Processing overlay */}
        {book.is_processing && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl z-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
            <span className="text-sm font-medium text-muted-foreground">{t('home.processing_status')}</span>
          </div>
        )}

        <div className="p-3 sm:p-4 flex gap-3 sm:gap-4">
          {/* Book cover */}
          <div className="flex-shrink-0 w-16 sm:w-20 aspect-[2/3] rounded-lg overflow-hidden">
            {book.has_cover ? (
              <AuthenticatedImage
                src={`${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/books/${book.id}/cover`}
                alt={`${book.title} cover`}
                className="w-full h-full object-cover"
                fallback={
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/20 to-secondary">
                    <BookOpen className="w-8 h-8 text-primary/60" />
                  </div>
                }
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/20 to-secondary">
                <BookOpen className="w-8 h-8 text-primary/60" />
              </div>
            )}
          </div>

          {/* Book info */}
          <div className="flex-1 min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-foreground truncate mb-0.5">
              {book.title}
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground truncate mb-2">
              {book.author}
            </p>

            {/* Progress bar */}
            <div className="mb-1.5">
              <div className="flex justify-between text-[10px] sm:text-xs text-muted-foreground mb-0.5">
                <span>{t('home.progress')}</span>
                <span className="font-medium text-primary">
                  {Math.round(book.reading_progress_percent)}%
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <m.div
                  className="h-full bg-gradient-to-r from-primary to-amber-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(book.reading_progress_percent, 100)}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
            </div>

            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {book.chapters_count} {t('home.chapters')}
            </p>
          </div>

          {/* Arrow */}
          <div className="flex items-center">
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </m.div>
    </m.section>
  );
};
