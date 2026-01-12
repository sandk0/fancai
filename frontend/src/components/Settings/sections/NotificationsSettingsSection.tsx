/**
 * NotificationsSettingsSection - Unified notifications settings component
 *
 * Features:
 * - Book processing notifications toggle
 * - Image generation notifications toggle
 * - Reading reminders toggle
 * - iOS Push guidance when needed
 * - Responsive design with compact mode
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { IOSPushGuidance, useIOSPushReadiness } from '@/components/UI/IOSInstallInstructions';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange, label, description }) => {
  const switchId = React.useId();
  const descriptionId = `${switchId}-description`;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex-1 min-w-0">
        <label
          id={switchId}
          className="text-sm font-medium text-foreground cursor-pointer break-words"
        >
          {label}
        </label>
        <p id={descriptionId} className="text-xs mt-0.5 text-muted-foreground break-words">
          {description}
        </p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-labelledby={switchId}
        aria-describedby={descriptionId}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={cn(
          'relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          checked ? 'bg-green-500' : 'bg-zinc-600'
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1'
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
};

interface NotificationsSettingsSectionProps {
  /** Compact mode for mobile accordion */
  compact?: boolean;
}

export const NotificationsSettingsSection: React.FC<NotificationsSettingsSectionProps> = ({
  compact = false,
}) => {
  // Notification settings state (could be moved to a store/hook)
  const [bookProcessing, setBookProcessing] = useState(true);
  const [imageGeneration, setImageGeneration] = useState(true);
  const [readingReminders, setReadingReminders] = useState(false);

  // iOS Push readiness state
  const { needsGuidance: needsIOSPushGuidance } = useIOSPushReadiness();

  const notifications = [
    {
      checked: bookProcessing,
      onChange: setBookProcessing,
      label: 'Обработка книги',
      description: compact
        ? 'Уведомление о завершении обработки'
        : 'Получать уведомление когда обработка книги завершена',
    },
    {
      checked: imageGeneration,
      onChange: setImageGeneration,
      label: 'Генерация изображений',
      description: compact
        ? 'Уведомление о новых изображениях'
        : 'Получать уведомление когда создаются новые изображения',
    },
    {
      checked: readingReminders,
      onChange: setReadingReminders,
      label: 'Напоминания о чтении',
      description: compact
        ? 'Напоминания продолжить чтение'
        : 'Получать напоминания продолжить чтение',
    },
  ];

  if (compact) {
    return (
      <div className="space-y-4">
        {/* iOS Push Guidance - compact version for mobile */}
        {needsIOSPushGuidance && (
          <IOSPushGuidance className="mb-2" />
        )}

        <div className="space-y-2">
          {notifications.map((notification, index) => (
            <React.Fragment key={notification.label}>
              <ToggleSwitch {...notification} />
              {index < notifications.length - 1 && (
                <div className="h-px bg-border" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* iOS Push Guidance - shows only for iOS Safari users not in PWA mode */}
      {needsIOSPushGuidance && (
        <IOSPushGuidance expanded className="mb-2" />
      )}

      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground">
          Настройки уведомлений
        </h3>
        <div className="space-y-2">
          {notifications.map((notification, index) => (
            <React.Fragment key={notification.label}>
              <ToggleSwitch {...notification} />
              {index < notifications.length - 1 && (
                <div className="h-px bg-border" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

// Export ToggleSwitch for use in other settings sections
export { ToggleSwitch };
