/**
 * PrivacySettingsSection - Unified privacy & security settings component
 *
 * Features:
 * - Security information display
 * - Data collection transparency
 * - Responsive design with compact mode
 */

import React from 'react';
import { Shield, Check } from 'lucide-react';

interface PrivacySettingsSectionProps {
  /** Compact mode for mobile accordion */
  compact?: boolean;
}

const dataCollectionItems = {
  full: [
    'Прогресс чтения и закладки',
    'Сгенерированные изображения из ваших книг',
    'Статистика использования приложения (анонимизированная)',
  ],
  compact: [
    'Прогресс чтения и закладки',
    'Сгенерированные изображения',
    'Анонимная статистика',
  ],
};

export const PrivacySettingsSection: React.FC<PrivacySettingsSectionProps> = ({
  compact = false,
}) => {
  const items = compact ? dataCollectionItems.compact : dataCollectionItems.full;

  if (compact) {
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-xl border-2 bg-muted border-primary">
          <div className="flex items-start gap-2">
            <Shield className="w-5 h-5 flex-shrink-0 mt-0.5 text-primary" />
            <p className="text-sm text-foreground">
              Ваши данные хранятся безопасно и не передаются третьим лицам.
            </p>
          </div>
        </div>
        <div>
          <h4 className="font-semibold mb-2 text-foreground text-sm">Сбор данных</h4>
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
          Конфиденциальность и безопасность
        </h3>
        <div className="space-y-6">
          {/* Info Box */}
          <div className="p-4 sm:p-6 rounded-xl border-2 bg-muted border-primary">
            <div className="flex items-start gap-3">
              <Shield className="w-6 h-6 flex-shrink-0 mt-0.5 text-primary" />
              <p className="text-foreground break-words min-w-0">
                Ваши книги и данные чтения хранятся безопасно и не передаются третьим лицам.
              </p>
            </div>
          </div>

          {/* Data Collection */}
          <div>
            <h4 className="font-semibold mb-3 text-foreground">
              Сбор данных
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
