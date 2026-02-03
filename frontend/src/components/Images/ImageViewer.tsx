import React from 'react';
import { Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from '@/components/UI/LoadingSpinner';

interface ImageViewerProps {
  currentImageUrl: string;
  isLoadingImage: boolean;
  isRegenerating: boolean;
  isZoomed: boolean;
  title?: string;
  imageId?: string;
  onZoomToggle: () => void;
  onShowRegenerate: () => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  currentImageUrl,
  isLoadingImage,
  isRegenerating,
  isZoomed,
  title,
  imageId,
  onZoomToggle,
  onShowRegenerate,
}) => {
  const { t } = useTranslation();

  return (
    <div className="relative overflow-hidden rounded-lg bg-black min-h-[200px]">
      {(isRegenerating || isLoadingImage) && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-10">
          <div className="text-center text-white">
            <LoadingSpinner size="lg" />
            <p className="mt-2">
              {isRegenerating ? t('images.regenerating') : t('images.loadingImage')}
            </p>
            {isRegenerating && (
              <p className="text-sm text-white/70 mt-1">{t('images.regeneratingTime')}</p>
            )}
          </div>
        </div>
      )}

      {currentImageUrl && !isLoadingImage && (
        <img
          src={currentImageUrl}
          alt={title || t('images.generatedImageAlt')}
          onLoad={(e) => {
            (e.target as HTMLImageElement).style.opacity = '1';
          }}
          className={`max-w-full max-h-[90vh] object-contain transition-all duration-500 touch-manipulation opacity-0 ${isZoomed ? 'scale-150 cursor-zoom-out' : 'cursor-zoom-in'
            } ${isRegenerating ? 'opacity-50' : ''}`}
          onClick={() => !isRegenerating && onZoomToggle()}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"%3E%3Crect fill="%23374151" width="400" height="300"/%3E%3Ctext fill="%239CA3AF" font-family="system-ui" font-size="16" text-anchor="middle" x="200" y="150"%3EImage not available%3C/text%3E%3C/svg%3E';
            target.style.opacity = '1';
          }}
        />
      )}

      {(!currentImageUrl && (isRegenerating || isLoadingImage)) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-20" />
      )}

      {!currentImageUrl && !isRegenerating && !isLoadingImage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 text-zinc-500 p-8 text-center">
          <Wand2 className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg font-medium mb-2">{t('images.noImageAvailable') || 'No image generated yet'}</p>
          <p className="text-sm opacity-70 mb-6">{t('images.generateFirstDesc') || 'Generate an illustration for this scene.'}</p>
          {imageId && (
            <button
              onClick={onShowRegenerate}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <Wand2 className="h-4 w-4" />
              <span>{t('images.generate') || 'Generate'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
