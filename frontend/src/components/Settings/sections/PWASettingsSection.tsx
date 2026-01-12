/**
 * PWASettingsSection - Unified PWA settings component
 *
 * Features:
 * - App installation status and action
 * - Storage usage display
 * - Persistent storage request
 * - Offline books count
 * - Push notifications toggle
 * - Clear data action
 * - Responsive design with compact mode
 */

import React, { useState } from 'react';
import {
  Info,
  CheckCircle,
  XCircle,
  BellRing,
  Bell,
  Book,
  HardDrive,
  Download,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/UI/button';
import { Progress } from '@/components/UI/progress';
import { ConfirmDialog } from '@/components/UI/Dialog';
import { IOSInstallInstructions } from '@/components/UI/IOSInstallInstructions';
import { StorageQuotaInfo } from '@/components/Settings/StorageQuotaInfo';

// PWA Hooks
import { useStorageInfo, useRequestPersistence, useClearOfflineData, formatBytes } from '@/hooks/useStorageInfo';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useOfflineBooks } from '@/hooks/useOfflineBook';

interface PWASettingsSectionProps {
  /** Compact mode for mobile accordion */
  compact?: boolean;
}

export const PWASettingsSection: React.FC<PWASettingsSectionProps> = ({
  compact = false,
}) => {
  const [showClearDataDialog, setShowClearDataDialog] = useState(false);

  // PWA Hooks
  const { data: storageInfo } = useStorageInfo();
  const { mutate: requestPersistence, isPending: isRequestingPersistence } = useRequestPersistence();
  const { mutate: clearOfflineData, isPending: isClearingData } = useClearOfflineData();
  const { offlineBooks } = useOfflineBooks();

  const {
    isSupported: isPushSupported,
    canUsePush,
    unavailableReason,
    permissionState,
    isSubscribed,
    isLoading: isPushLoading,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
    testNotification,
  } = usePushNotifications();

  const {
    isInstallable,
    isInstalled,
    isInstalling,
    isIOSDevice,
    install,
  } = usePWAInstall();

  const handleClearOfflineData = () => {
    clearOfflineData(undefined, {
      onSuccess: () => {
        setShowClearDataDialog(false);
      },
    });
  };

  // Render installation section
  const renderInstallation = () => {
    if (isInstalled) {
      return (
        <div className={cn(
          'rounded-xl border-2 bg-green-50 dark:bg-green-950 border-green-500',
          compact ? 'p-3' : 'p-4 sm:p-6'
        )}>
          <div className="flex items-center gap-2">
            <CheckCircle className={cn(
              'flex-shrink-0 text-green-600 dark:text-green-400',
              compact ? 'w-5 h-5' : 'w-6 h-6'
            )} />
            <div>
              <p className={cn(
                'font-semibold text-green-700 dark:text-green-300',
                compact && 'text-sm'
              )}>
                Приложение установлено
              </p>
              {!compact && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  Вы используете установленную версию приложения
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (isIOSDevice) {
      return <IOSInstallInstructions mode="inline" showOnlyOnIOS={false} forceShow />;
    }

    if (isInstallable) {
      return (
        <div className={cn(
          'rounded-xl border-2 bg-muted border-primary',
          compact ? 'p-3' : 'p-4 sm:p-6'
        )}>
          <div className={cn(
            'flex gap-3',
            compact ? 'items-center justify-between' : 'flex-col sm:flex-row sm:items-center sm:justify-between gap-4'
          )}>
            <div className="flex items-center gap-2">
              <Download className={cn('text-primary', compact ? 'w-5 h-5' : 'w-6 h-6')} />
              <span className={cn('text-foreground', compact ? 'text-sm' : 'font-semibold')}>
                {compact ? 'Установить приложение' : 'Установите приложение'}
              </span>
              {!compact && (
                <p className="text-sm text-muted-foreground">
                  Получите быстрый доступ и офлайн-режим
                </p>
              )}
            </div>
            <Button
              variant="primary"
              size={compact ? 'sm' : 'md'}
              onClick={install}
              isLoading={isInstalling}
              loadingText={compact ? undefined : 'Установка...'}
            >
              Установить
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className={cn(
        'rounded-xl border-2 bg-muted border-border',
        compact ? 'p-3' : 'p-4 sm:p-6'
      )}>
        {compact ? (
          <p className="text-xs text-muted-foreground">
            Выберите "Добавить на главный экран" в меню браузера
          </p>
        ) : (
          <div className="flex items-start gap-3">
            <Info className="w-6 h-6 flex-shrink-0 mt-0.5 text-muted-foreground" />
            <div>
              <p className="font-semibold text-foreground">
                Установка недоступна
              </p>
              <p className="text-sm text-muted-foreground">
                Откройте сайт в Chrome, Safari или Edge и выберите "Добавить на главный экран" или "Установить приложение" в меню браузера
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render push notifications section
  const renderPushNotifications = () => {
    if (!isPushSupported) {
      return (
        <div className={cn(
          'rounded-xl border-2 bg-muted border-border',
          compact ? 'p-3' : 'p-4 sm:p-6'
        )}>
          {compact ? (
            <p className="text-xs text-muted-foreground">
              Push-уведомления не поддерживаются
            </p>
          ) : (
            <div className="flex items-start gap-3">
              <XCircle className="w-6 h-6 flex-shrink-0 mt-0.5 text-muted-foreground" />
              <div>
                <p className="font-semibold text-foreground">
                  Push-уведомления не поддерживаются
                </p>
                <p className="text-sm text-muted-foreground">
                  Ваш браузер не поддерживает push-уведомления
                </p>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (!canUsePush) {
      return (
        <div className={cn(
          'rounded-xl border-2 bg-muted border-border',
          compact ? 'p-3' : 'p-4 sm:p-6'
        )}>
          {compact ? (
            <p className="text-xs text-muted-foreground">
              {unavailableReason || 'Установите приложение для получения уведомлений'}
            </p>
          ) : (
            <div className="flex items-start gap-3">
              <Info className="w-6 h-6 flex-shrink-0 mt-0.5 text-muted-foreground" />
              <div>
                <p className="font-semibold text-foreground">
                  Установите приложение
                </p>
                <p className="text-sm text-muted-foreground">
                  {unavailableReason || 'Для получения уведомлений установите приложение на главный экран'}
                </p>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (permissionState === 'denied') {
      return (
        <div className={cn(
          'rounded-xl border-2 bg-red-50 dark:bg-red-950 border-red-500',
          compact ? 'p-3' : 'p-4 sm:p-6'
        )}>
          {compact ? (
            <p className="text-xs text-red-600 dark:text-red-400">
              Уведомления заблокированы в настройках браузера
            </p>
          ) : (
            <div className="flex items-start gap-3">
              <XCircle className="w-6 h-6 flex-shrink-0 mt-0.5 text-red-500" />
              <div>
                <p className="font-semibold text-red-700 dark:text-red-300">
                  Уведомления заблокированы
                </p>
                <p className="text-sm text-red-600 dark:text-red-400">
                  Разрешите уведомления в настройках браузера
                </p>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Push available - show toggle
    return (
      <div className="space-y-3">
        <div className={cn(
          'rounded-xl border-2 bg-muted border-border',
          compact ? 'p-3' : 'p-4 sm:p-6'
        )}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <BellRing className={cn(
                'flex-shrink-0 mt-0.5 text-muted-foreground',
                compact ? 'w-4 h-4' : 'w-6 h-6'
              )} />
              <div>
                <p className={cn(
                  'font-semibold text-foreground',
                  compact && 'text-sm'
                )}>
                  {compact ? 'Уведомления' : 'Получать уведомления'}
                </p>
                {!compact && (
                  <p className="text-sm text-muted-foreground">
                    О завершении обработки книг и генерации изображений
                  </p>
                )}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={isSubscribed}
              onClick={() => isSubscribed ? unsubscribePush() : subscribePush()}
              disabled={isPushLoading}
              className={cn(
                'relative inline-flex flex-shrink-0 items-center rounded-full transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isSubscribed ? 'bg-green-500' : 'bg-zinc-600',
                compact ? 'h-6 w-10' : 'h-7 w-12'
              )}
            >
              <span
                className={cn(
                  'inline-block transform rounded-full bg-white shadow-sm transition-transform',
                  compact
                    ? cn('h-4 w-4', isSubscribed ? 'translate-x-5' : 'translate-x-1')
                    : cn('h-5 w-5', isSubscribed ? 'translate-x-6' : 'translate-x-1')
                )}
              />
            </button>
          </div>
        </div>

        {isSubscribed && (
          <Button
            variant={compact ? 'ghost' : 'secondary'}
            size="sm"
            onClick={() => testNotification()}
            disabled={isPushLoading}
            className={compact ? 'w-full' : undefined}
          >
            <Bell className="w-4 h-4 mr-2" />
            {compact ? 'Тест' : 'Тестовое уведомление'}
          </Button>
        )}
      </div>
    );
  };

  if (compact) {
    return (
      <div className="space-y-6">
        {/* Installation Section */}
        <div>
          <h4 className="font-semibold mb-3 text-foreground text-sm">Установка</h4>
          {renderInstallation()}
        </div>

        {/* Storage Section */}
        <div>
          <h4 className="font-semibold mb-3 text-foreground text-sm">Хранилище</h4>
          <div className="space-y-3">
            {/* Storage Progress */}
            <div className="p-3 rounded-xl border-2 bg-muted border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Использовано</span>
                </div>
                {storageInfo && (
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(storageInfo.used)} / {formatBytes(storageInfo.quota)}
                  </span>
                )}
              </div>
              {storageInfo && (
                <Progress
                  value={storageInfo.percentUsed}
                  className={cn(
                    'h-2',
                    storageInfo.isCritical && '[&>div]:bg-red-500',
                    storageInfo.isWarning && !storageInfo.isCritical && '[&>div]:bg-yellow-500'
                  )}
                />
              )}
              {storageInfo?.isCritical && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                  Критически мало места!
                </p>
              )}
              {storageInfo?.isWarning && !storageInfo.isCritical && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                  Заканчивается место
                </p>
              )}
            </div>

            {/* Offline Books */}
            <div className="flex items-center justify-between p-3 rounded-xl border-2 bg-muted border-border">
              <div className="flex items-center gap-2">
                <Book className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Скачанные книги</span>
              </div>
              <span className="font-semibold text-foreground">{offlineBooks.length}</span>
            </div>

            {/* Persistent Storage */}
            <div className="flex items-center justify-between p-3 rounded-xl border-2 bg-muted border-border">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">Постоянное хранилище</span>
                {storageInfo?.isPersistent ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              {!storageInfo?.isPersistent && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => requestPersistence()}
                  isLoading={isRequestingPersistence}
                  className="h-8 px-2"
                >
                  Запросить
                </Button>
              )}
            </div>

            {/* Clear Data */}
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => setShowClearDataDialog(true)}
              disabled={isClearingData}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Очистить данные
            </Button>
          </div>
        </div>

        {/* Push Notifications Section */}
        <div>
          <h4 className="font-semibold mb-3 text-foreground text-sm">Push-уведомления</h4>
          {renderPushNotifications()}
        </div>

        {/* Clear Data Dialog */}
        <ConfirmDialog
          isOpen={showClearDataDialog}
          onClose={() => setShowClearDataDialog(false)}
          title="Очистить офлайн-данные?"
          description="Все скачанные книги и кэшированные данные будут удалены."
          confirmText="Очистить"
          cancelText="Отмена"
          destructive
          onConfirm={handleClearOfflineData}
          isLoading={isClearingData}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-full overflow-hidden">
      {/* Section 1: App Installation */}
      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground break-words">
          Установка приложения
        </h3>
        <div className="space-y-4">
          {renderInstallation()}
        </div>
      </div>

      {/* Section 2: Offline Storage */}
      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground break-words">
          Офлайн-хранилище
        </h3>
        <div className="space-y-4">
          {/* Storage Usage - Using StorageQuotaInfo component */}
          <StorageQuotaInfo showBreakdown />

          {/* Persistent Storage */}
          <div className="p-4 sm:p-6 rounded-xl border-2 bg-muted border-border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-foreground">Постоянное хранилище</span>
                  {storageInfo?.isPersistent ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {storageInfo?.isPersistent
                    ? 'Ваши данные защищены от автоматического удаления'
                    : 'Браузер может автоматически удалить данные при нехватке места'}
                </p>
              </div>
              {!storageInfo?.isPersistent && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => requestPersistence()}
                  isLoading={isRequestingPersistence}
                  loadingText="Запрос..."
                >
                  Запросить
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Push Notifications */}
      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground break-words">
          Push-уведомления
        </h3>
        <div className="space-y-4">
          {renderPushNotifications()}
        </div>
      </div>

      {/* Clear Data Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showClearDataDialog}
        onClose={() => setShowClearDataDialog(false)}
        title="Очистить офлайн-данные?"
        description="Все скачанные книги, изображения и кэшированные данные будут удалены. Это действие нельзя отменить."
        confirmText="Очистить"
        cancelText="Отмена"
        destructive
        onConfirm={handleClearOfflineData}
        isLoading={isClearingData}
      />
    </div>
  );
};
