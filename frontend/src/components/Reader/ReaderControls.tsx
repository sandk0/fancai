import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, FileText, Minus, Plus, Hand, MousePointerClick, Settings, Type, Eye } from 'lucide-react';
import { isAndroid } from '@/utils/iosSupport';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/UI/dropdown-menu';
import { Switch } from '@/components/UI/Switch';
import { cn } from '@/lib/utils';
import type { ThemeName } from '@/hooks/epub/useEpubThemes';
import type { NavigationMode, DescriptionDensity } from '@/stores/reader';

interface ReaderControlsProps {
  theme: ThemeName; fontSize: number; onThemeChange: (t: ThemeName) => void;
  onFontSizeIncrease: () => void; onFontSizeDecrease: () => void;
  isOpen: boolean; onOpenChange: (o: boolean) => void; className?: string;
  wakeLockEnabled?: boolean; wakeLockSupported?: boolean; wakeLockActive?: boolean;
  onWakeLockChange?: (e: boolean) => void; navigationMode?: NavigationMode;
  onNavigationModeChange?: (m: NavigationMode) => void;
  nameHighlightingEnabled?: boolean; onNameHighlightingChange?: (e: boolean) => void;
  descriptionDensity?: DescriptionDensity; onDescriptionDensityChange?: (d: DescriptionDensity) => void;
}

export const ReaderControls: React.FC<ReaderControlsProps> = React.memo(function ReaderControls({
  theme, fontSize, onThemeChange, onFontSizeIncrease, onFontSizeDecrease, isOpen, onOpenChange,
  className, wakeLockEnabled, wakeLockSupported, wakeLockActive, onWakeLockChange, navigationMode, onNavigationModeChange,
  nameHighlightingEnabled, onNameHighlightingChange, descriptionDensity, onDescriptionDensityChange,
}) {
  const { t } = useTranslation();
  const showNav = isAndroid() && onNavigationModeChange;
  return (
    <div className={className}>
      <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild><div /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] sm:w-80 backdrop-blur-md bg-popover/95 p-0">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Settings className="h-4 w-4 opacity-50" />
            <h3 className="font-semibold">{t('reader.settings.title')}</h3>
          </div>
          <div className="px-4 py-3">
            <label className="text-xs mb-2 block opacity-70">{t('reader.settings.theme')}</label>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => onThemeChange('light')} className={cn("px-3 py-2 rounded-md flex items-center justify-center gap-1.5", theme === 'light' ? "bg-primary text-primary-foreground" : "bg-card border")}>
                <Sun className="h-4 w-4" />{t('reader.settings.themes.light')}
              </button>
              <button onClick={() => onThemeChange('dark')} className={cn("px-3 py-2 rounded-md flex items-center justify-center gap-1.5", theme === 'dark' ? "bg-primary text-primary-foreground" : "bg-card border")}>
                <Moon className="h-4 w-4" />{t('reader.settings.themes.dark')}
              </button>
              <button onClick={() => onThemeChange('sepia')} className={cn("px-3 py-2 rounded-md flex items-center justify-center gap-1.5", theme === 'sepia' ? "bg-primary text-primary-foreground" : "bg-card border")}>
                <FileText className="h-4 w-4" />{t('reader.settings.themes.sepia')}
              </button>
            </div>
          </div>
          <div className="px-4 py-3 border-t">
            <label className="text-xs mb-2 block opacity-70">{t('reader.settings.font_size')}</label>
            <div className="flex items-center gap-3">
              <button onClick={onFontSizeDecrease} disabled={fontSize <= 75} className="h-10 w-10 border rounded-sm flex items-center justify-center" aria-label={t('reader.settings.decrease_font_size')}><Minus className="h-4 w-4" aria-hidden="true" /></button>
              <span className="flex-1 text-center font-bold">{fontSize}%</span>
              <button onClick={onFontSizeIncrease} disabled={fontSize >= 200} className="h-10 w-10 border rounded-sm flex items-center justify-center" aria-label={t('reader.settings.increase_font_size')}><Plus className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </div>
          {wakeLockSupported && onWakeLockChange && (
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <div><div className="text-sm font-medium">{t('reader.settings.wake_lock')}</div><div className="text-xs opacity-60">{wakeLockActive ? t('reader.settings.wake_lock_active') : wakeLockEnabled ? t('reader.settings.wake_lock_enabled') : t('reader.settings.wake_lock_disabled')}</div></div>
              <Switch checked={wakeLockEnabled} onChange={onWakeLockChange} />
            </div>
          )}
          {showNav && (
            <div className="px-4 py-3 border-t">
              <label className="text-xs mb-2 block opacity-70">{t('reader.settings.navigation')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onNavigationModeChange?.('swipe')} className={cn("p-2 rounded-sm flex flex-col items-center", navigationMode === 'swipe' ? "bg-primary text-primary-foreground" : "bg-card border")}>
                  <Hand className="h-4 w-4" /><span>{t('reader.settings.nav_swipe')}</span>
                </button>
                <button onClick={() => onNavigationModeChange?.('tap')} className={cn("p-2 rounded-sm flex flex-col items-center", navigationMode === 'tap' ? "bg-primary text-primary-foreground" : "bg-card border")}>
                  <MousePointerClick className="h-4 w-4" /><span>{t('reader.settings.nav_tap')}</span>
                </button>
              </div>
            </div>
          )}
          {onNameHighlightingChange && (
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Type className="h-4 w-4 opacity-50" />
                <span className="text-sm font-medium">{t('entities.name_highlighting')}</span>
              </div>
              <Switch checked={nameHighlightingEnabled} onChange={onNameHighlightingChange} />
            </div>
          )}
          {onDescriptionDensityChange && (
            <div className="px-4 py-3 border-t">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="h-4 w-4 opacity-50" />
                <label className="text-xs opacity-70">{t('entities.description_density')}</label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['all', 'key', 'off'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => onDescriptionDensityChange(d)}
                    className={cn(
                      "px-2 py-1.5 rounded-sm text-sm",
                      descriptionDensity === d ? "bg-primary text-primary-foreground" : "bg-card border"
                    )}
                  >
                    {t(`entities.density_${d}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
