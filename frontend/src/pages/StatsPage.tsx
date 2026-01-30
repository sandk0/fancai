/**
 * StatsPage - Reading statistics and analytics
 *
 * Features:
 * - Reading statistics (books, time, pages)
 * - Reading streak calendar
 * - Genre distribution
 * - Reading goals progress
 * - Reading activity chart (mock bar chart with CSS)
 * - Top books by reading time
 * - Achievements/badges
 * - Fully theme-aware (Light/Dark/Sepia)
 * - Responsive design
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
   BarChart3,
   BookOpen,
   Clock,
   TrendingUp,
   Award,
   Target,
   Calendar,
   Zap,
   Star,
   Flame,
 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { booksAPI } from '@/api/books';
import { formatReadingTime } from '@/utils/formatters';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import ErrorMessage from '@/components/UI/ErrorMessage';

const StatsPage: React.FC = () => {
   const { t } = useTranslation();
   // Fetch detailed user statistics (including weekly activity)
   const { data: detailedStats, isLoading: statsLoading, error: statsError } = useQuery({
     queryKey: ['user-reading-statistics'],
     queryFn: () => booksAPI.getUserReadingStatistics(),
   });

  // Fetch all books for additional stats (genre distribution, top books)
  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['books-for-stats'],
    queryFn: () => booksAPI.getBooks({ skip: 0, limit: 100 }),
  });

  // Calculate stats from API data
  const stats = useMemo(() => {
    if (!detailedStats) {
      return {
        totalBooks: 0,
        booksThisMonth: 0,
        totalHours: 0,
        hoursThisMonth: 0,
        totalPages: 0,
        pagesThisMonth: 0,
        currentStreak: 0,
        longestStreak: 0,
        averagePerDay: 0,
      };
    }

    const s = detailedStats;

    // Используем унифицированную метрику из API
    // Формула на бэкенде: total_minutes / days_with_reading_activity
    const avgMinutesPerDay = s.avg_minutes_per_day || 0;

    // Monthly stats from backend API
    const hoursThisMonth = Math.round((s.reading_time_this_month || 0) / 60);

    return {
      totalBooks: s.total_books || 0,
      booksThisMonth: s.books_this_month || 0,
      totalHours: Math.round((s.total_reading_time_minutes || 0) / 60),
      hoursThisMonth,
      totalPages: s.total_pages_read || (s.total_chapters_read * 20) || 0,
      pagesThisMonth: s.pages_this_month || 0,
      currentStreak: s.reading_streak_days || 0,
      longestStreak: s.longest_streak_days || s.reading_streak_days || 0,
      averagePerDay: avgMinutesPerDay,
    };
  }, [detailedStats]);

  // Genre distribution from books
  const genreDistribution = useMemo(() => {
    if (!booksData?.books) return [];

    const genreCounts = booksData.books.reduce((acc, book) => {
      const genre = book.genre || 'Другое';
      acc[genre] = (acc[genre] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const total = booksData.books.length;
    const colors = ['bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-green-500', 'bg-muted-foreground'];

    return Object.entries(genreCounts)
      .map(([genre, count], idx) => ({
        genre,
        count,
        percentage: Math.round((count / total) * 100),
        color: colors[idx % colors.length],
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [booksData]);

  // Top books by reading time (estimated from progress)
  const topBooks = useMemo(() => {
    if (!booksData?.books) return [];

    return booksData.books
      .map((book) => ({
        title: book.title,
        author: book.author,
        hours: Math.round(book.estimated_reading_time_hours * (book.reading_progress_percent / 100)),
        progress: Math.round(book.reading_progress_percent),
      }))
      .filter((book) => book.hours > 0)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5);
  }, [booksData]);

   // Achievements based on real stats
   const achievements = useMemo(() => {
     const totalBooks = stats.totalBooks;
     const streak = stats.currentStreak;
     const hoursPerDay = stats.totalHours / Math.max(1, streak);

     return [
       { name: t('stats.achievement_first_book'), description: t('stats.achievement_first_book_desc'), icon: BookOpen, earned: totalBooks >= 1 },
       { name: t('stats.achievement_marathoner'), description: t('stats.achievement_marathoner_desc'), icon: Flame, earned: streak >= 7 },
       { name: t('stats.achievement_bookworm'), description: t('stats.achievement_bookworm_desc'), icon: Star, earned: totalBooks >= 10 },
       { name: t('stats.achievement_determined'), description: t('stats.achievement_determined_desc'), icon: Target, earned: stats.booksThisMonth >= 5 },
       { name: t('stats.achievement_sprinter'), description: t('stats.achievement_sprinter_desc'), icon: Zap, earned: hoursPerDay >= 3 },
       { name: t('stats.achievement_legend'), description: t('stats.achievement_legend_desc'), icon: Award, earned: totalBooks >= 50 },
     ];
   }, [stats, t]);

  // Weekly activity from API
  const weeklyActivity = useMemo(() => {
    if (!detailedStats?.weekly_activity || detailedStats.weekly_activity.length === 0) {
      // Если нет данных - возвращаем 7 дней с нулями
      return Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i)); // От 6 дней назад до сегодня
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        return {
          day: days[date.getDay()],
          minutes: 0,
          label: '0 мин'
        };
      });
    }

    // Используем данные из API
    return detailedStats.weekly_activity.map(day => ({
      day: day.day,
      minutes: day.minutes,
      label: formatReadingTime(day.minutes),
    }));
  }, [detailedStats]);

  const maxMinutes = Math.max(...weeklyActivity.map((d) => d.minutes), 1); // Минимум 1 для избежания деления на 0

   if (statsLoading || booksLoading) {
     return (
       <div className="flex items-center justify-center min-h-64">
         <LoadingSpinner size="lg" text={t('stats.loading')} />
       </div>
     );
   }

   if (statsError) {
     return (
       <div className="flex items-center justify-center min-h-64">
         <ErrorMessage
           title={t('stats.error_title')}
           message={t('stats.error_message')}
         />
       </div>
     );
   }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
       {/* Header */}
       <div className="mb-8">
         <div className="flex items-center gap-3 mb-3">
           <BarChart3 className="w-8 h-8 text-primary" />
           <h1 className="fluid-h2 font-bold text-foreground">
             {t('stats.title')}
           </h1>
         </div>
         <p className="text-lg text-muted-foreground">
           {t('stats.subtitle')}
         </p>
       </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
         {/* Books */}
         <div className="p-6 rounded-xl border-2 border-border bg-card transition-all hover:-translate-y-1 hover:shadow-xl">
           <div className="flex items-center justify-between mb-4">
             <BookOpen className="w-10 h-10 text-primary" />
             <div className="text-right">
               <p className="text-4xl font-bold text-foreground">
                 {stats.totalBooks}
               </p>
               <p className="text-sm font-medium text-muted-foreground">
                 {t('stats.total_books')}
               </p>
             </div>
           </div>
           <div className="flex items-center gap-2">
             <TrendingUp className="w-4 h-4 text-green-600" />
             <span className="text-sm font-medium text-green-600">
               +{stats.booksThisMonth} {t('stats.this_month')}
             </span>
           </div>
         </div>

         {/* Hours */}
         <div className="p-6 rounded-xl border-2 border-border bg-card transition-all hover:-translate-y-1 hover:shadow-xl">
           <div className="flex items-center justify-between mb-4">
             <Clock className="w-10 h-10 text-purple-600" />
             <div className="text-right">
               <p className="text-4xl font-bold text-foreground">
                 {stats.totalHours}
               </p>
               <p className="text-sm font-medium text-muted-foreground">
                 {t('stats.hours_reading')}
               </p>
             </div>
           </div>
           <div className="flex items-center gap-2">
             <TrendingUp className="w-4 h-4 text-green-600" />
             <span className="text-sm font-medium text-green-600">
               +{stats.hoursThisMonth}ч {t('stats.this_month')}
             </span>
           </div>
         </div>

         {/* Pages */}
         <div className="p-6 rounded-xl border-2 border-border bg-card transition-all hover:-translate-y-1 hover:shadow-xl">
           <div className="flex items-center justify-between mb-4">
             <Award className="w-10 h-10 text-amber-600" />
             <div className="text-right">
               <p className="text-4xl font-bold text-foreground">
                 {stats.totalPages.toLocaleString()}
               </p>
               <p className="text-sm font-medium text-muted-foreground">
                 {t('stats.pages_read')}
               </p>
             </div>
           </div>
           <div className="flex items-center gap-2">
             <TrendingUp className="w-4 h-4 text-green-600" />
             <span className="text-sm font-medium text-green-600">
               +{stats.pagesThisMonth} {t('stats.this_month')}
             </span>
           </div>
         </div>
       </div>

      {/* Streak and Weekly Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
         {/* Reading Streak */}
         <div className="p-6 rounded-xl border-2 border-border bg-card">
           <div className="flex items-center gap-3 mb-6">
             <Flame className="w-6 h-6 text-primary" />
             <h2 className="text-xl font-bold text-foreground">
               {t('stats.streak_title')}
             </h2>
           </div>

           <div className="flex items-center justify-around mb-6">
             <div className="text-center">
               <div className="w-24 h-24 rounded-full flex items-center justify-center mb-3 border-4 border-primary bg-muted">
                 <span className="text-3xl font-bold text-primary">
                   {stats.currentStreak}
                 </span>
               </div>
               <p className="text-sm font-medium text-muted-foreground">
                 {t('stats.current_streak')}
               </p>
             </div>

             <div className="text-center">
               <div className="w-24 h-24 rounded-full flex items-center justify-center mb-3 border-4 border-border bg-muted">
                 <span className="text-3xl font-bold text-foreground">
                   {stats.longestStreak}
                 </span>
               </div>
               <p className="text-sm font-medium text-muted-foreground">
                 {t('stats.best_streak')}
               </p>
             </div>
           </div>

           <div className="p-4 rounded-xl bg-muted">
             <p className="text-center font-medium text-foreground">
               {t('stats.avg_per_day', { count: stats.averagePerDay })}
             </p>
           </div>
         </div>

         {/* Weekly Activity Chart */}
         <div className="p-6 rounded-xl border-2 border-border bg-card">
           <div className="flex items-center gap-3 mb-6">
             <Calendar className="w-6 h-6 text-primary" />
             <h2 className="text-xl font-bold text-foreground">
               {t('stats.weekly_activity')}
             </h2>
           </div>

           {weeklyActivity.every((d) => d.minutes === 0) ? (
             // Empty state - no reading activity
             <div className="h-48 flex flex-col items-center justify-center">
               <Calendar className="w-12 h-12 mb-3 text-muted-foreground opacity-30" />
               <p className="text-center font-medium text-muted-foreground">
                 {t('stats.no_weekly_data')}
               </p>
               <p className="text-sm text-center mt-2 text-muted-foreground opacity-70">
                 {t('stats.no_weekly_hint')}
               </p>
             </div>
           ) : (
            // Chart with data
            <div className="flex items-end justify-between gap-2 h-48" role="img" aria-label="Weekly reading activity chart">
              {weeklyActivity.map((day, index) => (
                <div key={index} className="flex-1 flex flex-col items-center gap-2">
                  <div className="relative flex-1 w-full flex flex-col justify-end">
                    <div
                      className="w-full rounded-t-lg transition-all hover:opacity-80 bg-primary"
                      style={{
                        height: `${(day.minutes / maxMinutes) * 100}%`,
                        minHeight: day.minutes > 0 ? '8px' : '0',
                      }}
                      role="presentation"
                      aria-hidden="true"
                    />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground" aria-label={`${day.day}: ${day.label}`}>
                    {day.day}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Genre Distribution and Top Books */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
         {/* Genre Distribution */}
         <div className="p-6 rounded-xl border-2 border-border bg-card">
           <h2 className="text-xl font-bold mb-6 text-foreground">
             {t('stats.genres_title')}
           </h2>

          <div className="space-y-4">
            {genreDistribution.map((genre, index) => (
              <div key={index}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-foreground">
                    {genre.genre}
                  </span>
                   <span className="text-sm font-medium text-muted-foreground">
                     {genre.count} {t('stats.books_unit')} ({genre.percentage}%)
                   </span>
                </div>
                <div className="h-3 rounded-full overflow-hidden bg-muted">
                  <div
                    className={cn('h-full rounded-full transition-all', genre.color)}
                    style={{ width: `${genre.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

         {/* Top Books */}
         <div className="p-6 rounded-xl border-2 border-border bg-card">
           <h2 className="text-xl font-bold mb-6 text-foreground">
             {t('stats.top_books_title')}
           </h2>

          <div className="space-y-4">
            {topBooks.map((book, index) => (
              <div
                key={index}
                className="p-4 rounded-xl transition-all hover:scale-[1.02] bg-muted"
              >
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-primary-foreground bg-primary">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold mb-1 truncate text-foreground">
                      {book.title}
                    </h3>
                    <p className="text-sm mb-2 text-muted-foreground">
                      {book.author} • {book.hours}ч
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full overflow-hidden bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${book.progress}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">
                        {book.progress}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

       {/* Achievements */}
       <div className="p-6 rounded-xl border-2 border-border bg-card">
         <div className="flex items-center gap-3 mb-6">
           <Award className="w-6 h-6 text-primary" />
           <h2 className="text-xl font-bold text-foreground">
             {t('stats.achievements_title')}
           </h2>
         </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {achievements.map((achievement, index) => (
            <div
              key={index}
              className={cn(
                'p-4 rounded-xl border-2 transition-all',
                achievement.earned
                  ? 'hover:-translate-y-1 bg-muted border-primary'
                  : 'opacity-50 bg-secondary border-border'
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'p-2 rounded-lg',
                    achievement.earned ? 'bg-primary' : 'bg-muted'
                  )}
                >
                  <achievement.icon
                    className={cn(
                      'w-6 h-6',
                      achievement.earned ? 'text-primary-foreground' : 'text-muted-foreground'
                    )}
                  />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1 text-foreground">
                    {achievement.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {achievement.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StatsPage;
