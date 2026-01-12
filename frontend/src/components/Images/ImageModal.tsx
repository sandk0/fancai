import React, { useState, useRef, useEffect } from 'react';
import { X, Download, Share2, ZoomIn, ZoomOut, RefreshCw, Wand2 } from 'lucide-react';
import { m } from 'framer-motion';
import { imagesAPI } from '@/api/images';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import { fetchImageWithAuth, downloadWithAuth } from '@/utils/fetchWithTokenRefresh';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Z_INDEX } from '@/lib/zIndex';
import type { Description } from '@/types/api';

// Note: fetchImageAsBlob functionality moved to fetchImageWithAuth in @/utils/fetchWithTokenRefresh
// This provides automatic token refresh on 401 errors during long sessions

interface ImageModalProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  imageId?: string;
  descriptionData?: Description;
  onImageRegenerated?: (newImageUrl: string) => void;
}

export const ImageModal: React.FC<ImageModalProps> = ({
  imageUrl,
  isOpen,
  onClose,
  title,
  description,
  imageId,
  onImageRegenerated
}) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showRegenerateOptions, setShowRegenerateOptions] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [currentImageUrl, setCurrentImageUrl] = useState(imageUrl);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const { notify } = useUIStore();
  const { t } = useTranslation();

  // Focus trap for accessibility
  useFocusTrap(isOpen, modalRef);

  /**
   * Fetch image with auth headers when URL changes
   * This ensures images that require authentication can be displayed
   */
  useEffect(() => {
    if (!imageUrl || !isOpen) return;

    // If URL is already a blob or data URL, use directly
    if (imageUrl.startsWith('blob:') || imageUrl.startsWith('data:')) {
      setCurrentImageUrl(imageUrl);
      return;
    }

    // Fetch image with auth headers (supports automatic token refresh)
    setIsLoadingImage(true);
    let cancelled = false;

    fetchImageWithAuth(imageUrl).then((blobUrl) => {
      if (cancelled) {
        // Cleanup blob URL if we were cancelled
        if (blobUrl && blobUrl !== imageUrl) {
          URL.revokeObjectURL(blobUrl);
        }
        return;
      }

      if (blobUrl) {
        // Revoke previous blob URL
        if (blobUrlRef.current && blobUrlRef.current !== imageUrl) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        blobUrlRef.current = blobUrl;
        setCurrentImageUrl(blobUrl);
      } else {
        // Fallback to original URL (might fail due to CORS/auth)
        setCurrentImageUrl(imageUrl);
      }
      setIsLoadingImage(false);
    });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, isOpen]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current && !blobUrlRef.current.startsWith('data:')) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  const handleDownload = async () => {
    try {
      const filename = `bookreader-image-${Date.now()}.jpg`;
      await downloadWithAuth(imageUrl, filename);
    } catch (error) {
      console.error('[ImageModal] Download failed:', error);
      notify.error(t('images.downloadFailed'), t('images.downloadFailedDesc'));
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || t('images.shareTitle'),
          text: description || t('images.shareText'),
          url: imageUrl,
        });
      } catch (error) {
        console.error('Share failed:', error);
      }
    } else {
      // Fallback to copy to clipboard
      navigator.clipboard.writeText(imageUrl);
    }
  };

  const handleRegenerate = async () => {
    if (!imageId) {
      notify.error(t('images.regenerationError'), t('images.missingImageId'));
      return;
    }

    setIsRegenerating(true);
    try {
      const result = await imagesAPI.regenerateImage(imageId, {
        style_prompt: customPrompt || undefined,
      });

      setCurrentImageUrl(result.image_url);
      setShowRegenerateOptions(false);
      setCustomPrompt('');

      if (onImageRegenerated) {
        onImageRegenerated(result.image_url);
      }

      notify.success(t('images.imageRegenerated'), t('images.newImageGenerated').replace('{time}', result.generation_time.toFixed(1)));
    } catch (error) {
      console.error('Regeneration failed:', error);
      notify.error(t('images.regenerationFailed'), t('images.regenerationFailedDesc'));
    } finally {
      setIsRegenerating(false);
    }
  };

  // Update current image URL when prop changes
  React.useEffect(() => {
    setCurrentImageUrl(imageUrl);
  }, [imageUrl]);

  // Close on escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showRegenerateOptions) {
          setShowRegenerateOptions(false);
        } else {
          onClose();
        }
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, showRegenerateOptions]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm pt-safe pb-safe pointer-events-auto"
        style={{ zIndex: Z_INDEX.modalOverlay }}
        onClick={onClose}
      />
      {/* Modal Container */}
      <div
        className="fixed inset-0 flex items-center justify-center pt-safe pb-safe pointer-events-none"
        style={{ zIndex: Z_INDEX.modal }}
      >
        <m.div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="image-modal-title"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative max-w-4xl max-h-[90vh] mx-4 pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/50 to-transparent p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="text-white flex-1 min-w-0 max-w-[60%] sm:max-w-[70%]">
              {title && (
                <h3 id="image-modal-title" className="font-semibold truncate">
                  {title}
                </h3>
              )}
              {!title && (
                <h3 id="image-modal-title" className="sr-only">
                  {t('images.generatedImageAlt')}
                </h3>
              )}
              {description && (
                <p className="text-sm text-white/70 mt-1 line-clamp-2 sm:line-clamp-3">{description}</p>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setIsZoomed(!isZoomed)}
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
                  onClick={() => setShowRegenerateOptions(!showRegenerateOptions)}
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
                onClick={handleShare}
                className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-white hover:bg-white/20 rounded-lg transition-colors"
                aria-label={t('images.share')}
              >
                <Share2 className="h-5 w-5" aria-hidden="true" />
              </button>

              <button
                onClick={handleDownload}
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
          </div>
        </div>

        {/* Regenerate Options */}
        {showRegenerateOptions && (
          <div className="absolute top-14 sm:top-16 left-2 right-2 sm:left-4 sm:right-4 z-20 bg-black/95 backdrop-blur-sm rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold flex items-center space-x-2">
                <Wand2 className="h-5 w-5" />
                <span>{t('images.regenerateImage')}</span>
              </h3>
              <button
                onClick={() => setShowRegenerateOptions(false)}
                className="p-1 text-white/60 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
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
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder={t('images.stylePlaceholder')}
                  className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg text-white placeholder-white/40 focus:border-blue-500 focus:outline-none"
                  disabled={isRegenerating}
                />
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={handleRegenerate}
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
                  onClick={() => setShowRegenerateOptions(false)}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
                  disabled={isRegenerating}
                >
                  {t('images.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Image */}
        <div className="relative overflow-hidden rounded-lg bg-black min-h-[200px]">
          {/* Loading overlay while fetching image */}
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

          {/* Only show img when we have a URL and not loading */}
          {currentImageUrl && !isLoadingImage && (
            <img
              src={currentImageUrl}
              alt={title || t('images.generatedImageAlt')}
              className={`max-w-full max-h-[90vh] object-contain transition-transform duration-300 touch-manipulation ${
                isZoomed ? 'scale-150 cursor-zoom-out' : 'cursor-zoom-in'
              } ${isRegenerating ? 'opacity-50' : ''}`}
              onClick={() => !isRegenerating && setIsZoomed(!isZoomed)}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                // Use a gray placeholder SVG as fallback
                target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"%3E%3Crect fill="%23374151" width="400" height="300"/%3E%3Ctext fill="%239CA3AF" font-family="system-ui" font-size="16" text-anchor="middle" x="200" y="150"%3EImage not available%3C/text%3E%3C/svg%3E';
              }}
            />
          )}
        </div>

        {/* Loading state (initial, no URL yet) */}
        {!currentImageUrl && !isRegenerating && !isLoadingImage && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
              <p className="text-white">{t('images.loadingImage')}</p>
            </div>
          </div>
        )}
      </m.div>
      </div>
    </>
  );
};