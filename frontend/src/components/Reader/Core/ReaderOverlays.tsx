import React from 'react';
import { useTranslation } from 'react-i18next';
import { IOSTapZones } from '../IOSTapZones';
import { isIOS } from '@/utils/iosSupport';
import ErrorMessage from '@/components/UI/ErrorMessage';
import type { ThemeName } from '@/hooks/epub/useEpubThemes';
import type { NavigationLock } from '@/hooks/shared/useNavigationLock';

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
    isRetryable?: boolean;
    onRetry: () => void;
    onHome: () => void;
  };
  theme: ThemeName;
  backgroundColor: string;
  navigationMode: 'swipe' | 'tap';
  tapZones: {
    onPrevPage: () => void;
    onNextPage: () => void;
    onDescriptionClick: (id: string) => void;
    onCenterTap: (x: number, y: number) => void;
    navLock: NavigationLock;
  };
}

export const ReaderOverlays: React.FC<ReaderOverlaysProps> = ({
  loading,
  error,
  backgroundColor,
  navigationMode,
  tapZones,
}) => {
  const { t } = useTranslation();
  const {
    isLoading,
    isGenerating,
    isRestoringPosition,
    isCheckingHealth,
    isRenditionHealthy,
    renditionReady,
  } = loading;
  const effectiveNavigationMode = isIOS() ? 'swipe' : navigationMode;

  if (error.message) {
    return (
      <div className={`absolute inset-0 flex items-center justify-center ${backgroundColor} z-10`}>
        <ErrorMessage
          message={error.readableMessage}
          onRetry={error.isRetryable !== false ? error.onRetry : undefined}
          action={{ label: t('reader.error.back_to_library'), onClick: error.onHome }}
        />
      </div>
    );
  }

  return (
    <>
      {isIOS() && (
        <IOSTapZones
          onPrevPage={tapZones.onPrevPage}
          onNextPage={tapZones.onNextPage}
          onDescriptionClick={tapZones.onDescriptionClick}
          onCenterTap={tapZones.onCenterTap}
          enabled={!isLoading && !isGenerating && !error.message}
          headerHeight={70}
          navigationEnabled={effectiveNavigationMode === 'tap'}
          navLock={tapZones.navLock}
        />
      )}
      {(isLoading ||
        isGenerating ||
        isRestoringPosition ||
        isCheckingHealth ||
        (!isRenditionHealthy && renditionReady)) && (
        <div
          className={`absolute inset-0 flex items-center justify-center ${backgroundColor} z-10`}
        >
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4" />
            <p>
              {isCheckingHealth
                ? t('reader.restoring_session')
                : isRestoringPosition
                  ? t('reader.restoring_position')
                  : isGenerating
                    ? t('reader.preparing')
                    : t('reader.loading')}
            </p>
          </div>
        </div>
      )}
    </>
  );
};
