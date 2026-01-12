/**
 * AboutSettingsSection - Unified about/info settings component
 *
 * Features:
 * - App version display
 * - Description
 * - Tech stack information
 * - Links to resources
 * - Responsive design with compact mode
 */

import React from 'react';

interface AboutSettingsSectionProps {
  /** Compact mode for mobile accordion */
  compact?: boolean;
}

const techStack = {
  full: [
    { label: 'Frontend', value: 'React 18 + TypeScript' },
    { label: 'Backend', value: 'FastAPI + Python' },
    { label: 'База данных', value: 'PostgreSQL 15+' },
    { label: 'AI', value: 'Multi-NLP + pollinations.ai' },
  ],
  compact: [
    { label: 'Frontend', value: 'React + TypeScript' },
    { label: 'Backend', value: 'FastAPI + Python' },
  ],
};

export const AboutSettingsSection: React.FC<AboutSettingsSectionProps> = ({
  compact = false,
}) => {
  const stack = compact ? techStack.compact : techStack.full;

  if (compact) {
    return (
      <div className="space-y-4">
        <div>
          <p className="font-semibold text-sm text-foreground">Версия</p>
          <p className="text-xs text-muted-foreground">1.0.0 (Бета)</p>
        </div>
        <div>
          <p className="font-semibold text-sm mb-1 text-foreground">Описание</p>
          <p className="text-xs text-muted-foreground">
            AI-генерация изображений из описаний книг для улучшенного чтения.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {stack.map((item, index) => (
            <div key={index} className="p-2 rounded-lg border bg-muted border-border">
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
              <p className="text-xs font-semibold text-foreground">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      <div>
        <h3 className="text-xl font-bold mb-6 text-foreground break-words">
          О fancai
        </h3>
        <div className="space-y-6">
          {/* Version */}
          <div>
            <p className="font-semibold mb-2 text-foreground">
              Версия
            </p>
            <p className="text-sm text-muted-foreground">
              1.0.0 (Бета)
            </p>
          </div>

          {/* Description */}
          <div>
            <p className="font-semibold mb-2 text-foreground">
              Описание
            </p>
            <p className="text-sm text-muted-foreground break-words">
              Преобразите ваше чтение с AI-генерацией изображений из описаний книг.
              Умная система распознавания текста находит описания локаций, персонажей
              и атмосферы, создавая уникальные визуализации для каждой книги.
            </p>
          </div>

          {/* Tech Stack */}
          <div>
            <p className="font-semibold mb-3 text-foreground">
              Технологический стек
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {stack.map((item, index) => (
                <div
                  key={index}
                  className="p-3 rounded-xl border-2 bg-muted border-border min-w-0"
                >
                  <p className="text-xs font-medium mb-1 text-muted-foreground break-words">
                    {item.label}
                  </p>
                  <p className="text-sm font-semibold text-foreground break-words">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Links */}
          <div className="pt-6 border-t border-border">
            <div className="flex flex-wrap gap-4">
              <a
                href="https://github.com"
                className="text-sm font-medium hover:underline text-primary"
              >
                GitHub
              </a>
              <a
                href="#"
                className="text-sm font-medium hover:underline text-primary"
              >
                Документация
              </a>
              <a
                href="#"
                className="text-sm font-medium hover:underline text-primary"
              >
                Поддержка
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
