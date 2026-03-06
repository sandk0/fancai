import React from 'react';
import type { ReaderTheme } from '@/stores/reader';
import type { GenerationStatus } from '@/hooks/epub/useImageModal';
import { ReaderHeader } from '../ReaderHeader';
import { ReaderControls } from '../ReaderControls';
import { ImageGenerationStatus } from '../ImageGenerationStatus';
import { ProgressSaveIndicator } from '../ProgressSaveIndicator';

interface ReaderUIHeaderMetadata {
  title: string;
  author: string;
}

interface ReaderUIProps {
  isVisible: boolean;
  header: {
    metadata: ReaderUIHeaderMetadata;
    progress: number;
    currentPage?: number;
    totalPages?: number;
    onBack: () => void;
    onTocToggle: () => void;
    onInfoOpen: () => void;
    onSettingsOpen: () => void;
    onEntitiesOpen: () => void;
    onSearchToggle: () => void;
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
  header,
  settings,
  imageStatus,
  saveStatus,
}) => {
  if (!isVisible) return null;

  return (
    <>
      <ReaderHeader
        title={header.metadata.title}
        author={header.metadata.author}
        progress={header.progress}
        currentPage={header.currentPage}
        totalPages={header.totalPages}
        onBack={header.onBack}
        onTocToggle={header.onTocToggle}
        onInfoOpen={header.onInfoOpen}
        onSettingsOpen={header.onSettingsOpen}
        onEntitiesOpen={header.onEntitiesOpen}
        onSearchToggle={header.onSearchToggle}
      />

      <div className="fixed top-16 right-4 z-[100]">
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
