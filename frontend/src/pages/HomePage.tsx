import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth';
import { booksAPI } from '@/api/books';
import { imagesAPI } from '@/api/images';
import { bookKeys } from '@/hooks/api/queryKeys';
import { PageMeta } from '@/components/SEO/PageMeta';
import {
  GuestHero,
  GuestFeatures,
  UserGreeting,
  ContinueReadingCard,
  RecentBooksSection,
  StatisticsSection,
} from '@/components/Home';

const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const { user, isAuthenticated } = useAuthStore();

  const { data: readingStats, isLoading: statsLoading } = useQuery({
    queryKey: ['userReadingStatistics'],
    queryFn: () => booksAPI.getUserReadingStatistics(),
    staleTime: 30000,
    enabled: isAuthenticated,
  });

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: bookKeys.homepage(user?.id ?? '', 20),
    queryFn: () => booksAPI.getBooks({ limit: 20, sort_by: 'accessed_desc' }),
    staleTime: 60000,
    refetchOnMount: 'always',
    refetchInterval: (query) => {
      const books = query.state.data?.books || [];
      return books.some((b) => b.is_processing) ? 5000 : false;
    },
    enabled: isAuthenticated && !!user?.id,
  });

  const { data: imagesStats, isLoading: imagesLoading } = useQuery({
    queryKey: ['userImagesStats'],
    queryFn: () => imagesAPI.getUserStats(),
    staleTime: 30000,
    enabled: isAuthenticated,
  });

  const totalBooks = readingStats?.total_books ?? 0;
  const totalHours = readingStats?.total_reading_time_minutes
    ? Math.round(readingStats.total_reading_time_minutes / 60)
    : 0;
  const totalDescriptions = imagesStats?.total_descriptions_found ?? 0;
  const totalImages = imagesStats?.total_images_generated ?? 0;

  const booksInProgress =
    booksData?.books.filter((book) => {
      const progress = book.reading_progress_percent ?? 0;
      return progress >= 0.1 && progress < 100;
    }) ?? [];

  const recentBooks = booksData?.books.slice(0, 10) ?? [];
  const continueBook = booksInProgress[0] ?? null;

  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-4 lg:py-6 overflow-x-hidden">
        <PageMeta title={t('home.page_title')} description={t('home.page_description')} />
        <GuestHero />
        <GuestFeatures />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8 overflow-x-hidden">
      <PageMeta title={t('home.page_title')} description={t('home.page_description')} />
      <UserGreeting userName={user?.full_name} />

      <ContinueReadingCard book={continueBook} isLoading={booksLoading} />

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
