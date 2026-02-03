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

import React from 'react';
import { useTranslation } from 'react-i18next';

import { useStorageInfo, useRequestPersistence, useClearOfflineData } from '@/hooks/useStorageInfo';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useOfflineBooks } from '@/hooks/useOfflineBook';

import { PWAInstallSection } from './PWAInstallSection';
import { PWANotificationsSection } from './PWANotificationsSection';
import { PWAOfflineSection } from './PWAOfflineSection';

interface PWASettingsSectionProps {
  /** Compact mode for mobile accordion */
  compact?: boolean;
}

export const PWASettingsSection: React.FC<PWASettingsSectionProps> = ({
  compact = false,
}) => {
  const { t } = useTranslation();

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

  if (compact) {
    return (
      <div className="space-y-6">
        <div>
          <h4 className="font-semibold mb-3 text-foreground text-sm">{t('settings.pwa.installationTitle')}</h4>
          <PWAInstallSection
            compact
            isInstalled={isInstalled}
            isInstallable={isInstallable}
            isIOSDevice={isIOSDevice}
            isInstalling={isInstalling}
            install={install}
          />
        </div>

        <div>
          <h4 className="font-semibold mb-3 text-foreground text-sm">{t('settings.pwa.storageTitle')}</h4>
          <PWAOfflineSection
            compact
            storageInfo={storageInfo}
            offlineBooksCount={offlineBooks.length}
            isRequestingPersistence={isRequestingPersistence}
            isClearingData={isClearingData}
            requestPersistence={() => requestPersistence()}
            clearOfflineData={clearOfflineData}
          />
        </div>

        <div>
          <h4 className="font-semibold mb-3 text-foreground text-sm">{t('settings.pwa.pushNotificationsTitle')}</h4>
          <PWANotificationsSection
            compact
            isPushSupported={isPushSupported}
            canUsePush={canUsePush}
            unavailableReason={unavailableReason}
            permissionState={permissionState}
            isSubscribed={isSubscribed}
            isPushLoading={isPushLoading}
            subscribePush={subscribePush}
            unsubscribePush={unsubscribePush}
            testNotification={testNotification}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-full overflow-hidden">
      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground break-words">
          {t('settings.pwa.appInstallationTitle')}
        </h3>
        <div className="space-y-4">
          <PWAInstallSection
            isInstalled={isInstalled}
            isInstallable={isInstallable}
            isIOSDevice={isIOSDevice}
            isInstalling={isInstalling}
            install={install}
          />
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground break-words">
          {t('settings.pwa.offlineStorageTitle')}
        </h3>
        <PWAOfflineSection
          storageInfo={storageInfo}
          offlineBooksCount={offlineBooks.length}
          isRequestingPersistence={isRequestingPersistence}
          isClearingData={isClearingData}
          requestPersistence={() => requestPersistence()}
          clearOfflineData={clearOfflineData}
        />
      </div>

      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground break-words">
          {t('settings.pwa.pushNotificationsTitle')}
        </h3>
        <div className="space-y-4">
          <PWANotificationsSection
            isPushSupported={isPushSupported}
            canUsePush={canUsePush}
            unavailableReason={unavailableReason}
            permissionState={permissionState}
            isSubscribed={isSubscribed}
            isPushLoading={isPushLoading}
            subscribePush={subscribePush}
            unsubscribePush={unsubscribePush}
            testNotification={testNotification}
          />
        </div>
      </div>
    </div>
  );
};
