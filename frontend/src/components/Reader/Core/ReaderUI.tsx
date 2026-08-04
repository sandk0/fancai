import React from 'react';
import type { ReaderTheme, DescriptionHighlightMode } from '@/stores/reader';
import type { GenerationStatus } from '@/hooks/epub/useImageModal';
import { ReaderHeader } from '../ReaderHeader';
import { ReaderFooter } from '../ReaderFooter';
import { ReaderControls } from '../ReaderControls';
import { ImageGenerationStatus } from '../ImageGenerationStatus';
import { ProgressSaveIndicator } from '../ProgressSaveIndicator';

interface ReaderUIHeaderMetadata {
  title: string;
  author: string;
}

interface ReaderUIProps {
  isVisible: boolean;
  /** Whether header is visible (auto-hide control) */
  isHeaderVisible: boolean;
  header: {
    metadata: ReaderUIHeaderMetadata;
    onBack: () => void;
    onTocToggle: () => void;
    onSettingsOpen: () => void;
    onEntitiesOpen: () => void;
    onSearchToggle: () => void;
  };
  footer: {
    progress: number;
    currentPage?: number;
    totalPages?: number;
    chapterPage?: number;
    chapterTotalPages?: number;
  };
  settings: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    theme: ReaderTheme;
    fontSize: number;
    onThemeChange: (theme: ReaderTheme) => void;
    onFontSizeIncrease: () => void;
    onFontSizeDecrease: () => void;
    wakeLockEnabled: boolean;
    wakeLockSupported: boolean;
    wakeLockActive: boolean;
    onWakeLockChange: (enabled: boolean) => void;
    navigationMode: 'swipe' | 'tap';
    onNavigationModeChange: (mode: 'swipe' | 'tap') => void;
    nameHighlightingEnabled: boolean;
    onNameHighlightingChange: (enabled: boolean) => void;
    descriptionHighlightingEnabled: boolean;
    onDescriptionHighlightingChange: (enabled: boolean) => void;
    descriptionHighlightMode: DescriptionHighlightMode;
    onDescriptionHighlightModeChange: (mode: DescriptionHighlightMode) => void;
    pageAnimationEnabled: boolean;
    onPageAnimationChange: (enabled: boolean) => void;
  };
  imageStatus: {
    status: GenerationStatus;
    error: string | null;
    onCancel: () => void;
    descriptionPreview: string | null;
  };
  saveStatus: {
    lastSaved: Date | null;
    isSaving: boolean;
  };
}

export const ReaderUI: React.FC<ReaderUIProps> = ({
  isVisible,
  isHeaderVisible,
  header,
  footer,
  settings,
  imageStatus,
  saveStatus,
}) => {
  if (!isVisible) return null;

  return (
    <>
      <ReaderHeader
        isVisible={isHeaderVisible}
        title={header.metadata.title}
        author={header.metadata.author}
        onBack={header.onBack}
        onTocToggle={header.onTocToggle}
        onSettingsOpen={header.onSettingsOpen}
        onEntitiesOpen={header.onEntitiesOpen}
        onSearchToggle={header.onSearchToggle}
      />

      <ReaderFooter
        isVisible={isHeaderVisible}
        progress={footer.progress}
        currentPage={footer.currentPage}
        totalPages={footer.totalPages}
        chapterPage={footer.chapterPage}
        chapterTotalPages={footer.chapterTotalPages}
      />

      {/* Признак готовности читалки для e2e: этот узел монтируется ровно
          вместе с `isVisible`, то есть когда rendition отрисован, метаданные
          загружены и восстановление позиции завершено. Снаружи другого
          признака нет — шапка и подвал спрятаны до раскрытия панелей. */}
      <div className="fixed top-16 right-4 z-[100]" data-testid="reader-ready">
        <ReaderControls
          theme={settings.theme}
          fontSize={settings.fontSize}
          onThemeChange={settings.onThemeChange}
          onFontSizeIncrease={settings.onFontSizeIncrease}
          onFontSizeDecrease={settings.onFontSizeDecrease}
          isOpen={settings.isOpen}
          onOpenChange={settings.onOpenChange}
          wakeLockEnabled={settings.wakeLockEnabled}
          wakeLockSupported={settings.wakeLockSupported}
          wakeLockActive={settings.wakeLockActive}
          onWakeLockChange={settings.onWakeLockChange}
          navigationMode={settings.navigationMode}
          onNavigationModeChange={settings.onNavigationModeChange}
          nameHighlightingEnabled={settings.nameHighlightingEnabled}
          onNameHighlightingChange={settings.onNameHighlightingChange}
          descriptionHighlightingEnabled={settings.descriptionHighlightingEnabled}
          onDescriptionHighlightingChange={settings.onDescriptionHighlightingChange}
          highlightMode={settings.descriptionHighlightMode}
          onHighlightModeChange={settings.onDescriptionHighlightModeChange}
          pageAnimationEnabled={settings.pageAnimationEnabled}
          onPageAnimationChange={settings.onPageAnimationChange}
        />
      </div>

      <ImageGenerationStatus
        status={imageStatus.status}
        error={imageStatus.error}
        onCancel={imageStatus.onCancel}
        descriptionPreview={imageStatus.descriptionPreview}
      />

      <ProgressSaveIndicator
        lastSaved={saveStatus.lastSaved ? saveStatus.lastSaved.getTime() : null}
        isSaving={saveStatus.isSaving}
      />
    </>
  );
};
