/**
 * HomePage - Redesigned with hero section, continue reading, and user statistics
 *
 * Features:
 * - Hero section for guests with CTA
 * - Personalized greeting for authenticated users
 * - "Continue reading" featured book card
 * - "Recently added" horizontal scroll section
 * - Reading statistics dashboard
 * - Skeleton loading states
 * - Mobile-first responsive design
 * - Framer Motion animations
 */

import React, { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { m } from 'framer-motion';
import {
  BookOpen,
  Upload,
  Clock,
  BarChart3,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Library,
  FileText,
  Wand2,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useUIStore } from '@/stores/ui';
import { booksAPI } from '@/api/books';
import { imagesAPI } from '@/api/images';
import { cn } from '@/lib/utils';
import { AuthenticatedImage } from '@/components/UI/AuthenticatedImage';
import type { Book } from '@/types/api';

// Animation variants
const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const scaleOnHover = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
};

// Time-based greeting
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}

// Skeleton components
const SkeletonCard: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('animate-pulse rounded-xl bg-muted', className)} />
);

const SkeletonBookCard: React.FC = () => (
  <div className="sm:flex-shrink-0 sm:w-32 md:w-40">
    <SkeletonCard className="aspect-[2/3] mb-1.5 sm:mb-2 rounded-lg sm:rounded-xl" />
    <SkeletonCard className="h-3 sm:h-4 w-3/4 mb-1" />
    <SkeletonCard className="h-2.5 sm:h-3 w-1/2" />
  </div>
);

const SkeletonStatCard: React.FC = () => (
  <div className="p-2.5 sm:p-3 md:p-4 rounded-lg sm:rounded-xl border border-border bg-card animate-pulse min-w-0">
    <SkeletonCard className="h-5 w-5 sm:h-6 sm:w-6 md:h-8 md:w-8 rounded-md sm:rounded-lg mb-1.5 sm:mb-2 md:mb-3" />
    <SkeletonCard className="h-5 sm:h-6 md:h-8 w-10 sm:w-12 md:w-16 mb-1 sm:mb-1.5 md:mb-2" />
    <SkeletonCard className="h-3 w-14 sm:w-16 md:w-24" />
  </div>
);

// Hero section for guests
const GuestHero: React.FC = () => {
  const navigate = useNavigate();

  return (
    <m.section
      className="relative overflow-hidden rounded-xl mb-8 sm:mb-12"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/10 to-secondary" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(251,191,36,0.15),transparent_50%)]" />

      <div className="relative px-4 sm:px-6 md:px-10 py-8 sm:py-12 md:py-16 lg:py-24">
        <div className="max-w-3xl mx-auto text-center">
          <m.div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">AI-визуализация книг</span>
          </m.div>

          <m.h1
            className="fluid-h1 font-bold mb-4 sm:mb-6 text-foreground"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            Читайте книги с{' '}
            <span className="bg-gradient-to-r from-primary via-amber-500 to-orange-500 bg-clip-text text-transparent">
              AI-иллюстрациями
            </span>
          </m.h1>

          <m.p
            className="text-base sm:text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            Загружайте любимые книги и наслаждайтесь автоматически сгенерированными
            иллюстрациями к каждому описанию. Искусственный интеллект оживит ваше чтение.
          </m.p>

          <m.div
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <m.button
              onClick={() => navigate('/register')}
              className={cn(
                'group inline-flex items-center justify-center gap-2 w-full sm:w-auto',
                'px-6 py-3.5 rounded-xl font-semibold text-base',
                'bg-primary text-primary-foreground',
                'shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40',
                'transition-all duration-200'
              )}
              {...scaleOnHover}
            >
              <BookOpen className="w-5 h-5" />
              <span>Начать бесплатно</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </m.button>

            <m.button
              onClick={() => navigate('/login')}
              className={cn(
                'inline-flex items-center justify-center gap-2 w-full sm:w-auto',
                'px-6 py-3.5 rounded-xl font-semibold text-base',
                'border-2 border-border bg-background text-foreground',
                'hover:border-primary hover:bg-accent',
                'transition-all duration-200'
              )}
              {...scaleOnHover}
            >
              <span>Войти</span>
            </m.button>
          </m.div>
        </div>
      </div>
    </m.section>
  );
};

// User greeting section
const UserGreeting: React.FC<{ userName?: string }> = ({ userName }) => {
  const setShowUploadModal = useUIStore((state) => state.setShowUploadModal);

  return (
    <m.section
      className="mb-8 sm:mb-10"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="fluid-h2 font-bold text-foreground">
            {getGreeting()}, {userName || 'Читатель'}!
          </h1>
          <p className="text-muted-foreground mt-1">
            Что будем читать сегодня?
          </p>
        </div>

        <div className="flex gap-3">
          <Link
            to="/library"
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl',
              'bg-secondary text-secondary-foreground font-medium',
              'hover:bg-secondary/80 transition-colors'
            )}
          >
            <Library className="w-4 h-4" />
            <span className="hidden sm:inline">Библиотека</span>
          </Link>

          <m.button
            onClick={() => setShowUploadModal(true)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl',
              'bg-primary text-primary-foreground font-medium',
              'hover:bg-primary/90 transition-colors'
            )}
            {...scaleOnHover}
          >
            <Upload className="w-4 h-4" />
            <span>Загрузить</span>
          </m.button>
        </div>
      </div>
    </m.section>
  );
};

// Continue reading card
const ContinueReadingCard: React.FC<{ book: Book; isLoading: boolean }> = ({
  book,
  isLoading,
}) => {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="mb-8 sm:mb-10" aria-busy="true" aria-live="polite">
        <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-4">
          Продолжить чтение
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
        Продолжить чтение
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
          ? `${book.title} - обработка`
          : `Continue reading ${book.title} by ${book.author}, ${Math.round(book.reading_progress_percent)}% complete`
        }
        className={cn(
          'relative overflow-hidden rounded-xl',
          isClickable ? 'cursor-pointer' : 'cursor-default',
          'bg-gradient-to-r from-card via-card to-accent/20',
          'border border-border',
          isClickable && 'hover:border-primary/50',
          'transition-all duration-300',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        )}
        whileHover={isClickable ? { scale: 1.01 } : undefined}
        whileTap={isClickable ? { scale: 0.99 } : undefined}
      >
        {/* Processing overlay */}
        {book.is_processing && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl z-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
            <span className="text-sm font-medium text-muted-foreground">Обработка...</span>
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
                <span>Прогресс</span>
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
              {book.chapters_count} глав
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

// Recent books grid (mobile: 2 columns, desktop: horizontal scroll)
const RecentBooksSection: React.FC<{ books: Book[]; isLoading: boolean }> = ({
  books,
  isLoading,
}) => {
  const navigate = useNavigate();
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
          Недавно добавленные
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

  // Limit books on mobile to 4 + "See all" card
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
          Недавно добавленные
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
              aria-label={book.is_processing ? `${book.title} - обработка` : `Open ${book.title} by ${book.author}`}
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
                    <span className="text-xs font-medium text-muted-foreground">Обработка...</span>
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
            <span className="text-xs font-medium">Все книги</span>
          </Link>
        </div>
      </div>

      {/* Desktop: Horizontal scroll */}
      <div className="hidden sm:block relative">
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
              aria-label={book.is_processing ? `${book.title} - обработка` : `Open ${book.title} by ${book.author}`}
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
                    <span className="text-sm font-medium text-muted-foreground">Обработка...</span>
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
            <span className="text-sm font-medium">Все книги</span>
          </Link>
        </div>
      </div>
    </m.section>
  );
};

// Statistics section
const StatisticsSection: React.FC<{
  stats: {
    totalBooks: number;
    totalHours: number;
    totalDescriptions: number;
    totalImages: number;
  };
  isLoading: boolean;
}> = ({ stats, isLoading }) => {
  const statItems = [
    {
      label: 'Книг в библиотеке',
      value: stats.totalBooks,
      icon: Library,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: 'Часов чтения',
      value: stats.totalHours,
      icon: Clock,
      color: 'text-info',
      bgColor: 'bg-info/10',
    },
    {
      label: 'Описаний найдено',
      value: stats.totalDescriptions,
      icon: FileText,
      color: 'text-success',
      bgColor: 'bg-success/10',
    },
    {
      label: 'Изображений создано',
      value: stats.totalImages,
      icon: Wand2,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
    },
  ];

  if (isLoading) {
    return (
      <section className="mb-8 sm:mb-10" aria-busy="true" aria-live="polite">
        <h2 className="text-base sm:text-lg md:text-xl font-semibold text-foreground mb-3 sm:mb-4">
          Статистика чтения
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonStatCard key={i} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <m.section
      className="mb-8 sm:mb-10"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
        <h2 className="text-base sm:text-lg md:text-xl font-semibold text-foreground">
          Статистика чтения
        </h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
        {statItems.map((item, index) => (
          <m.div
            key={item.label}
            className={cn(
              'p-2.5 sm:p-3 md:p-4 rounded-lg sm:rounded-xl border border-border bg-card min-w-0 overflow-hidden',
              'hover:border-primary/30 hover:shadow-sm',
              'transition-all duration-200'
            )}
            variants={fadeInUp}
            custom={index}
            whileHover={{ y: -2 }}
          >
            <div className={cn('inline-flex p-1 sm:p-1.5 md:p-2 rounded-md sm:rounded-lg mb-1.5 sm:mb-2 md:mb-3', item.bgColor)}>
              <item.icon className={cn('w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5', item.color)} />
            </div>

            <div className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold text-foreground truncate">
              {item.value}
            </div>

            <div className="text-[10px] sm:text-[11px] md:text-xs lg:text-sm text-muted-foreground truncate">
              {item.label}
            </div>
          </m.div>
        ))}
      </div>
    </m.section>
  );
};

// Main HomePage component
const HomePage: React.FC = () => {
  const { user, isAuthenticated } = useAuthStore();

  // Fetch user reading statistics
  const { data: readingStats, isLoading: statsLoading } = useQuery({
    queryKey: ['userReadingStatistics'],
    queryFn: () => booksAPI.getUserReadingStatistics(),
    staleTime: 30000,
    enabled: isAuthenticated,
  });

  // Fetch books for recent activity with polling for processing books
  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['books', 'homepage'],
    queryFn: () => booksAPI.getBooks({ limit: 20, sort_by: 'accessed_desc' }),
    staleTime: 60000, // 1 minute
    refetchOnMount: 'always',
    refetchInterval: (query) => {
      const books = query.state.data?.books || [];
      return books.some((b) => b.is_processing) ? 5000 : false;
    },
    enabled: isAuthenticated,
  });

  // Fetch user images stats
  const { data: imagesStats, isLoading: imagesLoading } = useQuery({
    queryKey: ['userImagesStats'],
    queryFn: () => imagesAPI.getUserStats(),
    staleTime: 30000,
    enabled: isAuthenticated,
  });

  // Calculate stats
  const totalBooks = readingStats?.total_books ?? 0;
  const totalHours = readingStats?.total_reading_time_minutes
    ? Math.round(readingStats.total_reading_time_minutes / 60)
    : 0;
  const totalDescriptions = imagesStats?.total_descriptions_found ?? 0;
  const totalImages = imagesStats?.total_images_generated ?? 0;

  // Get books in progress (for continue reading)
  const booksInProgress =
    booksData?.books.filter((book) => {
      const progress = book.reading_progress_percent ?? 0;
      return progress >= 0.1 && progress < 100;
    }) ?? [];

  // Get recently added books (sorted by created_at)
  const recentBooks = booksData?.books.slice(0, 10) ?? [];

  // Get the most recently accessed book in progress
  const continueBook = booksInProgress[0] ?? null;

  // Guest view
  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-4 lg:py-6 overflow-x-hidden">
        <GuestHero />

        {/* Feature highlights for guests */}
        <m.section
          className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          {[
            {
              icon: BookOpen,
              title: 'Загрузите книгу',
              description: 'EPUB и FB2 форматы поддерживаются',
            },
            {
              icon: Sparkles,
              title: 'AI найдет описания',
              description: 'Автоматическое распознавание локаций и персонажей',
            },
            {
              icon: Wand2,
              title: 'Получите иллюстрации',
              description: 'Уникальные изображения к каждому описанию',
            },
          ].map((feature, index) => (
            <m.div
              key={feature.title}
              className={cn(
                'p-6 rounded-xl border border-border bg-card',
                'text-center'
              )}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
            >
              <div className="inline-flex p-3 rounded-xl bg-primary/10 mb-4">
                <feature.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </m.div>
          ))}
        </m.section>
      </div>
    );
  }

  // Authenticated user view
  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8 overflow-x-hidden">
      <UserGreeting userName={user?.full_name} />

      <ContinueReadingCard book={continueBook!} isLoading={booksLoading} />

      <RecentBooksSection books={recentBooks} isLoading={booksLoading} />

      <StatisticsSection
        stats={{
          totalBooks,
          totalHours,
          totalDescriptions,
          totalImages,
        }}
        isLoading={statsLoading || imagesLoading}
      />
    </div>
  );
};

export default HomePage;
