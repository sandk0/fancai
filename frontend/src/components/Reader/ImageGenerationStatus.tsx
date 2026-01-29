/**
 * ImageGenerationStatus - Status indicator for image generation
 *
 * Shows the current state of image generation in the top-right corner
 * with smooth animations and theme support.
 *
 * @component
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GenerationStatus } from '@/hooks/epub/useImageModal';

interface ImageGenerationStatusProps {
  status: GenerationStatus;
  descriptionPreview?: string | null;
  error?: string | null;
  onCancel?: () => void;
}

export const ImageGenerationStatus: React.FC<ImageGenerationStatusProps> = ({
  status,
  descriptionPreview,
  error,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  // Handle visibility transitions
  useEffect(() => {
    if (status === 'generating') {
      setShouldRender(true);
      // Small delay for enter animation
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    } else if (status === 'completed' || status === 'error') {
      // Show completed/error state briefly
      setShouldRender(true);
      setIsVisible(true);

      // Auto-hide after 3 seconds for completed, 5 seconds for error
      const hideDelay = status === 'error' ? 5000 : 3000;
      const timer = setTimeout(() => {
        setIsVisible(false);
        // Remove from DOM after animation
        setTimeout(() => {
          setShouldRender(false);
        }, 300);
      }, hideDelay);

      return () => clearTimeout(timer);
    } else {
      // idle - hide
      setIsVisible(false);
      setTimeout(() => {
        setShouldRender(false);
      }, 300);
    }
  }, [status]);

  // Don't render if not needed
  if (!shouldRender) return null;

  const getStatusContent = () => {
    switch (status) {
      case 'generating':
        return {
          icon: (
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          ),
          text: t('reader.image_generation.generating'),
          showCancel: true,
        };
      case 'completed':
        return {
          icon: (
            <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ),
          text: t('reader.image_generation.completed'),
          showCancel: false,
        };
      case 'error':
        return {
          icon: (
            <svg className="h-4 w-4 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
          text: error || t('reader.image_generation.error'),
          showCancel: false,
        };
      default:
        return { icon: null, text: '', showCancel: false };
    }
  };

  const { icon, text, showCancel } = getStatusContent();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`
        fixed top-20 right-4 z-[800]
        bg-popover border-border border
        rounded-lg shadow-lg
        px-4 py-3
        min-w-[250px] max-w-[350px]
        transition-all duration-300 ease-out
        ${isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'}
      `}
    >
      {/* Header with icon and status */}
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm font-medium text-popover-foreground flex-1">
          {text}
        </span>
        {showCancel && onCancel && (
          <button
            onClick={onCancel}
            className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={t('reader.image_generation.cancel')}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Description preview (only when generating) */}
      {status === 'generating' && descriptionPreview && (
        <div className="mt-2 text-xs text-muted-foreground line-clamp-2">
          {descriptionPreview}...
        </div>
      )}

      {/* Progress bar animation (only when generating) */}
      {status === 'generating' && (
        <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary animate-progress-bar" />
        </div>
      )}
    </div>
  );
};

