/**
 * AdminParsingSettings - Настройки парсинга книг
 *
 * Управляет настройками:
 * - Максимальное количество одновременных задач парсинга
 * - Таймаут парсинга
 * - Приоритеты очереди для разных типов подписок
 *
 * @param settings - Текущие настройки парсинга
 * @param setSettings - Функция обновления настроек
 * @param isLoading - Индикатор загрузки
 * @param onSave - Callback при сохранении
 * @param isSaving - Индикатор сохранения
 * @param t - Функция перевода
 */

import React from 'react';
import { Save, RefreshCw } from 'lucide-react';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import type { ParsingSettings } from '@/api/admin';

interface AdminParsingSettingsProps {
  settings: ParsingSettings | null;
  setSettings: (settings: ParsingSettings) => void;
  isLoading: boolean;
  onSave: (settings: ParsingSettings) => void;
  isSaving: boolean;
  t: (key: string) => string;
}

export const AdminParsingSettings: React.FC<AdminParsingSettingsProps> = ({
  settings,
  setSettings,
  isLoading,
  onSave,
  isSaving,
  t
}) => {
  if (isLoading || !settings) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" text={t('admin.loadingParsing')} />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-card rounded-lg p-4 sm:p-6 shadow-xs border border-border">
        <h3 className="text-base sm:text-lg font-medium text-foreground mb-4 sm:mb-6">
          {t('admin.parsingConfig')}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {/* Max Concurrent Parsing */}
          <div>
            <label
              htmlFor="max-concurrent-parsing"
              className="block text-sm font-medium text-muted-foreground mb-2"
            >
              {t('admin.maxConcurrentTasks')}
            </label>
            <input
              id="max-concurrent-parsing"
              type="number"
              min="1"
              max="10"
              value={settings.max_concurrent_parsing}
              onChange={(e) => setSettings({ ...settings, max_concurrent_parsing: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-base"
              aria-required="true"
            />
          </div>

          {/* Timeout */}
          <div>
            <label
              htmlFor="timeout-minutes"
              className="block text-sm font-medium text-muted-foreground mb-2"
            >
              {t('admin.timeoutMinutes')}
            </label>
            <input
              id="timeout-minutes"
              type="number"
              min="10"
              max="120"
              value={settings.timeout_minutes}
              onChange={(e) => setSettings({ ...settings, timeout_minutes: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-base"
              aria-required="true"
            />
          </div>
        </div>

        {/* Priority Weights */}
        <div className="mt-4 sm:mt-6">
          <h4 className="text-sm sm:text-md font-medium text-foreground mb-3 sm:mb-4">{t('admin.priorityWeights')}</h4>
          <div className="grid grid-cols-3 gap-2 sm:gap-4 md:gap-6 min-w-0">
            <div className="min-w-0">
              <label
                htmlFor="priority-free-users"
                className="block text-[10px] sm:text-sm font-medium text-muted-foreground mb-1.5 sm:mb-2 leading-tight"
              >
                Free
              </label>
              <input
                id="priority-free-users"
                type="number"
                min="1"
                max="10"
                value={settings.queue_priority_weights.free}
                onChange={(e) => setSettings({
                  ...settings,
                  queue_priority_weights: { ...settings.queue_priority_weights, free: parseInt(e.target.value) }
                })}
                className="w-full px-1.5 sm:px-3 py-2 border border-input rounded-lg bg-background text-foreground text-base"
                aria-required="true"
              />
            </div>

            <div className="min-w-0">
              <label
                htmlFor="priority-premium-users"
                className="block text-[10px] sm:text-sm font-medium text-muted-foreground mb-1.5 sm:mb-2 leading-tight"
              >
                Premium
              </label>
              <input
                id="priority-premium-users"
                type="number"
                min="1"
                max="10"
                value={settings.queue_priority_weights.premium}
                onChange={(e) => setSettings({
                  ...settings,
                  queue_priority_weights: { ...settings.queue_priority_weights, premium: parseInt(e.target.value) }
                })}
                className="w-full px-1.5 sm:px-3 py-2 border border-input rounded-lg bg-background text-foreground text-base"
                aria-required="true"
              />
            </div>

            <div className="min-w-0">
              <label
                htmlFor="priority-ultimate-users"
                className="block text-[10px] sm:text-sm font-medium text-muted-foreground mb-1.5 sm:mb-2 leading-tight"
              >
                Ultimate
              </label>
              <input
                id="priority-ultimate-users"
                type="number"
                min="1"
                max="10"
                value={settings.queue_priority_weights.ultimate}
                onChange={(e) => setSettings({
                  ...settings,
                  queue_priority_weights: { ...settings.queue_priority_weights, ultimate: parseInt(e.target.value) }
                })}
                className="w-full px-1.5 sm:px-3 py-2 border border-input rounded-lg bg-background text-foreground text-base"
                aria-required="true"
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end mt-4 sm:mt-6">
          <button
            onClick={() => onSave(settings)}
            disabled={isSaving}
            className="w-full sm:w-auto px-4 sm:px-6 py-2.5 sm:py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-primary-foreground rounded-lg flex items-center justify-center gap-2 text-sm sm:text-base"
          >
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? t('admin.saving') : t('admin.saveSettings')}
          </button>
        </div>
      </div>
    </div>
  );
};
