/**
 * PWANotificationsSection - Push notification settings
 *
 * Handles push notification subscription state, permission checks,
 * and provides toggle + test notification button.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Info, XCircle, BellRing, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/UI/button';
import type { PushPermissionState } from '@/types/push';

interface PWANotificationsSectionProps {
  compact?: boolean;
  isPushSupported: boolean;
  canUsePush: boolean;
  unavailableReason: string | null;
  permissionState: PushPermissionState;
  isSubscribed: boolean;
  isPushLoading: boolean;
  subscribePush: () => void;
  unsubscribePush: () => void;
  testNotification: () => void;
}

export const PWANotificationsSection: React.FC<PWANotificationsSectionProps> = ({
  compact = false,
  isPushSupported,
  canUsePush,
  unavailableReason,
  permissionState,
  isSubscribed,
  isPushLoading,
  subscribePush,
  unsubscribePush,
  testNotification,
}) => {
  const { t } = useTranslation();

  if (!isPushSupported) {
    return (
      <div className={cn(
        'rounded-xl border-2 bg-muted border-border',
        compact ? 'p-3' : 'p-4 sm:p-6'
      )}>
        {compact ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.pwa.pushNotSupported')}
          </p>
        ) : (
          <div className="flex items-start gap-3">
            <XCircle className="w-6 h-6 flex-shrink-0 mt-0.5 text-muted-foreground" />
            <div>
              <p className="font-semibold text-foreground">
                {t('settings.pwa.pushNotSupported')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('settings.pwa.pushNotSupportedDesc')}
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
            {unavailableReason || t('settings.pwa.installForNotifications')}
          </p>
        ) : (
          <div className="flex items-start gap-3">
            <Info className="w-6 h-6 flex-shrink-0 mt-0.5 text-muted-foreground" />
            <div>
              <p className="font-semibold text-foreground">
                {t('settings.pwa.installAppFull')}
              </p>
              <p className="text-sm text-muted-foreground">
                {unavailableReason || t('settings.pwa.installForNotificationsDesc')}
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
            {t('settings.pwa.pushBlockedShort')}
          </p>
        ) : (
          <div className="flex items-start gap-3">
            <XCircle className="w-6 h-6 flex-shrink-0 mt-0.5 text-red-500" />
            <div>
              <p className="font-semibold text-red-700 dark:text-red-300">
                {t('settings.pwa.pushBlocked')}
              </p>
              <p className="text-sm text-red-600 dark:text-red-400">
                {t('settings.pwa.pushBlockedDesc')}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

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
                {compact ? t('settings.pwa.notifications') : t('settings.pwa.receiveNotifications')}
              </p>
              {!compact && (
                <p className="text-sm text-muted-foreground">
                  {t('settings.pwa.notificationsDesc')}
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
              'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              isSubscribed ? 'bg-green-500' : 'bg-zinc-600',
              compact ? 'h-6 w-10' : 'h-7 w-12'
            )}
          >
            <span
              className={cn(
                'inline-block transform rounded-full bg-white shadow-xs transition-transform',
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
          {compact ? t('settings.pwa.test') : t('settings.pwa.testNotification')}
        </Button>
      )}
    </div>
  );
};
