import { useTranslation } from 'react-i18next';
import {
  Flame,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WeeklyDay {
  day: string;
  minutes: number;
  label: string;
}

interface GenreItem {
  genre: string;
  count: number;
  percentage: number;
  color: string;
}

interface TopBook {
  title: string;
  author: string;
  hours: number;
  progress: number;
}

interface ReadingStreakProps {
  currentStreak: number;
  longestStreak: number;
  averagePerDay: number;
}

interface WeeklyActivityProps {
  weeklyActivity: WeeklyDay[];
  maxMinutes: number;
}

interface GenreDistributionProps {
  genreDistribution: GenreItem[];
}

interface TopBooksProps {
  topBooks: TopBook[];
}

export function ReadingStreak({ currentStreak, longestStreak, averagePerDay }: ReadingStreakProps) {
  const { t } = useTranslation();

  return (
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
              {currentStreak}
            </span>
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {t('stats.current_streak')}
          </p>
        </div>

        <div className="text-center">
          <div className="w-24 h-24 rounded-full flex items-center justify-center mb-3 border-4 border-border bg-muted">
            <span className="text-3xl font-bold text-foreground">
              {longestStreak}
            </span>
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {t('stats.best_streak')}
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-muted">
        <p className="text-center font-medium text-foreground">
          {t('stats.avg_per_day', { count: averagePerDay })}
        </p>
      </div>
    </div>
  );
}

export function WeeklyActivity({ weeklyActivity, maxMinutes }: WeeklyActivityProps) {
  const { t } = useTranslation();

  return (
    <div className="p-6 rounded-xl border-2 border-border bg-card">
      <div className="flex items-center gap-3 mb-6">
        <Calendar className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold text-foreground">
          {t('stats.weekly_activity')}
        </h2>
      </div>

      {weeklyActivity.every((d) => d.minutes === 0) ? (
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
  );
}

export function GenreDistribution({ genreDistribution }: GenreDistributionProps) {
  const { t } = useTranslation();

  return (
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
  );
}

export function TopBooks({ topBooks }: TopBooksProps) {
  const { t } = useTranslation();

  return (
    <div className="p-6 rounded-xl border-2 border-border bg-card">
      <h2 className="text-xl font-bold mb-6 text-foreground">
        {t('stats.top_books_title')}
      </h2>

      <div className="space-y-4">
        {topBooks.map((book, index) => (
          <div
            key={index}
            className="p-4 rounded-xl transition-all hover:scale-[102%] bg-muted"
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
                  {book.author} &bull; {t('stats.hours_short', { count: book.hours })}
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
  );
}
