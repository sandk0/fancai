import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sun,
  Moon,
  FileText,
  Minus,
  Plus,
  Hand,
  MousePointerClick,
  Settings,
  Type,
  Eye,
} from 'lucide-react';
import { isAndroid } from '@/utils/iosSupport';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/UI/dropdown-menu';
import { Switch } from '@/components/UI/Switch';
import { MobilePanel } from '@/components/UI/MobilePanel';
import { useIsMobile } from '@/hooks/shared/useIsMobile';
import { cn } from '@/lib/utils';
import type { ThemeName } from '@/hooks/epub/useEpubThemes';
import type { NavigationMode, DescriptionDensity, DescriptionHighlightMode } from '@/stores/reader';

interface ReaderControlsProps {
  theme: ThemeName;
  fontSize: number;
  onThemeChange: (t: ThemeName) => void;
  onFontSizeIncrease: () => void;
  onFontSizeDecrease: () => void;
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
  className?: string;
  wakeLockEnabled?: boolean;
  wakeLockSupported?: boolean;
  wakeLockActive?: boolean;
  onWakeLockChange?: (e: boolean) => void;
  navigationMode?: NavigationMode;
  onNavigationModeChange?: (m: NavigationMode) => void;
  nameHighlightingEnabled?: boolean;
  onNameHighlightingChange?: (e: boolean) => void;
  descriptionDensity?: DescriptionDensity;
  onDescriptionDensityChange?: (d: DescriptionDensity) => void;
  highlightMode?: DescriptionHighlightMode;
  onHighlightModeChange?: (mode: DescriptionHighlightMode) => void;
  pageAnimationEnabled?: boolean;
  onPageAnimationChange?: (enabled: boolean) => void;
}

export const ReaderControls: React.FC<ReaderControlsProps> = React.memo(function ReaderControls({
  theme,
  fontSize,
  onThemeChange,
  onFontSizeIncrease,
  onFontSizeDecrease,
  isOpen,
  onOpenChange,
  className,
  wakeLockEnabled,
  wakeLockSupported,
  wakeLockActive,
  onWakeLockChange,
  navigationMode,
  onNavigationModeChange,
  nameHighlightingEnabled,
  onNameHighlightingChange,
  descriptionDensity,
  onDescriptionDensityChange,
  highlightMode,
  onHighlightModeChange,
  pageAnimationEnabled,
  onPageAnimationChange,
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const showNav = isAndroid() && onNavigationModeChange;

  const settingsContent = (
    <>
      {/* Theme */}
      <div className="px-4 py-3">
        <label className="text-xs mb-2 block opacity-70">{t('reader.settings.theme')}</label>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onThemeChange('light')}
            className={cn(
              'px-3 py-2 min-h-[44px] rounded-md flex items-center justify-center gap-1.5',
              theme === 'light' ? 'bg-primary text-primary-foreground' : 'bg-card border'
            )}
          >
            <Sun className="h-4 w-4" />
            {t('reader.settings.themes.light')}
          </button>
          <button
            onClick={() => onThemeChange('dark')}
            className={cn(
              'px-3 py-2 min-h-[44px] rounded-md flex items-center justify-center gap-1.5',
              theme === 'dark' ? 'bg-primary text-primary-foreground' : 'bg-card border'
            )}
          >
            <Moon className="h-4 w-4" />
            {t('reader.settings.themes.dark')}
          </button>
          <button
            onClick={() => onThemeChange('sepia')}
            className={cn(
              'px-3 py-2 min-h-[44px] rounded-md flex items-center justify-center gap-1.5',
              theme === 'sepia' ? 'bg-primary text-primary-foreground' : 'bg-card border'
            )}
          >
            <FileText className="h-4 w-4" />
            {t('reader.settings.themes.sepia')}
          </button>
        </div>
      </div>

      {/* Font size */}
      <div className="px-4 py-3 border-t">
        <label className="text-xs mb-2 block opacity-70">{t('reader.settings.font_size')}</label>
        <div className="flex items-center gap-3">
          <button
            onClick={onFontSizeDecrease}
            disabled={fontSize <= 75}
            className="h-11 w-11 border rounded-sm flex items-center justify-center"
            aria-label={t('reader.settings.decrease_font_size')}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="flex-1 text-center font-bold">{fontSize}%</span>
          <button
            onClick={onFontSizeIncrease}
            disabled={fontSize >= 200}
            className="h-11 w-11 border rounded-sm flex items-center justify-center"
            aria-label={t('reader.settings.increase_font_size')}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Wake lock */}
      {wakeLockSupported && onWakeLockChange && (
        <div className="px-4 py-3 border-t flex items-center justify-between min-h-[44px]">
          <div>
            <div className="text-sm font-medium">{t('reader.settings.wake_lock')}</div>
            <div className="text-xs opacity-60">
              {wakeLockActive
                ? t('reader.settings.wake_lock_active')
                : wakeLockEnabled
                  ? t('reader.settings.wake_lock_enabled')
                  : t('reader.settings.wake_lock_disabled')}
            </div>
          </div>
          <Switch checked={wakeLockEnabled} onChange={onWakeLockChange} />
        </div>
      )}

      {/* Navigation mode (Android only) */}
      {showNav && (
        <div className="px-4 py-3 border-t">
          <label className="text-xs mb-2 block opacity-70">{t('reader.settings.navigation')}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onNavigationModeChange?.('swipe')}
              className={cn(
                'p-2 min-h-[44px] rounded-sm flex flex-col items-center',
                navigationMode === 'swipe' ? 'bg-primary text-primary-foreground' : 'bg-card border'
              )}
            >
              <Hand className="h-4 w-4" />
              <span>{t('reader.settings.nav_swipe')}</span>
            </button>
            <button
              onClick={() => onNavigationModeChange?.('tap')}
              className={cn(
                'p-2 min-h-[44px] rounded-sm flex flex-col items-center',
                navigationMode === 'tap' ? 'bg-primary text-primary-foreground' : 'bg-card border'
              )}
            >
              <MousePointerClick className="h-4 w-4" />
              <span>{t('reader.settings.nav_tap')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Page animation */}
      {onPageAnimationChange && (
        <div className="px-4 py-3 border-t flex items-center justify-between min-h-[44px]">
          <div>
            <div className="text-sm font-medium">{t('reader.readerSettings.pageAnimation')}</div>
            <div className="text-xs opacity-60">{t('reader.readerSettings.pageAnimationDesc')}</div>
          </div>
          <Switch checked={pageAnimationEnabled} onChange={onPageAnimationChange} />
        </div>
      )}

      {/* Name highlighting */}
      {onNameHighlightingChange && (
        <div className="px-4 py-3 border-t flex items-center justify-between min-h-[44px]">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 opacity-50" />
            <span className="text-sm font-medium">{t('entities.name_highlighting')}</span>
          </div>
          <Switch checked={nameHighlightingEnabled} onChange={onNameHighlightingChange} />
        </div>
      )}

      {/* Description density */}
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
                  'px-2 py-1.5 min-h-[44px] rounded-sm text-sm',
                  descriptionDensity === d ? 'bg-primary text-primary-foreground' : 'bg-card border'
                )}
              >
                {t(`entities.density_${d}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Description highlight mode */}
      {onHighlightModeChange && (
        <div className="px-4 py-3 border-t">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="h-4 w-4 opacity-50" />
            <label className="text-xs opacity-70">{t('entities.highlight_mode')}</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['anchor', 'full'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => onHighlightModeChange(mode)}
                className={cn(
                  'px-2 py-1.5 min-h-[44px] rounded-sm text-sm',
                  highlightMode === mode ? 'bg-primary text-primary-foreground' : 'bg-card border'
                )}
              >
                {t(`entities.highlight_mode_${mode}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  // Mobile: vaul bottom-sheet via MobilePanel
  if (isMobile) {
    return (
      <div className={className}>
        <MobilePanel
          isOpen={isOpen}
          onClose={() => onOpenChange(false)}
          title={t('reader.settings.title')}
          snapPoints={[0.5, 0.9]}
        >
          {settingsContent}
        </MobilePanel>
      </div>
    );
  }

  // Desktop: dropdown menu (original behavior)
  return (
    <div className={className}>
      <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <div />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[calc(100vw-2rem)] sm:w-80 backdrop-blur-md bg-popover/95 p-0"
        >
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Settings className="h-4 w-4 opacity-50" />
            <h3 className="font-semibold">{t('reader.settings.title')}</h3>
          </div>
          {settingsContent}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
