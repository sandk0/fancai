import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Clock,
  TrendingUp,
  Award,
} from 'lucide-react';

interface StatsData {
  totalBooks: number;
  booksThisMonth: number;
  totalHours: number;
  hoursThisMonth: number;
  totalPages: number;
  pagesThisMonth: number;
}

interface StatsCardsProps {
  stats: StatsData;
}

export function StatsCards({ stats }: StatsCardsProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
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
             +{t('stats.hours_short', { count: stats.hoursThisMonth })} {t('stats.this_month')}
          </span>
        </div>
      </div>

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
  );
}
