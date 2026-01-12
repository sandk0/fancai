/**
 * SettingsPage - Unified settings page with reusable section components
 *
 * Features:
 * - Tab-based navigation with icons (desktop sidebar)
 * - Accordion navigation (mobile)
 * - Unified section components with compact/full modes
 * - Smooth viewport transitions via CSS
 * - Fully theme-aware (Light/Dark/Sepia)
 *
 * Architecture:
 * - Each section is a standalone component with `compact` prop
 * - Desktop: renders section with compact=false
 * - Mobile: renders section with compact=true inside accordion
 * - No content duplication between viewport variants
 */

import React, { useState } from 'react';
import {
  User,
  Bell,
  Shield,
  Info,
  Smartphone,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Accordion, type AccordionItem } from '@/components/UI/Accordion';

// Unified section components
import {
  AccountSettingsSection,
  ReadingSettingsSection,
  NotificationsSettingsSection,
  PrivacySettingsSection,
  PWASettingsSection,
  AboutSettingsSection,
} from '@/components/Settings/sections';

type SettingsTab = 'account' | 'reading' | 'notifications' | 'privacy' | 'pwa' | 'about';

interface TabConfig {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Desktop content (full mode) */
  content: React.ReactNode;
  /** Mobile content (compact mode) */
  compactContent: React.ReactNode;
}

const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const { t } = useTranslation();

  // Tab configuration with unified section components
  const tabs: TabConfig[] = [
    {
      id: 'account',
      label: 'Аккаунт',
      icon: User,
      description: 'Профиль и настройки подписки',
      content: <AccountSettingsSection />,
      compactContent: <AccountSettingsSection compact />,
    },
    {
      id: 'reading',
      label: 'Чтение',
      icon: BookOpen,
      description: 'Шрифт, размер и тема читалки',
      content: <ReadingSettingsSection />,
      compactContent: <ReadingSettingsSection compact />,
    },
    {
      id: 'notifications',
      label: t('settings.notifications'),
      icon: Bell,
      description: 'Настройки уведомлений',
      content: <NotificationsSettingsSection />,
      compactContent: <NotificationsSettingsSection compact />,
    },
    {
      id: 'privacy',
      label: t('settings.privacy'),
      icon: Shield,
      description: 'Конфиденциальность и безопасность',
      content: <PrivacySettingsSection />,
      compactContent: <PrivacySettingsSection compact />,
    },
    {
      id: 'pwa',
      label: 'Приложение',
      icon: Smartphone,
      description: 'Установка, хранилище и уведомления',
      content: <PWASettingsSection />,
      compactContent: <PWASettingsSection compact />,
    },
    {
      id: 'about',
      label: 'О программе',
      icon: Info,
      description: 'Версия приложения и информация',
      content: <AboutSettingsSection />,
      compactContent: <AboutSettingsSection compact />,
    },
  ];

  // Build accordion items from tabs config
  const accordionItems: AccordionItem[] = tabs.map((tab) => ({
    id: tab.id,
    title: tab.label,
    description: tab.description,
    icon: tab.icon,
    content: tab.compactContent,
  }));

  // Get current tab content for desktop view
  const currentTab = tabs.find((tab) => tab.id === activeTab);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-4 lg:py-6 w-full max-w-full box-border">
      {/* Header */}
      <div className="mb-3 sm:mb-4 md:mb-6">
        <h1 className="fluid-h2 font-bold mb-1 text-foreground break-words">
          {t('settings.title')}
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground break-words">
          Настройте ваш процесс чтения и управляйте настройками аккаунта
        </p>
      </div>

      {/* Mobile: Accordion Navigation */}
      {/* Smooth transition: opacity fades when switching viewport */}
      <div className="lg:hidden transition-opacity duration-300 ease-in-out">
        <Accordion
          items={accordionItems}
          defaultOpen="account"
        />
      </div>

      {/* Desktop: Sidebar + Content */}
      {/* Smooth transition: opacity fades when switching viewport */}
      <div className="hidden lg:grid lg:grid-cols-12 lg:gap-8 transition-opacity duration-300 ease-in-out">
        {/* Desktop Sidebar Navigation */}
        <aside className="lg:col-span-3">
          <nav className="space-y-2" role="tablist" aria-label="Settings sections">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 rounded-xl transition-all duration-200 border-2',
                    isActive
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:bg-muted'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{tab.label}</p>
                      <p
                        className={cn(
                          'text-xs truncate mt-0.5',
                          isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
                        )}
                      >
                        {tab.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="lg:col-span-9 min-w-0 w-full max-w-full">
          <div
            id={`settings-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={activeTab}
            className="rounded-xl border-2 p-6 bg-background border-border overflow-hidden transition-all duration-200"
          >
            {currentTab?.content}
          </div>
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;
