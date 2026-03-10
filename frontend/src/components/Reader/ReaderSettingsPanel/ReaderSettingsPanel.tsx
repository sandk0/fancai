/**
 * ReaderSettingsPanel - Modern settings panel for reading experience
 *
 * Features:
 * - Bottom sheet on mobile with drag-to-dismiss
 * - Side panel on desktop
 * - Backdrop blur and dimming
 * - Grouped settings (Theme, Typography, Layout)
 * - Touch-friendly controls (44px minimum)
 * - Framer Motion animations
 *
 * @component
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { m, AnimatePresence, PanInfo, useDragControls } from 'motion/react';
import { X, Type, Sun, Maximize2, RotateCcw, GripHorizontal, Smartphone, Hand } from 'lucide-react';
import type { NavigationMode, ReaderTheme } from '@/stores/reader';
import { useTranslation } from 'react-i18next';
import { Z_INDEX } from '@/lib/zIndex';
import { Switch } from '@/components/UI/Switch';
import { useFocusTrap } from '@/hooks/useFocusTrap';

import { useIsMobile } from './hooks';
import { themeConfigs, fontFamilyOptions, widthPresets, navigationModeOptions } from './config';
import {
  SectionHeader,
  SliderControl,
  StepperControl,
  ThemeButton,
  FontFamilyButton,
  WidthPresetButton,
  NavigationModeButton,
} from './components/Controls';

export interface ReaderSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  theme: ReaderTheme;
  maxWidth: number;
  margin: number;
  onFontSizeChange: (size: number) => void;
  onFontFamilyChange: (family: string) => void;
  onLineHeightChange: (height: number) => void;
  onThemeChange: (theme: ReaderTheme) => void;
  onMaxWidthChange: (width: number) => void;
  onMarginChange: (margin: number) => void;
  onReset?: () => void;
  /** Whether wake lock setting is enabled */
  wakeLockEnabled?: boolean;
  /** Whether wake lock API is supported by browser */
  wakeLockSupported?: boolean;
  /** Whether wake lock is currently active */
  wakeLockActive?: boolean;
  /** Callback when wake lock setting is toggled */
  onWakeLockChange?: (enabled: boolean) => void;
  /** Current navigation mode */
  navigationMode?: NavigationMode;
  /** Callback when navigation mode changes */
  onNavigationModeChange?: (mode: NavigationMode) => void;
  /** Whether device is iOS (navigation mode toggle hidden on iOS) */
  isIOS?: boolean;
  /** Whether page turn animation is enabled */
  pageAnimationEnabled?: boolean;
  /** Callback when page animation setting changes */
  onPageAnimationChange?: (enabled: boolean) => void;
}

export const ReaderSettingsPanel: React.FC<ReaderSettingsPanelProps> = React.memo(
  ({
    isOpen,
    onClose,
    fontSize,
    fontFamily,
    lineHeight,
    theme,
    maxWidth,
    margin,
    onFontSizeChange,
    onFontFamilyChange,
    onLineHeightChange,
    onThemeChange,
    onMaxWidthChange,
    onMarginChange,
    onReset,
    wakeLockEnabled,
    wakeLockSupported,
    wakeLockActive,
    onWakeLockChange,
    navigationMode = 'swipe',
    onNavigationModeChange,
    isIOS = false,
    pageAnimationEnabled,
    onPageAnimationChange,
  }) => {
    const { t } = useTranslation();
    const isMobile = useIsMobile();
    const dragControls = useDragControls();
    const [dragY, setDragY] = useState(0);
    const panelRef = useRef<HTMLDivElement>(null);

    useFocusTrap(isOpen, panelRef);

    // Handle escape key
    useEffect(() => {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && isOpen) onClose();
      };
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    // Prevent body scroll when panel is open on mobile
    useEffect(() => {
      if (isMobile && isOpen) {
        document.body.style.overflow = 'hidden';
        return () => {
          document.body.style.overflow = '';
        };
      }
    }, [isMobile, isOpen]);

    // Handle drag end for bottom sheet
    const handleDragEnd = useCallback(
      (_: unknown, info: PanInfo) => {
        if (info.offset.y > 100 || info.velocity.y > 500) {
          onClose();
        }
        setDragY(0);
      },
      [onClose]
    );

    // Get active width preset
    const activeWidthPreset =
      widthPresets.find((p) => Math.abs(p.value - maxWidth) < 50)?.value || maxWidth;

    // Panel content
    const panelContent = (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          {isMobile && (
            <div className="absolute left-1/2 -translate-x-1/2 top-2">
              <GripHorizontal className="w-8 h-1 text-muted-foreground/50" />
            </div>
          )}
          <h2 id="reader-settings-title" className="text-lg font-semibold text-foreground">
            {t('reader.readerSettings.title')}
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-11 h-11 -mr-2
                     rounded-lg hover:bg-muted transition-colors touch-target"
            aria-label="Close settings"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6 space-y-8">
          {/* Theme Section */}
          <section>
            <SectionHeader
              icon={<Sun className="w-5 h-5" />}
              title={t('reader.readerSettings.theme')}
            />
            <div className="grid grid-cols-5 gap-2">
              {(Object.keys(themeConfigs) as ReaderTheme[]).map((themeKey) => (
                <ThemeButton
                  key={themeKey}
                  theme={themeKey}
                  isActive={theme === themeKey}
                  onClick={() => onThemeChange(themeKey)}
                />
              ))}
            </div>
          </section>

          {/* Typography Section */}
          <section>
            <SectionHeader
              icon={<Type className="w-5 h-5" />}
              title={t('reader.readerSettings.typography')}
            />
            <div className="space-y-6">
              {/* Font Size */}
              <StepperControl
                label={t('reader.readerSettings.fontSize')}
                value={fontSize}
                min={12}
                max={32}
                step={2}
                unit="px"
                onChange={onFontSizeChange}
              />

              {/* Font Family */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground block">
                  {t('reader.readerSettings.fontFamily')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {fontFamilyOptions.map((family) => (
                    <FontFamilyButton
                      key={family.value}
                      family={family}
                      isActive={fontFamily === family.value}
                      onClick={() => onFontFamilyChange(family.value)}
                    />
                  ))}
                </div>
              </div>

              {/* Line Height */}
              <SliderControl
                label={t('reader.readerSettings.lineHeight')}
                value={lineHeight}
                min={1.2}
                max={2.5}
                step={0.1}
                onChange={onLineHeightChange}
                formatValue={(v) => v.toFixed(1)}
              />
            </div>
          </section>

          {/* Layout Section */}
          <section>
            <SectionHeader
              icon={<Maximize2 className="w-5 h-5" />}
              title={t('reader.readerSettings.layout')}
            />
            <div className="space-y-6">
              {/* Text Width */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground block">
                  {t('reader.readerSettings.textWidth')}
                </label>
                <div className="flex gap-2">
                  {widthPresets.map((preset) => (
                    <WidthPresetButton
                      key={preset.value}
                      preset={preset}
                      isActive={activeWidthPreset === preset.value}
                      onClick={() => onMaxWidthChange(preset.value)}
                    />
                  ))}
                </div>
              </div>

              {/* Margins */}
              <SliderControl
                label={t('reader.readerSettings.margins')}
                value={margin}
                min={20}
                max={80}
                step={10}
                unit="px"
                onChange={onMarginChange}
              />
            </div>
          </section>

          {/* Navigation Section */}
          {((!isIOS && onNavigationModeChange) || onPageAnimationChange) && (
            <section>
              <SectionHeader
                icon={<Hand className="w-5 h-5" />}
                title={t('reader.readerSettings.navigation')}
              />
              <div className="space-y-4">
                {!isIOS && onNavigationModeChange && (
                  <div className="flex gap-3">
                    {navigationModeOptions.map((option) => (
                      <NavigationModeButton
                        key={option.value}
                        mode={option.value}
                        icon={option.icon}
                        label={t(
                          `reader.readerSettings.navigationMode${option.value.charAt(0).toUpperCase() + option.value.slice(1)}`
                        )}
                        description={t(
                          `reader.readerSettings.navigationMode${option.value.charAt(0).toUpperCase() + option.value.slice(1)}Desc`
                        )}
                        isActive={navigationMode === option.value}
                        onClick={() => onNavigationModeChange(option.value)}
                      />
                    ))}
                  </div>
                )}
                {onPageAnimationChange && (
                  <div className="bg-card rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">
                          {t('reader.readerSettings.pageAnimation')}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {t('reader.readerSettings.pageAnimationDesc')}
                        </div>
                      </div>
                      <Switch checked={pageAnimationEnabled} onChange={onPageAnimationChange} />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Wake Lock Section - only shown if browser supports it */}
          {wakeLockSupported && onWakeLockChange && (
            <section>
              <SectionHeader
                icon={<Smartphone className="w-5 h-5" />}
                title={t('reader.readerSettings.display')}
              />
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">
                      {t('reader.readerSettings.keepScreenOn')}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {wakeLockActive
                        ? t('reader.readerSettings.screenWillStayOn')
                        : wakeLockEnabled
                          ? t('reader.readerSettings.activatesWhileReading')
                          : t('reader.readerSettings.screenWillTurnOff')}
                    </div>
                  </div>
                  <Switch checked={wakeLockEnabled} onChange={onWakeLockChange} />
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Footer with reset button */}
        {onReset && (
          <div className="px-6 py-4 border-t border-border pb-safe">
            <button
              onClick={onReset}
              aria-label={t('reader.readerSettings.resetToDefaults')}
              className="w-full flex items-center justify-center gap-2 py-3 px-4
                       rounded-xl border-2 border-border bg-card
                       hover:bg-muted hover:border-muted-foreground/30
                       transition-colors touch-target text-muted-foreground
                       focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span className="text-sm font-medium">
                {t('reader.readerSettings.resetToDefaults')}
              </span>
            </button>
          </div>
        )}
      </div>
    );

    // Mobile bottom sheet
    const mobileSheet = (
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-settings-title"
        initial={{ y: '100%' }}
        animate={{ y: dragY }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring' as const, damping: 30, stiffness: 300 }}
        drag="y"
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDrag={(_, info) => setDragY(Math.max(0, info.offset.y))}
        onDragEnd={handleDragEnd}
        className="fixed inset-x-0 bottom-0 bg-background rounded-t-xl shadow-2xl
                 max-h-[90vh] flex flex-col touch-none pointer-events-auto"
        style={{ zIndex: Z_INDEX.modal }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center py-3 cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
        </div>
        {panelContent}
      </m.div>
    );

    // Desktop side panel
    const desktopPanel = (
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-settings-title"
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring' as const, damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 bottom-0 w-[380px] bg-background shadow-2xl
                 border-l border-border flex flex-col pointer-events-auto"
        style={{ zIndex: Z_INDEX.modal }}
      >
        {panelContent}
      </m.div>
    );

    return (
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto"
              style={{ zIndex: Z_INDEX.modalOverlay }}
              onClick={onClose}
              aria-hidden="true"
            />

            {/* Panel */}
            {isMobile ? mobileSheet : desktopPanel}
          </>
        )}
      </AnimatePresence>
    );
  }
);

ReaderSettingsPanel.displayName = 'ReaderSettingsPanel';

export default ReaderSettingsPanel;
