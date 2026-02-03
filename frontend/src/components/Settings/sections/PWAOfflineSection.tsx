/**
 * PWAOfflineSection - Offline storage and data management settings
 *
 * Displays storage usage, offline books count, persistent storage status,
 * and provides clear data action with confirmation dialog.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Book, HardDrive, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/UI/button';
import { Progress } from '@/components/UI/progress';
import { ConfirmDialog } from '@/components/UI/Dialog';
import { StorageQuotaInfo } from '@/components/Settings/StorageQuotaInfo';
import { formatBytes } from '@/hooks/useStorageInfo';

interface StorageInfo {
  used: number;
  quota: number;
  percentUsed: number;
  isPersistent: boolean;
  isCritical: boolean;
  isWarning: boolean;
}

interface PWAOfflineSectionProps {
  compact?: boolean;
  storageInfo: StorageInfo | undefined;
  offlineBooksCount: number;
  isRequestingPersistence: boolean;
  isClearingData: boolean;
  requestPersistence: () => void;
  clearOfflineData: (vars: undefined, options: { onSuccess: () => void }) => void;
}

export const PWAOfflineSection: React.FC<PWAOfflineSectionProps> = ({
  compact = false,
  storageInfo,
  offlineBooksCount,
  isRequestingPersistence,
  isClearingData,
  requestPersistence,
  clearOfflineData,
}) => {
  const { t } = useTranslation();
  const [showClearDataDialog, setShowClearDataDialog] = useState(false);

  const handleClearOfflineData = () => {
    clearOfflineData(undefined, {
      onSuccess: () => {
        setShowClearDataDialog(false);
      },
    });
  };

  if (compact) {
    return (
      <>
        <div className="space-y-3">
          {/* Storage Progress */}
          <div className="p-3 rounded-xl border-2 bg-muted border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                 <span className="text-sm text-foreground">{t('settings.pwa.used')}</span>
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
                {t('settings.pwa.storageCritical')}
              </p>
            )}
            {storageInfo?.isWarning && !storageInfo.isCritical && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                {t('settings.pwa.storageWarning')}
              </p>
            )}
          </div>

          {/* Offline Books */}
          <div className="flex items-center justify-between p-3 rounded-xl border-2 bg-muted border-border">
            <div className="flex items-center gap-2">
              <Book className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-foreground">{t('settings.pwa.offlineBooks')}</span>
            </div>
            <span className="font-semibold text-foreground">{offlineBooksCount}</span>
          </div>

          {/* Persistent Storage */}
          <div className="flex items-center justify-between p-3 rounded-xl border-2 bg-muted border-border">
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground">{t('settings.pwa.persistentStorage')}</span>
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
                {t('settings.pwa.request')}
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
            {t('settings.pwa.clearData')}
          </Button>
        </div>

        <ConfirmDialog
          isOpen={showClearDataDialog}
          onClose={() => setShowClearDataDialog(false)}
          title={t('settings.pwa.clearDataTitle')}
          description={t('settings.pwa.clearDataDesc')}
          confirmText={t('settings.pwa.clear')}
          cancelText={t('settings.pwa.cancel')}
          destructive
          onConfirm={handleClearOfflineData}
          isLoading={isClearingData}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Storage Usage */}
        <StorageQuotaInfo showBreakdown />

        {/* Persistent Storage */}
        <div className="p-4 sm:p-6 rounded-xl border-2 bg-muted border-border">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-foreground">{t('settings.pwa.persistentStorage')}</span>
                {storageInfo?.isPersistent ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {storageInfo?.isPersistent
                  ? t('settings.pwa.persistentStorageOn')
                  : t('settings.pwa.persistentStorageOff')}
              </p>
            </div>
            {!storageInfo?.isPersistent && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => requestPersistence()}
                isLoading={isRequestingPersistence}
                loadingText={t('settings.pwa.requesting')}
              >
                {t('settings.pwa.request')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showClearDataDialog}
        onClose={() => setShowClearDataDialog(false)}
        title={t('settings.pwa.clearDataTitle')}
        description={t('settings.pwa.clearDataDescFull')}
        confirmText={t('settings.pwa.clear')}
        cancelText={t('settings.pwa.cancel')}
        destructive
        onConfirm={handleClearOfflineData}
        isLoading={isClearingData}
      />
    </>
  );
};
