import React from 'react';
import { useTranslation } from 'react-i18next';
import { m } from 'framer-motion';
import { Clock, BarChart3, Library, FileText, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fadeInUp, staggerContainer } from '@/components/Home/constants';
import { SkeletonStatCard } from '@/components/Home/Skeletons';

interface StatisticsSectionProps {
  stats: {
    totalBooks: number;
    totalHours: number;
    totalDescriptions: number;
    totalImages: number;
  };
  isLoading: boolean;
}

export const StatisticsSection: React.FC<StatisticsSectionProps> = ({ stats, isLoading }) => {
  const { t } = useTranslation();

  const statItems = [
    {
      label: t('home.stats.books_in_library'),
      value: stats.totalBooks,
      icon: Library,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: t('home.stats.hours_reading'),
      value: stats.totalHours,
      icon: Clock,
      color: 'text-info',
      bgColor: 'bg-info/10',
    },
    {
      label: t('home.stats.descriptions_found'),
      value: stats.totalDescriptions,
      icon: FileText,
      color: 'text-success',
      bgColor: 'bg-success/10',
    },
    {
      label: t('home.stats.images_created'),
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
          {t('home.stats.title')}
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
          {t('home.stats.title')}
        </h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 w-full">
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
