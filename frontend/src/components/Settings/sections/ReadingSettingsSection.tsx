/**
 * ReadingSettingsSection - Unified reading settings component
 *
 * Features:
 * - Font size, family, line height controls
 * - Reader theme selection
 * - Live preview
 * - Responsive design with compact mode
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/UI/button';
import { Slider } from '@/components/UI/slider';
import { Select, type SelectOption } from '@/components/UI/Select';
import { useReaderStore, type ReaderTheme } from '@/stores/reader';

// Font family options for the reader
const fontFamilyOptions: SelectOption[] = [
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'system-ui, sans-serif', label: 'System' },
  { value: "'Courier New', monospace", label: 'Courier' },
  { value: "'Literata', Georgia, serif", label: 'Literata' },
];

// Reader theme colors for preview
const readerThemeStyles: Record<ReaderTheme, { backgroundColor: string; textColor: string; label: string }> = {
  light: { backgroundColor: '#FFFFFF', textColor: '#1A1A1A', label: 'Svetlaya' },
  dark: { backgroundColor: '#121212', textColor: '#E0E0E0', label: 'Tyomnaya' },
  sepia: { backgroundColor: '#FBF0D9', textColor: '#3D2914', label: 'Sepiya' },
  night: { backgroundColor: '#000000', textColor: '#B0B0B0', label: 'Nochnaya' },
  outdoor: { backgroundColor: '#FFFEF5', textColor: '#000000', label: 'Na ulice' },
};

// Theme label translation keys
const themeLabelKeys: Record<ReaderTheme, string> = {
  light: 'readingSettings.theme_light',
  dark: 'readingSettings.theme_dark',
  sepia: 'readingSettings.theme_sepia',
  night: 'readingSettings.theme_night',
  outdoor: 'readingSettings.theme_outdoor',
};

interface ReadingSettingsSectionProps {
  /** Compact mode for mobile accordion */
  compact?: boolean;
}

export const ReadingSettingsSection: React.FC<ReadingSettingsSectionProps> = ({
  compact = false,
}) => {
  const { t } = useTranslation();
  const {
    fontSize,
    fontFamily,
    lineHeight,
    theme: readerTheme,
    updateFontSize,
    updateFontFamily,
    updateLineHeight,
    updateTheme,
    resetSettings,
  } = useReaderStore();

  const themes = Object.keys(readerThemeStyles) as ReaderTheme[];

  if (compact) {
    return (
      <div className="space-y-4">
        {/* Compact Preview Block for Mobile */}
        <div
          className="p-3 rounded-lg border-2 border-dashed border-border transition-all duration-300"
          style={{
            fontSize: `${Math.min(fontSize, 18)}px`,
            fontFamily: fontFamily,
            lineHeight: lineHeight,
            backgroundColor: readerThemeStyles[readerTheme].backgroundColor,
            color: readerThemeStyles[readerTheme].textColor,
          }}
        >
          <p>
            {t('readingSettings.preview_text')}
          </p>
        </div>

        {/* Font Size */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-foreground">
              {t('readingSettings.font_size')}
            </label>
            <span className="text-sm font-semibold text-primary">
              {fontSize}px
            </span>
          </div>
          <Slider
            value={[fontSize]}
            min={12}
            max={32}
            step={1}
            onValueChange={(value) => updateFontSize(value[0])}
          />
        </div>

        {/* Font Family */}
        <div>
          <label className="block text-sm font-medium mb-2 text-foreground">
            {t('readingSettings.font_family')}
          </label>
          <Select
            value={fontFamily}
            onChange={(e) => updateFontFamily(e.target.value)}
            options={fontFamilyOptions}
          />
        </div>

        {/* Line Height */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-foreground">
              {t('readingSettings.line_height')}
            </label>
            <span className="text-sm font-semibold text-primary">
              {lineHeight.toFixed(1)}
            </span>
          </div>
          <Slider
            value={[lineHeight]}
            min={1.2}
            max={2.5}
            step={0.1}
            onValueChange={(value) => updateLineHeight(value[0])}
          />
        </div>

        {/* Reader Theme - Compact Grid for Mobile */}
        <div>
          <label className="block text-sm font-medium mb-2 text-foreground">
            {t('readingSettings.reader_theme')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {themes.slice(0, 3).map((themeKey) => {
              const themeStyle = readerThemeStyles[themeKey];
              const isActive = readerTheme === themeKey;
              return (
                <button
                  key={themeKey}
                  onClick={() => updateTheme(themeKey)}
                  className={cn(
                    'px-3 py-2 rounded-lg border-2 text-xs font-medium transition-all min-h-[44px]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-border'
                  )}
                  style={{
                    backgroundColor: themeStyle.backgroundColor,
                    color: themeStyle.textColor,
                  }}
                >
                  {t(themeLabelKeys[themeKey])}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {themes.slice(3).map((themeKey) => {
              const themeStyle = readerThemeStyles[themeKey];
              const isActive = readerTheme === themeKey;
              return (
                <button
                  key={themeKey}
                  onClick={() => updateTheme(themeKey)}
                  className={cn(
                    'px-3 py-2 rounded-lg border-2 text-xs font-medium transition-all min-h-[44px]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-border'
                  )}
                  style={{
                    backgroundColor: themeStyle.backgroundColor,
                    color: themeStyle.textColor,
                  }}
                >
                  {t(themeLabelKeys[themeKey])}
                </button>
              );
            })}
          </div>
        </div>

        {/* Reset Button */}
        <Button
          variant="secondary"
          size="sm"
          onClick={resetSettings}
          className="w-full gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          {t('readingSettings.reset')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-6">
          <BookOpen className="w-6 h-6 text-primary" />
          <h3 className="text-xl font-bold text-foreground">
            {t('readingSettings.title')}
          </h3>
        </div>

        {/* Preview Block */}
        <div
          className="p-4 sm:p-6 rounded-xl border-2 border-dashed border-border mb-6 transition-all duration-300"
          style={{
            fontSize: `${fontSize}px`,
            fontFamily: fontFamily,
            lineHeight: lineHeight,
            backgroundColor: readerThemeStyles[readerTheme].backgroundColor,
            color: readerThemeStyles[readerTheme].textColor,
          }}
        >
          <p className="mb-2">
            {t('readingSettings.preview_text')}
          </p>
          <p>
            {t('readingSettings.preview_text_full')}
          </p>
        </div>

        {/* Settings Grid */}
        <div className="space-y-6">
          {/* Font Size */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-foreground">
                {t('readingSettings.font_size')}
              </label>
              <span className="text-sm font-semibold text-primary">
                {fontSize}px
              </span>
            </div>
            <Slider
              value={[fontSize]}
              min={12}
              max={32}
              step={1}
              onValueChange={(value) => updateFontSize(value[0])}
            />
            <div className="flex justify-between mt-1">
              <span className="text-xs text-muted-foreground">12px</span>
              <span className="text-xs text-muted-foreground">32px</span>
            </div>
          </div>

          {/* Font Family */}
          <div>
            <label className="block text-sm font-medium mb-2 text-foreground">
              {t('readingSettings.font_family')}
            </label>
            <Select
              value={fontFamily}
              onChange={(e) => updateFontFamily(e.target.value)}
              options={fontFamilyOptions}
            />
          </div>

          {/* Line Height */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-foreground">
                {t('readingSettings.line_height')}
              </label>
              <span className="text-sm font-semibold text-primary">
                {lineHeight.toFixed(1)}
              </span>
            </div>
            <Slider
              value={[lineHeight]}
              min={1.2}
              max={2.5}
              step={0.1}
              onValueChange={(value) => updateLineHeight(value[0])}
            />
            <div className="flex justify-between mt-1">
              <span className="text-xs text-muted-foreground">1.2</span>
              <span className="text-xs text-muted-foreground">2.5</span>
            </div>
          </div>

          {/* Reader Theme */}
          <div>
            <label className="block text-sm font-medium mb-3 text-foreground">
              {t('readingSettings.reader_theme')}
            </label>
            <div className="flex flex-wrap gap-2">
              {themes.map((themeKey) => {
                const themeStyle = readerThemeStyles[themeKey];
                const isActive = readerTheme === themeKey;
                return (
                  <button
                    key={themeKey}
                    onClick={() => updateTheme(themeKey)}
                    className={cn(
                      'px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all min-h-[44px]',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      isActive
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-border hover:border-primary/50'
                    )}
                    style={{
                      backgroundColor: themeStyle.backgroundColor,
                      color: themeStyle.textColor,
                    }}
                  >
                    {t(themeLabelKeys[themeKey])}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reset Button */}
          <div className="pt-4 border-t border-border">
            <Button
              variant="secondary"
              onClick={resetSettings}
              className="gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              {t('readingSettings.reset')}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              {t('readingSettings.reset_desc')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
