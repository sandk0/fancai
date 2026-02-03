/**
 * AccountSettingsSection - Unified account settings component
 *
 * Responsive design with compact prop for mobile accordion view
 */

import React from 'react';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from 'react-i18next';

interface AccountSettingsSectionProps {
  /** Compact mode for mobile accordion */
  compact?: boolean;
}

export const AccountSettingsSection: React.FC<AccountSettingsSectionProps> = ({
  compact = false,
}) => {
  const { user } = useAuthStore();
  const { t } = useTranslation();

  if (compact) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-foreground">
          {t('profile.personalInfo')}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-muted-foreground">
              {t('profile.fullName')}
            </label>
            <input
              type="text"
              value={user?.full_name || ''}
              className="w-full px-4 py-3 min-h-[44px] rounded-xl border-2 bg-muted border-border text-foreground"
              readOnly
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-muted-foreground">
              {t('profile.email')}
            </label>
            <input
              type="email"
              value={user?.email || ''}
              className="w-full px-4 py-3 min-h-[44px] rounded-xl border-2 bg-muted border-border text-foreground"
              readOnly
            />
          </div>
        </div>
        <div className="p-3 rounded-xl border-2 bg-muted border-border">
          <p className="text-xs text-muted-foreground">
            {t('account.readonly_short')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground">
          {t('profile.personalInfo')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-muted-foreground">
              {t('profile.fullName')}
            </label>
            <input
              type="text"
              value={user?.full_name || ''}
              className="w-full px-4 py-3 min-h-[44px] rounded-xl border-2 bg-muted border-border text-foreground"
              readOnly
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-muted-foreground">
              {t('profile.email')}
            </label>
            <input
              type="email"
              value={user?.email || ''}
              className="w-full px-4 py-3 min-h-[44px] rounded-xl border-2 bg-muted border-border text-foreground"
              readOnly
            />
          </div>
        </div>
        <div className="mt-6 p-4 rounded-xl border-2 bg-muted border-border">
          <p className="text-sm text-muted-foreground">
            {t('account.readonly_full')}
          </p>
        </div>
      </div>
    </div>
  );
};
