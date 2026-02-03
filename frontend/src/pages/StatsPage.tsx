import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
   BarChart3,
   BookOpen,
   Target,
   Zap,
   Star,
   Flame,
   Award,
 } from 'lucide-react';
import { booksAPI } from '@/api/books';
import { formatReadingTime } from '@/utils/formatters';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import ErrorMessage from '@/components/UI/ErrorMessage';
import { PageMeta } from '@/components/SEO/PageMeta';
import { StatsCards } from '@/components/Stats/StatsCards';
import { ReadingStreak, WeeklyActivity, GenreDistribution, TopBooks } from '@/components/Stats/ReadingChart';
import { AchievementsList } from '@/components/Stats/AchievementsList';

const StatsPage: React.FC = () => {
   const { t } = useTranslation();

   const { data: detailedStats, isLoading: statsLoading, error: statsError } = useQuery({
     queryKey: ['user-reading-statistics'],
     queryFn: () => booksAPI.getUserReadingStatistics(),
   });

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['books-for-stats'],
    queryFn: () => booksAPI.getBooks({ skip: 0, limit: 100 }),
  });

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
    const avgMinutesPerDay = s.avg_minutes_per_day || 0;
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

  const genreDistribution = useMemo(() => {
    if (!booksData?.books) return [];

    const genreCounts = booksData.books.reduce((acc, book) => {
      const genre = book.genre || t('stats.genre_other');
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
  }, [booksData, t]);

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

  const weeklyActivity = useMemo(() => {
    if (!detailedStats?.weekly_activity || detailedStats.weekly_activity.length === 0) {
      return Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        const dayKeys = ['day_sun', 'day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat'];
        return {
          day: t(`stats.${dayKeys[date.getDay()]}`),
          minutes: 0,
          label: t('stats.zero_minutes'),
        };
      });
    }

    return detailedStats.weekly_activity.map(day => ({
      day: day.day,
      minutes: day.minutes,
      label: formatReadingTime(day.minutes),
    }));
  }, [detailedStats, t]);

  const maxMinutes = Math.max(...weeklyActivity.map((d) => d.minutes), 1);

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
        <PageMeta title={t('stats.page_title')} description={t('stats.page_description')} />
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

      <StatsCards stats={stats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        <ReadingStreak
          currentStreak={stats.currentStreak}
          longestStreak={stats.longestStreak}
          averagePerDay={stats.averagePerDay}
        />
        <WeeklyActivity
          weeklyActivity={weeklyActivity}
          maxMinutes={maxMinutes}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        <GenreDistribution genreDistribution={genreDistribution} />
        <TopBooks topBooks={topBooks} />
      </div>

      <AchievementsList achievements={achievements} />
    </div>
  );
};

export default StatsPage;
