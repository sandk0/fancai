import React from 'react';
import { X, Download, Share2, ZoomIn, ZoomOut, RefreshCw, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ImageControlsProps {
  isZoomed: boolean;
  isRegenerating: boolean;
  showRegenerateOptions: boolean;
  customPrompt: string;
  imageId?: string;
  onZoomToggle: () => void;
  onRegenerateToggle: () => void;
  onShare: () => void;
  onDownload: () => void;
  onClose: () => void;
  onRegenerate: () => void;
  onCustomPromptChange: (value: string) => void;
  onRegenerateClose: () => void;
}

export const ImageControls: React.FC<ImageControlsProps> = ({
  isZoomed,
  isRegenerating,
  showRegenerateOptions,
  customPrompt,
  imageId,
  onZoomToggle,
  onRegenerateToggle,
  onShare,
  onDownload,
  onClose,
  onRegenerate,
  onCustomPromptChange,
  onRegenerateClose,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-center space-x-2">
        <button
          onClick={onZoomToggle}
          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-white hover:bg-white/20 rounded-lg transition-colors"
          aria-label={isZoomed ? t('images.zoomOut') : t('images.zoomIn')}
        >
          {isZoomed ? (
            <ZoomOut className="h-5 w-5" aria-hidden="true" />
          ) : (
            <ZoomIn className="h-5 w-5" aria-hidden="true" />
          )}
        </button>

        {imageId && (
          <button
            onClick={onRegenerateToggle}
            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-white hover:bg-white/20 rounded-lg transition-colors"
            aria-label={t('images.regenerateImage')}
            disabled={isRegenerating}
          >
            {isRegenerating ? (
              <div
                className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"
                role="status"
                aria-label={t('images.regenerating')}
              />
            ) : (
              <RefreshCw className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        )}

        <button
          onClick={onShare}
          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-white hover:bg-white/20 rounded-lg transition-colors"
          aria-label={t('images.share')}
        >
          <Share2 className="h-5 w-5" aria-hidden="true" />
        </button>

        <button
          onClick={onDownload}
          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-white hover:bg-white/20 rounded-lg transition-colors"
          aria-label={t('images.download')}
        >
          <Download className="h-5 w-5" aria-hidden="true" />
        </button>

        <button
          onClick={onClose}
          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-white hover:bg-white/20 rounded-lg transition-colors"
          aria-label={t('images.close')}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {showRegenerateOptions && (
        <div className="absolute top-14 sm:top-16 left-2 right-2 sm:left-4 sm:right-4 z-20 bg-black/95 backdrop-blur-sm rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold flex items-center space-x-2">
              <Wand2 className="h-5 w-5" />
              <span>{t('images.regenerateImage')}</span>
            </h3>
            <button
              onClick={onRegenerateClose}
              className="p-1 text-white/60 hover:text-white transition-colors"
              aria-label={t('images.cancel')}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm text-white/70 mb-1">
                {t('images.customStyle')}
              </label>
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => onCustomPromptChange(e.target.value)}
                placeholder={t('images.stylePlaceholder')}
                className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg text-white placeholder-white/40 focus:border-blue-500 focus:outline-none"
                disabled={isRegenerating}
              />
            </div>

            <div className="flex space-x-2">
              <button
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
              >
                {isRegenerating ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    <span>{t('images.generating')}</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    <span>{t('images.regenerate')}</span>
                  </>
                )}
              </button>
              <button
                onClick={onRegenerateClose}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
                disabled={isRegenerating}
              >
                {t('images.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
