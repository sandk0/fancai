import React from 'react';
import { Shield, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface PrivacySettingsSectionProps {
  compact?: boolean;
}

export const PrivacySettingsSection: React.FC<PrivacySettingsSectionProps> = ({
  compact = false,
}) => {
  const { t } = useTranslation();

  const dataCollectionItems = {
    full: [
      t('settings.privacy.stored_data_progress'),
      t('settings.privacy.stored_data_images'),
      t('settings.privacy.stored_data_stats'),
    ],
    compact: [
      t('settings.privacy.stored_data_progress_short'),
      t('settings.privacy.stored_data_images_short'),
      t('settings.privacy.stored_data_stats_short'),
    ],
  };

  const items = compact ? dataCollectionItems.compact : dataCollectionItems.full;

  if (compact) {
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-xl border-2 bg-muted border-primary">
          <div className="flex items-start gap-2">
            <Shield className="w-5 h-5 flex-shrink-0 mt-0.5 text-primary" />
            <p className="text-sm text-foreground">
              {t('settings.privacy.sync_data_safe')}
            </p>
          </div>
        </div>
        <div>
          <h4 className="font-semibold mb-2 text-foreground text-sm">{t('settings.privacy.sync_data_title')}</h4>
          <div className="space-y-1.5">
            {items.map((item, index) => (
              <div key={index} className="flex items-start gap-2">
                <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
                <span className="text-xs text-muted-foreground">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground break-words">
          {t('settings.privacy.sync_data_heading')}
        </h3>
        <div className="space-y-6">
          <div className="p-4 sm:p-6 rounded-xl border-2 bg-muted border-primary">
            <div className="flex items-start gap-3">
              <Shield className="w-6 h-6 flex-shrink-0 mt-0.5 text-primary" />
              <p className="text-foreground break-words min-w-0">
                {t('settings.privacy.sync_data_safe_full')}
              </p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-3 text-foreground">
              {t('settings.privacy.sync_data_title')}
            </h4>
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={index} className="flex items-start gap-2">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5 text-primary" />
                  <span className="text-sm text-muted-foreground break-words min-w-0">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
