import React from 'react';
import { Type, Palette, Monitor, RotateCcw } from 'lucide-react';
import { useReaderStore } from '@/stores/reader';
import { notify } from '@/stores/ui';
import { useTranslation } from 'react-i18next';

const ReaderSettings: React.FC = () => {
  const {
    fontSize,
    fontFamily,
    lineHeight,
    theme,
    backgroundColor,
    textColor,
    maxWidth,
    margin,
    updateFontSize,
    updateFontFamily,
    updateLineHeight,
    updateTheme,
    resetSettings,
  } = useReaderStore();

  const { t } = useTranslation();

  const fontFamilyOptions = [
    { value: 'Georgia, serif', label: 'Georgia (Serif)', category: 'serif' },
    { value: 'Times New Roman, serif', label: 'Times New Roman', category: 'serif' },
    { value: 'Arial, sans-serif', label: 'Arial (Sans-serif)', category: 'sans-serif' },
    { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica', category: 'sans-serif' },
    { value: '"Open Sans", sans-serif', label: 'Open Sans', category: 'sans-serif' },
    { value: '"Courier New", monospace', label: 'Courier New (Mono)', category: 'monospace' },
  ];

  const themeOptions = [
    { value: 'light', label: t('readerSettings.light'), description: t('readerSettings.lightDesc') },
    { value: 'dark', label: t('readerSettings.dark'), description: t('readerSettings.darkDesc') },
    { value: 'sepia', label: t('readerSettings.sepia'), description: t('readerSettings.sepiaDesc') },
  ];

  const handleReset = () => {
    resetSettings();
    notify.success(t('readerSettings.settingsReset'), t('readerSettings.settingsResetDesc'));
  };

  return (
    <div className="space-y-8 max-w-full overflow-hidden">
      {/* Font Settings */}
      <div>
        <div className="flex items-center space-x-2 mb-4">
          <Type className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium text-foreground">
            {t('readerSettings.fontSettings')}
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Font Size */}
          <div className="min-w-0">
            <label className="block text-sm font-medium text-foreground mb-2 break-words">
              {t('readerSettings.fontSize')}: {fontSize}px
            </label>
            <input
              type="range"
              min="12"
              max="32"
              step="1"
              value={fontSize}
              onChange={(e) => updateFontSize(Number(e.target.value))}
              className="w-full max-w-full h-11 bg-transparent rounded-lg appearance-none cursor-pointer touch-pan-x
                       [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:bg-zinc-300 [&::-webkit-slider-runnable-track]:dark:bg-zinc-600 [&::-webkit-slider-runnable-track]:rounded-full
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-10px]
                       [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
                       [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
                       [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                       [&::-moz-range-track]:h-2 [&::-moz-range-track]:bg-zinc-300 [&::-moz-range-track]:dark:bg-zinc-600 [&::-moz-range-track]:rounded-full
                       [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:border-0
                       [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary
                       [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>12px</span>
              <span>22px</span>
              <span>32px</span>
            </div>
          </div>

          {/* Line Height */}
          <div className="min-w-0">
            <label className="block text-sm font-medium text-foreground mb-2 break-words">
              {t('readerSettings.lineHeight')}: {lineHeight.toFixed(1)}
            </label>
            <input
              type="range"
              min="1.2"
              max="2.5"
              step="0.1"
              value={lineHeight}
              onChange={(e) => updateLineHeight(Number(e.target.value))}
              className="w-full max-w-full h-11 bg-transparent rounded-lg appearance-none cursor-pointer touch-pan-x
                       [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:bg-zinc-300 [&::-webkit-slider-runnable-track]:dark:bg-zinc-600 [&::-webkit-slider-runnable-track]:rounded-full
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-10px]
                       [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
                       [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
                       [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                       [&::-moz-range-track]:h-2 [&::-moz-range-track]:bg-zinc-300 [&::-moz-range-track]:dark:bg-zinc-600 [&::-moz-range-track]:rounded-full
                       [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:border-0
                       [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary
                       [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{t('readerSettings.tight')}</span>
              <span>{t('readerSettings.normal')}</span>
              <span>{t('readerSettings.loose')}</span>
            </div>
          </div>

          {/* Font Family */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('readerSettings.fontFamily')}
            </label>
            <select
              value={fontFamily}
              onChange={(e) => updateFontFamily(e.target.value)}
              className="w-full px-3 py-2 min-h-[44px] border border-input rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
            >
              <optgroup label={t('readerSettings.serifFonts')}>
                {fontFamilyOptions.filter(f => f.category === 'serif').map(font => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('readerSettings.sansSerifFonts')}>
                {fontFamilyOptions.filter(f => f.category === 'sans-serif').map(font => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('readerSettings.monospaceFonts')}>
                {fontFamilyOptions.filter(f => f.category === 'monospace').map(font => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>
      </div>

      {/* Theme Settings */}
      <div>
        <div className="flex items-center space-x-2 mb-4">
          <Palette className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium text-foreground">
            {t('readerSettings.themeSettings')}
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="radiogroup" aria-label={t('readerSettings.themeSettings')}>
          {themeOptions.map((themeOption) => (
            <div
              key={themeOption.value}
              role="radio"
              aria-checked={theme === themeOption.value}
              tabIndex={0}
              className={`relative p-4 border-2 rounded-lg cursor-pointer transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                theme === themeOption.value
                  ? 'border-primary bg-primary/5 dark:bg-primary/20'
                  : 'border-input hover:border-muted-foreground'
              }`}
              onClick={() => updateTheme(themeOption.value as 'light' | 'dark' | 'sepia')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  updateTheme(themeOption.value as 'light' | 'dark' | 'sepia');
                }
              }}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-lg ${
                  themeOption.value === 'light' ? 'bg-white border-2 border-input' :
                  themeOption.value === 'dark' ? 'bg-zinc-800' :
                  'bg-yellow-100'
                }`} />
                <div>
                  <p className="font-medium text-foreground">
                    {themeOption.label}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {themeOption.description}
                  </p>
                </div>
              </div>
              {theme === themeOption.value && (
                <div className="absolute top-2 right-2 w-4 h-4 bg-primary rounded-full" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="min-w-0">
        <div className="flex items-center space-x-2 mb-4">
          <Monitor className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium text-foreground">
            {t('readerSettings.preview')}
          </h3>
        </div>

        <div
          className="p-4 sm:p-6 border border-input rounded-lg overflow-hidden break-words"
          style={{
            backgroundColor: backgroundColor,
            color: textColor,
            fontFamily: fontFamily,
            fontSize: `${fontSize}px`,
            lineHeight: lineHeight,
            maxWidth: `min(${maxWidth}px, 100%)`,
          }}
        >
          <p className="mb-4 break-words">
            <strong>{t('readerSettings.sampleText')}</strong>
          </p>
          <p className="mb-3 break-words">
            {t('readerSettings.sampleParagraph1')}
          </p>
          <p className="mb-3 break-words">
            {t('readerSettings.sampleQuote')}
          </p>
          <p className="break-words">
            {t('readerSettings.sampleParagraph2')}
          </p>
        </div>
      </div>

      {/* Advanced Settings */}
      <div>
        <h3 className="text-lg font-medium text-foreground mb-4">
          {t('readerSettings.advancedSettings')}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Max Width */}
          <div className="min-w-0">
            <label className="block text-sm font-medium text-foreground mb-2 break-words">
              {t('readerSettings.maxWidth')}: {maxWidth}px
            </label>
            <input
              type="range"
              min="600"
              max="1200"
              step="50"
              value={maxWidth}
              onChange={(e) => useReaderStore.setState({ maxWidth: Number(e.target.value) })}
              className="w-full max-w-full h-11 bg-transparent rounded-lg appearance-none cursor-pointer touch-pan-x
                       [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:bg-zinc-300 [&::-webkit-slider-runnable-track]:dark:bg-zinc-600 [&::-webkit-slider-runnable-track]:rounded-full
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-10px]
                       [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
                       [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
                       [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                       [&::-moz-range-track]:h-2 [&::-moz-range-track]:bg-zinc-300 [&::-moz-range-track]:dark:bg-zinc-600 [&::-moz-range-track]:rounded-full
                       [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:border-0
                       [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary
                       [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{t('readerSettings.narrow')}</span>
              <span>{t('readerSettings.medium')}</span>
              <span>{t('readerSettings.wide')}</span>
            </div>
          </div>

          {/* Margin */}
          <div className="min-w-0">
            <label className="block text-sm font-medium text-foreground mb-2 break-words">
              {t('readerSettings.pageMargin')}: {margin}px
            </label>
            <input
              type="range"
              min="20"
              max="80"
              step="10"
              value={margin}
              onChange={(e) => useReaderStore.setState({ margin: Number(e.target.value) })}
              className="w-full max-w-full h-11 bg-transparent rounded-lg appearance-none cursor-pointer touch-pan-x
                       [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:bg-zinc-300 [&::-webkit-slider-runnable-track]:dark:bg-zinc-600 [&::-webkit-slider-runnable-track]:rounded-full
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-10px]
                       [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
                       [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
                       [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                       [&::-moz-range-track]:h-2 [&::-moz-range-track]:bg-zinc-300 [&::-moz-range-track]:dark:bg-zinc-600 [&::-moz-range-track]:rounded-full
                       [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:border-0
                       [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary
                       [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{t('readerSettings.minimal')}</span>
              <span>{t('readerSettings.standard')}</span>
              <span>{t('readerSettings.spacious')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Reset Button */}
      <div className="flex justify-end pt-6 border-t border-border">
        <button
          onClick={handleReset}
          className="inline-flex items-center px-4 py-2 min-h-[44px] border border-input rounded-lg text-sm font-medium text-foreground bg-background hover:bg-muted focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          {t('readerSettings.resetToDefaults')}
        </button>
      </div>

    </div>
  );
};

export default ReaderSettings;
