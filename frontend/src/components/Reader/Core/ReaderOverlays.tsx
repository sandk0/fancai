import React from 'react';
import { useTranslation } from 'react-i18next';
import { SwipeOverlay } from '../SwipeOverlay';
import { IOSTapZones } from '../IOSTapZones';
import { isIOS } from '@/utils/iosSupport';
import type { ThemeName } from '@/hooks/epub/useEpubThemes';
import type { SwipeState } from '@/hooks/epub/useSwipeNavigation';

interface ReaderOverlaysProps {
  loading: {
    isLoading: boolean;
    isGenerating: boolean;
    isRestoringPosition: boolean;
    isCheckingHealth: boolean;
    isRenditionHealthy: boolean;
    renditionReady: boolean;
  };
  error: {
    message: string | null;
    readableMessage: string;
    onRetry: () => void;
    onHome: () => void;
  };
  theme: ThemeName;
  backgroundColor: string;
  navigationMode: 'swipe' | 'tap';
  swipe: {
    state: SwipeState;
    viewportWidth: number;
    headerHeight: number;
  };
  tapZones: {
    onPrevPage: () => void;
    onNextPage: () => void;
    onDescriptionClick: (id: string) => void;
    onCenterTap: (x: number, y: number) => void;
  };
}

export const ReaderOverlays: React.FC<ReaderOverlaysProps> = ({
  loading,
  error,
  backgroundColor,
  navigationMode,
  swipe,
  tapZones,
}) => {
  const { t } = useTranslation();
  const { isLoading, isGenerating, isRestoringPosition, isCheckingHealth, isRenditionHealthy, renditionReady } = loading;
  const isMobileDevice = typeof window !== 'undefined' && window.innerWidth <= 768;
  const effectiveNavigationMode = isIOS() ? 'swipe' : navigationMode;

  if (error.message) {
    return (
      <div className={`absolute inset-0 flex items-center justify-center ${backgroundColor} z-10`}>
        <div className="text-center max-w-md mx-4">
          <h3 className="text-xl font-semibold mb-3">{t('reader.error.title')}</h3>
          <p className="mb-6 opacity-80">{error.readableMessage}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={error.onRetry} className="px-6 py-2 bg-blue-600 text-white rounded-lg">{t('reader.error.retry')}</button>
            <button onClick={error.onHome} className="px-6 py-2 bg-gray-200 dark:bg-gray-800 rounded-lg">{t('reader.error.back_to_library')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {effectiveNavigationMode === 'swipe' && isMobileDevice && (
        <SwipeOverlay swipeState={swipe.state} viewportWidth={swipe.viewportWidth} headerHeight={swipe.headerHeight} />
      )}
      {isIOS() && (
        <IOSTapZones
          onPrevPage={tapZones.onPrevPage} onNextPage={tapZones.onNextPage}
          onDescriptionClick={tapZones.onDescriptionClick} onCenterTap={tapZones.onCenterTap}
          enabled={!isLoading && !isGenerating && !error.message} headerHeight={70}
          navigationEnabled={effectiveNavigationMode === 'tap'}
        />
      )}
      {(isLoading || isGenerating || isRestoringPosition || isCheckingHealth || (!isRenditionHealthy && renditionReady)) && (
        <div className={`absolute inset-0 flex items-center justify-center ${backgroundColor} z-10`}>
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4" />
            <p>{isCheckingHealth ? t('reader.restoring_session') : isRestoringPosition ? t('reader.restoring_position') : isGenerating ? t('reader.preparing') : t('reader.loading')}</p>
          </div>
        </div>
      )}
    </>
  );
};
