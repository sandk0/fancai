/**
 * PWAInstallSection - PWA installation status and action
 *
 * Displays the current installation state and provides install button
 * or iOS-specific instructions depending on the platform.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Info, CheckCircle, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/UI/button';
import { IOSInstallInstructions } from '@/components/UI/IOSInstallInstructions';

interface PWAInstallSectionProps {
  /** Compact mode for mobile accordion */
  compact?: boolean;
  /** Whether the app is already installed */
  isInstalled: boolean;
  /** Whether the app can be installed (browser prompt available) */
  isInstallable: boolean;
  /** Whether the device is iOS */
  isIOSDevice: boolean;
  /** Whether installation is in progress */
  isInstalling: boolean;
  /** Trigger the install prompt */
  install: () => void;
}

/** Renders PWA installation status and install action */
export const PWAInstallSection: React.FC<PWAInstallSectionProps> = ({
  compact = false,
  isInstalled,
  isInstallable,
  isIOSDevice,
  isInstalling,
  install,
}) => {
  const { t } = useTranslation();

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
              {t('settings.pwa.appInstalled')}
            </p>
            {!compact && (
              <p className="text-sm text-green-600 dark:text-green-400">
                {t('settings.pwa.appInstalledDesc')}
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
              {compact ? t('settings.pwa.installApp') : t('settings.pwa.installAppFull')}
            </span>
            {!compact && (
              <p className="text-sm text-muted-foreground">
                {t('settings.pwa.installAppDesc')}
              </p>
            )}
          </div>
          <Button
            variant="primary"
            size={compact ? 'sm' : 'md'}
            onClick={install}
            isLoading={isInstalling}
            loadingText={compact ? undefined : t('settings.pwa.installing')}
          >
            {t('settings.pwa.install')}
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
          {t('settings.pwa.addToHomeScreenShort')}
        </p>
      ) : (
        <div className="flex items-start gap-3">
          <Info className="w-6 h-6 flex-shrink-0 mt-0.5 text-muted-foreground" />
          <div>
            <p className="font-semibold text-foreground">
              {t('settings.pwa.installUnavailable')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('settings.pwa.installUnavailableDesc')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
