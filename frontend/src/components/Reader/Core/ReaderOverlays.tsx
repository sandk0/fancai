import React from 'react';
import { useTranslation } from 'react-i18next';
import ErrorMessage from '@/components/UI/ErrorMessage';

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
  backgroundColor: string;
}

export const ReaderOverlays: React.FC<ReaderOverlaysProps> = ({
  loading,
  error,
  backgroundColor,
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

  if (error.message) {
    return (
      <div className={`absolute inset-0 flex items-center justify-center ${backgroundColor} z-10`}>
        <ErrorMessage
          title={t('reader.error.title')}
          message={error.readableMessage}
          onRetry={error.isRetryable !== false ? error.onRetry : undefined}
          action={{ label: t('reader.error.back_to_library'), onClick: error.onHome }}
        />
      </div>
    );
  }

  return (
    <>
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
