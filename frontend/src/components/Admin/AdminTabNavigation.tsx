/**
 * AdminTabNavigation - Навигация по табам админ-панели
 *
 * Отображает:
 * - Навигационные табы (Overview, NLP, Parsing, Images, System, Users)
 * - Активный таб с подсветкой
 * - Иконки для каждого таба
 *
 * @param activeTab - Текущий активный таб
 * @param onTabChange - Callback при изменении таба
 * @param t - Функция перевода
 */

import React from 'react';
import { Activity, Cpu, Database, Image, Server, Users, GitMerge } from 'lucide-react';

export type AdminTab = 'overview' | 'nlp' | 'parsing' | 'images' | 'system' | 'users' | 'entities';

interface AdminTabNavigationProps {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  t: (key: string) => string;
}

export const AdminTabNavigation: React.FC<AdminTabNavigationProps> = ({
  activeTab,
  onTabChange,
  t,
}) => {
  const tabs = [
    { id: 'overview' as AdminTab, name: t('admin.overview'), icon: Activity },
    { id: 'nlp' as AdminTab, name: t('admin.multiNlpSettings'), icon: Cpu },
    { id: 'parsing' as AdminTab, name: t('admin.parsing'), icon: Database },
    { id: 'entities' as AdminTab, name: t('admin.entities'), icon: GitMerge },
    { id: 'images' as AdminTab, name: t('admin.images'), icon: Image },
    { id: 'system' as AdminTab, name: t('admin.system'), icon: Server },
    { id: 'users' as AdminTab, name: t('admin.users'), icon: Users }
  ];

  return (
    <div className="mb-4 sm:mb-6 md:mb-8 border-b border-border">
      <div className="overflow-x-auto pb-px scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0 overscroll-x-contain">
        <nav className="-mb-px flex space-x-1 sm:space-x-2 md:space-x-4" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`group inline-flex items-center gap-1.5 sm:gap-2 py-3 sm:py-4 px-1 border-b-2 font-medium text-xs sm:text-sm whitespace-nowrap ${
                  isActive
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                {tab.name}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};
