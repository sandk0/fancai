import React, { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { m } from 'framer-motion';
import { BookOpen, ArrowRight, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AuthenticatedImage } from '@/components/UI/AuthenticatedImage';
import { SkeletonBookCard } from '@/components/Home/Skeletons';
import type { Book } from '@/types/api';

interface RecentBooksSectionProps {
  books: Book[];
  isLoading: boolean;
}

export const RecentBooksSection: React.FC<RecentBooksSectionProps> = ({
  books,
  isLoading,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 300;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  if (isLoading) {
    return (
      <section className="mb-6 sm:mb-10" aria-busy="true" aria-live="polite">
        <h2 className="text-base sm:text-lg md:text-xl font-semibold text-foreground mb-3 sm:mb-4">
          {t('home.recently_added')}
        </h2>
        <div className="grid grid-cols-2 sm:flex sm:gap-4 gap-3 sm:overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonBookCard key={i} />
          ))}
        </div>
      </section>
    );
  }

  if (!books || books.length === 0) return null;

  const displayBooks = books.slice(0, 5);

  return (
    <m.section
      className="mb-6 sm:mb-10"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <h2 className="text-base sm:text-lg md:text-xl font-semibold text-foreground">
          {t('home.recently_added')}
        </h2>

        <div className="hidden sm:flex gap-2">
          <button
            onClick={() => scroll('left')}
            className={cn(
              'p-2 rounded-lg bg-secondary text-secondary-foreground',
              'hover:bg-secondary/80 transition-colors'
            )}
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll('right')}
            className={cn(
              'p-2 rounded-lg bg-secondary text-secondary-foreground',
              'hover:bg-secondary/80 transition-colors'
            )}
            aria-label="Scroll right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mobile: Grid layout */}
      <div className="sm:hidden">
        <div className="grid grid-cols-2 gap-2.5">
          {displayBooks.map((book, index) => (
            <m.div
              key={book.id}
              className={cn(
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg relative',
                book.is_processing ? 'cursor-default' : 'cursor-pointer'
              )}
              onClick={() => !book.is_processing && navigate(`/book/${book.id}`)}
              role="button"
              tabIndex={book.is_processing ? -1 : 0}
              aria-label={book.is_processing ? `${book.title} - ${t('home.processing')}` : `${book.title} - ${book.author}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
            >
              <div className="aspect-[2/3] rounded-lg mb-1.5 overflow-hidden border border-border shadow-sm relative">
                {book.has_cover ? (
                  <AuthenticatedImage
                    src={`${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/books/${book.id}/cover`}
                    alt={`${book.title} cover`}
                    className="w-full h-full object-cover"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/10 to-secondary">
                        <BookOpen className="w-8 h-8 text-primary/40" />
                      </div>
                    }
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/10 to-secondary">
                    <BookOpen className="w-8 h-8 text-primary/40" />
                  </div>
                )}
                {/* Processing overlay */}
                {book.is_processing && (
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg z-10">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mb-1.5" />
                    <span className="text-xs font-medium text-muted-foreground">{t('home.processing_status')}</span>
                  </div>
                )}
              </div>
              <h3 className="text-xs font-medium text-foreground truncate">{book.title}</h3>
              <p className="text-[10px] text-muted-foreground truncate">{book.author}</p>
            </m.div>
          ))}

          {/* "See all" link - same size as book cards */}
          <Link
            to="/library"
            className={cn(
              'aspect-[2/3] rounded-lg',
              'border-2 border-dashed border-border',
              'flex flex-col items-center justify-center gap-1.5',
              'text-muted-foreground hover:text-primary hover:border-primary/50',
              'transition-colors duration-200'
            )}
          >
            <ArrowRight className="w-5 h-5" />
            <span className="text-xs font-medium">{t('home.all_books')}</span>
          </Link>
        </div>
      </div>

      {/* Desktop: Horizontal scroll */}
      <div className="hidden sm:block relative overflow-hidden w-full">
        <div
          ref={scrollRef}
          className={cn(
            'flex gap-4 overflow-x-auto pb-4',
            'scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent'
          )}
        >
          {books.map((book, index) => (
            <m.div
              key={book.id}
              className={cn(
                'flex-shrink-0 w-32 md:w-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl',
                book.is_processing ? 'cursor-default' : 'cursor-pointer'
              )}
              onClick={() => !book.is_processing && navigate(`/book/${book.id}`)}
              role="button"
              tabIndex={book.is_processing ? -1 : 0}
              aria-label={book.is_processing ? `${book.title} - ${t('home.processing')}` : `${book.title} - ${book.author}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              whileHover={book.is_processing ? undefined : { y: -4 }}
            >
              <div
                className={cn(
                  'aspect-[2/3] rounded-xl mb-2 overflow-hidden relative',
                  'border border-border',
                  !book.is_processing && 'hover:border-primary/30',
                  'transition-all duration-200 shadow-sm',
                  !book.is_processing && 'hover:shadow-md'
                )}
              >
                {book.has_cover ? (
                  <AuthenticatedImage
                    src={`${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/books/${book.id}/cover`}
                    alt={`${book.title} cover`}
                    className="w-full h-full object-cover"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/10 to-secondary">
                        <BookOpen className="w-10 h-10 text-primary/40" />
                      </div>
                    }
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/10 to-secondary">
                    <BookOpen className="w-10 h-10 text-primary/40" />
                  </div>
                )}
                {/* Processing overlay */}
                {book.is_processing && (
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl z-10">
                    <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                    <span className="text-sm font-medium text-muted-foreground">{t('home.processing_status')}</span>
                  </div>
                )}
              </div>
              <h3 className="text-sm font-medium text-foreground truncate">{book.title}</h3>
              <p className="text-xs text-muted-foreground truncate">{book.author}</p>
              {book.reading_progress_percent > 0 && !book.is_processing && (
                <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min(book.reading_progress_percent, 100)}%` }}
                  />
                </div>
              )}
            </m.div>
          ))}

          {/* "See all" link */}
          <Link
            to="/library"
            className={cn(
              'flex-shrink-0 w-32 md:w-40 aspect-[2/3]',
              'rounded-xl border-2 border-dashed border-border',
              'flex flex-col items-center justify-center gap-2',
              'text-muted-foreground hover:text-primary hover:border-primary/50',
              'transition-colors duration-200'
            )}
          >
            <ArrowRight className="w-6 h-6" />
            <span className="text-sm font-medium">{t('home.all_books')}</span>
          </Link>
        </div>
      </div>
    </m.section>
  );
};
