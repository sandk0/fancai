import React, { useState, useRef, useEffect } from 'react';
import { m } from 'motion/react';
import { notify } from '@/stores/ui';
import { useTranslation } from 'react-i18next';
import { fetchImageWithAuth, downloadWithAuth } from '@/utils/fetchWithTokenRefresh';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useRegenerateImage } from '@/hooks/api/useImages/useImageMutations';
import { Z_INDEX } from '@/lib/zIndex';
import type { Description } from '@/types/api';
import { logger } from '@/lib/logger';
import { ImageViewer } from './ImageViewer';
import { ImageControls } from './ImageControls';
import { ImageMetadata } from './ImageMetadata';

interface ImageModalProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  imageId?: string;
  bookId?: string;
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
  bookId,
  descriptionData,
  onImageRegenerated,
}) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showRegenerateOptions, setShowRegenerateOptions] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  // Результат авторизованной загрузки: пара «исходный URL → blob-URL».
  // Отображаемый URL и флаг загрузки выводятся при рендере, а не эффектом.
  const [resolved, setResolved] = useState<{ source: string; url: string } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const { t } = useTranslation();
  const regenerateMutation = useRegenerateImage();

  useFocusTrap(isOpen, modalRef);

  const isInlineUrl =
    !!imageUrl && (imageUrl.startsWith('blob:') || imageUrl.startsWith('data:'));
  const isResolved = resolved?.source === imageUrl;
  const currentImageUrl = isResolved ? resolved.url : imageUrl;
  const isLoadingImage = !!imageUrl && isOpen && !isInlineUrl && !isResolved;

  useEffect(() => {
    if (!imageUrl || !isOpen || isInlineUrl || isResolved) return;

    let cancelled = false;

    fetchImageWithAuth(imageUrl).then((blobUrl) => {
      if (cancelled) {
        if (blobUrl && blobUrl !== imageUrl) {
          URL.revokeObjectURL(blobUrl);
        }
        return;
      }

      if (blobUrl) {
        if (blobUrlRef.current && blobUrlRef.current !== imageUrl) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        blobUrlRef.current = blobUrl;
      }
      setResolved({ source: imageUrl, url: blobUrl || imageUrl });
    });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, isOpen, isInlineUrl, isResolved]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current && !blobUrlRef.current.startsWith('data:')) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  const handleDownload = async () => {
    try {
      const filename = `fancai-image-${Date.now()}.jpg`;
      await downloadWithAuth(imageUrl, filename);
    } catch (error) {
      logger.error('[ImageModal] Download failed:', error);
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
        logger.error('Share failed:', error);
      }
    } else {
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
      const result = await regenerateMutation.mutateAsync({
        imageId,
        bookId: bookId || '',
        params: { style_prompt: customPrompt || undefined },
      });

      // Оптимистичный показ нового URL до того, как родитель обновит проп
      setResolved({ source: imageUrl, url: result.image_url });
      setShowRegenerateOptions(false);
      setCustomPrompt('');

      if (onImageRegenerated) {
        onImageRegenerated(result.image_url);
      }

      notify.success(
        t('images.imageRegenerated'),
        t('images.newImageGenerated').replace('{time}', result.generation_time.toFixed(1))
      );
    } catch (error) {
      logger.error('Regeneration failed:', error);
      notify.error(t('images.regenerationFailed'), t('images.regenerationFailedDesc'));
    } finally {
      setIsRegenerating(false);
    }
  };

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
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm pt-safe pb-safe pointer-events-auto"
        style={{ zIndex: Z_INDEX.modalOverlay }}
        onClick={onClose}
      />
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
          <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/50 to-transparent p-4">
            <div className="flex items-start justify-between gap-2">
              <ImageMetadata
                title={title}
                description={description}
                descriptionData={descriptionData}
              />
              <ImageControls
                isZoomed={isZoomed}
                isRegenerating={isRegenerating}
                showRegenerateOptions={showRegenerateOptions}
                customPrompt={customPrompt}
                imageId={imageId}
                onZoomToggle={() => setIsZoomed(!isZoomed)}
                onRegenerateToggle={() => setShowRegenerateOptions(!showRegenerateOptions)}
                onShare={handleShare}
                onDownload={handleDownload}
                onClose={onClose}
                onRegenerate={handleRegenerate}
                onCustomPromptChange={setCustomPrompt}
                onRegenerateClose={() => setShowRegenerateOptions(false)}
              />
            </div>
          </div>

          <ImageViewer
            currentImageUrl={currentImageUrl}
            isLoadingImage={isLoadingImage}
            isRegenerating={isRegenerating}
            isZoomed={isZoomed}
            title={title}
            imageId={imageId}
            onZoomToggle={() => setIsZoomed(!isZoomed)}
            onShowRegenerate={() => setShowRegenerateOptions(true)}
          />
        </m.div>
      </div>
    </>
  );
};
