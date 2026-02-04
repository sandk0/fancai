/**
 * AdminStats - Статистические карточки админ-панели
 *
 * Отображает 4 карточки с системной статистикой:
 * - Всего пользователей
 * - Всего книг
 * - Описаний
 * - Сгенерированных изображений
 *
 * @param stats - Системная статистика
 * @param isLoading - Индикатор загрузки
 * @param t - Функция перевода
 */

import React from 'react';
import { Users, BookOpen, Database, Image } from 'lucide-react';
import type { SystemStats } from '@/api/admin';

interface AdminStatsProps {
  stats: SystemStats | undefined;
  isLoading: boolean;
  t: (key: string) => string;
}

export const AdminStats: React.FC<AdminStatsProps> = ({ stats, isLoading, t }) => {
  const statCards = [
    {
      title: t('admin.totalUsers'),
      value: stats?.total_users || 0,
      icon: Users,
      color: 'blue'
    },
    {
      title: t('admin.totalBooks'),
      value: stats?.total_books || 0,
      icon: BookOpen,
      color: 'green'
    },
    {
      title: t('admin.descriptions'),
      value: stats?.total_descriptions || 0,
      icon: Database,
      color: 'purple'
    },
    {
      title: t('admin.generatedImages'),
      value: stats?.total_images || 0,
      icon: Image,
      color: 'orange'
    }
  ];

  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 w-full max-w-full"
      aria-busy={isLoading}
      aria-live="polite"
    >
      {statCards.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <div
            key={index}
            className="bg-card rounded-lg sm:rounded-xl p-2.5 sm:p-4 md:p-5 shadow-xs border border-border min-w-0 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs md:text-sm font-medium text-muted-foreground truncate">
                  {stat.title}
                </p>
                <p className="text-lg sm:text-xl md:text-2xl font-bold text-foreground">
                  {isLoading ? '...' : stat.value.toLocaleString()}
                </p>
              </div>
              <Icon className={`w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 flex-shrink-0 text-${stat.color}-500`} aria-hidden="true" />
            </div>
          </div>
        );
      })}
    </div>
  );
};
