import { useTranslation } from 'react-i18next';
import { Award } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface Achievement {
  name: string;
  description: string;
  icon: LucideIcon;
  earned: boolean;
}

interface AchievementsListProps {
  achievements: Achievement[];
}

export function AchievementsList({ achievements }: AchievementsListProps) {
  const { t } = useTranslation();

  return (
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
  );
}
