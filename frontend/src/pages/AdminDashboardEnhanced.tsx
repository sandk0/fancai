/**
 * AdminDashboardEnhanced - Админ-панель с управлением системой
 *
 * Рефакторинг: Разбит на модульные компоненты
 * - AdminHeader - Заголовок панели
 * - AdminTabNavigation - Навигация по табам
 * - AdminStats - Статистические карточки
 * - AdminMultiNLPSettings - Настройки Multi-NLP (в отдельном файле)
 * - AdminParsingSettings - Настройки парсинга (в отдельном файле)
 *
 * Features:
 * - Управление Multi-NLP настройками
 * - Управление настройками парсинга
 * - Системная статистика
 * - Placeholder для Images, System, Users табов
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Activity, Cpu, Database, Image, Server, Users, GitMerge } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { notify } from '@/stores/ui';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import ErrorMessage from '@/components/UI/ErrorMessage';
import { AdminHeader } from '@/components/Admin/AdminHeader';
import { AdminTabNavigation, type AdminTab } from '@/components/Admin/AdminTabNavigation';
import { AdminStats } from '@/components/Admin/AdminStats';
import { AdminMultiNLPSettings } from '@/components/Admin/AdminMultiNLPSettings';
import { AdminParsingSettings } from '@/components/Admin/AdminParsingSettings';
import { PageMeta } from '@/components/SEO/PageMeta';
import { AdminEntityMerge } from '@/components/Admin/AdminEntityMerge';
import { Accordion, type AccordionItem } from '@/components/UI/Accordion';
import {
  adminAPI,
  type SystemStats,
  type MultiNLPSettings,
  type ParsingSettings,
} from '@/api/admin';

const AdminDashboard: React.FC = () => {
  const { t } = useTranslation();
  const { user, isLoading } = useAuthStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [multiNlpOverrides, setMultiNlpOverrides] = useState<MultiNLPSettings | null>(null);
  const [parsingOverrides, setParsingOverrides] = useState<ParsingSettings | null>(null);

  // Always call hooks regardless of user state
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery<SystemStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminAPI.getSystemStats(),
    refetchInterval: 30000,
    enabled: !!(user && user.is_admin)
  });

  const { data: multiNlpData, isLoading: multiNlpLoading } = useQuery<MultiNLPSettings>({
    queryKey: ['admin', 'multi-nlp-settings'],
    queryFn: () => adminAPI.getMultiNLPSettings(),
    enabled: !!(user && user.is_admin)
  });

  const { data: parsingData, isLoading: parsingLoading } = useQuery<ParsingSettings>({
    queryKey: ['admin', 'parsing-settings'],
    queryFn: () => adminAPI.getParsingSettings(),
    enabled: !!(user && user.is_admin)
  });

  // Derive effective settings: local overrides take precedence over query data
  const multiNlpSettings = multiNlpOverrides ?? multiNlpData ?? null;
  const parsingSettings = parsingOverrides ?? parsingData ?? null;

  const setMultiNlpSettings = setMultiNlpOverrides;
  const setParsingSettings = setParsingOverrides;

  const saveMultiNlpSettings = useMutation({
    mutationFn: (settings: MultiNLPSettings) => adminAPI.updateMultiNLPSettings(settings),
    onSuccess: () => {
      notify.success(t('admin.settingsSaved'), t('admin.multiNlpUpdated'));
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (error: Error) => {
      notify.error(t('admin.saveFailed'), error.message);
    }
  });

  const saveParsingSettings = useMutation({
    mutationFn: (settings: ParsingSettings) => adminAPI.updateParsingSettings(settings),
    onSuccess: () => {
      notify.success(t('admin.settingsSaved'), t('admin.parsingUpdated'));
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (error: Error) => {
      notify.error(t('admin.saveFailed'), error.message);
    }
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <LoadingSpinner size="lg" text={t('admin.loadingDashboard')} />
      </div>
    );
  }

  if (!user || !user.is_admin) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <AlertTriangle className="w-16 h-16 text-destructive mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-foreground mb-4">{t('admin.accessDenied')}</h2>
        <p className="text-muted-foreground">{t('admin.accessDeniedDesc')}</p>
      </div>
    );
  }

  // Mobile accordion items
  const accordionItems: AccordionItem[] = [
    {
      id: 'overview',
      title: t('admin.overview'),
      description: t('admin.overviewDesc'),
      icon: Activity,
      content: statsError ? (
        <ErrorMessage
          title={t('admin.failedToLoadStats')}
          message={statsError.message}
        />
      ) : (
        <AdminStats
          stats={stats}
          isLoading={statsLoading}
          t={t}
        />
      ),
    },
    {
      id: 'nlp',
      title: t('admin.multiNlpSettings'),
      description: t('admin.nlpDesc'),
      icon: Cpu,
      content: (
        <AdminMultiNLPSettings
          settings={multiNlpSettings}
          setSettings={setMultiNlpSettings}
          isLoading={multiNlpLoading}
          onSave={(settings) => saveMultiNlpSettings.mutate(settings)}
          isSaving={saveMultiNlpSettings.isPending}
          t={t}
        />
      ),
    },
    {
      id: 'parsing',
      title: t('admin.parsing'),
      description: t('admin.parsingDesc'),
      icon: Database,
      content: (
        <AdminParsingSettings
          settings={parsingSettings}
          setSettings={setParsingSettings}
          isLoading={parsingLoading}
          onSave={(settings) => saveParsingSettings.mutate(settings)}
          isSaving={saveParsingSettings.isPending}
          t={t}
        />
      ),
    },
    {
      id: 'entities',
      title: t('admin.entities'),
      description: t('admin.entitiesDesc'),
      icon: GitMerge,
      content: <AdminEntityMerge t={t} />,
    },
    {
      id: 'images',
      title: t('admin.images'),
      description: t('admin.imagesDesc'),
      icon: Image,
      content: (
        <div className="text-center py-8">
          <Image className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">{t('admin.imageSettings')}</p>
        </div>
      ),
    },
    {
      id: 'system',
      title: t('admin.system'),
      description: t('admin.systemDesc'),
      icon: Server,
      content: (
        <div className="text-center py-8">
          <Server className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">{t('admin.systemSettings')}</p>
        </div>
      ),
    },
    {
      id: 'users',
      title: t('admin.users'),
      description: t('admin.usersDesc'),
      icon: Users,
      content: (
        <div className="text-center py-8">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">{t('admin.userManagement')}</p>
        </div>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <PageMeta title={t('admin.pageTitle')} description={t('admin.pageDescription')} />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-4 lg:py-6 w-full max-w-full box-border">
        {/* Header */}
        <AdminHeader
          title={t('admin.title')}
          subtitle={t('admin.subtitle')}
        />

        {/* Mobile: Accordion Navigation */}
        <div className="lg:hidden">
          <Accordion
            items={accordionItems}
            defaultOpen="overview"
          />
        </div>

        {/* Desktop: Tab Navigation + Content */}
        <div className="hidden lg:block">
          <AdminTabNavigation
            activeTab={activeTab}
            onTabChange={setActiveTab}
            t={t}
          />

          {/* Tab Content */}
          <div className="w-full max-w-full overflow-x-clip">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {statsError ? (
                  <ErrorMessage
                    title={t('admin.failedToLoadStats')}
                    message={statsError.message}
                  />
                ) : (
                  <AdminStats
                    stats={stats}
                    isLoading={statsLoading}
                    t={t}
                  />
                )}
              </div>
            )}

            {/* NLP Settings Tab */}
            {activeTab === 'nlp' && (
              <AdminMultiNLPSettings
                settings={multiNlpSettings}
                setSettings={setMultiNlpSettings}
                isLoading={multiNlpLoading}
                onSave={(settings) => saveMultiNlpSettings.mutate(settings)}
                isSaving={saveMultiNlpSettings.isPending}
                t={t}
              />
            )}

            {/* Parsing Settings Tab */}
            {activeTab === 'parsing' && (
              <AdminParsingSettings
                settings={parsingSettings}
                setSettings={setParsingSettings}
                isLoading={parsingLoading}
                onSave={(settings) => saveParsingSettings.mutate(settings)}
                isSaving={saveParsingSettings.isPending}
                t={t}
              />
            )}

            {activeTab === 'entities' && <AdminEntityMerge t={t} />}

            {activeTab === 'images' && (
              <div className="text-center py-12">
                <Image className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">{t('admin.images')}</h3>
                <p className="text-muted-foreground">{t('admin.imageSettings')}</p>
              </div>
            )}

            {/* System Tab */}
            {activeTab === 'system' && (
              <div className="text-center py-12">
                <Server className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">{t('admin.system')}</h3>
                <p className="text-muted-foreground">{t('admin.systemSettings')}</p>
              </div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
              <div className="text-center py-12">
                <Users className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">{t('admin.users')}</h3>
                <p className="text-muted-foreground">{t('admin.userManagement')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
