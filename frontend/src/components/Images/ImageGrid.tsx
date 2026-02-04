/**
 * ImageGrid - Grid layout of images for the gallery page
 *
 * Note: This is distinct from the existing ImageGallery component which is
 * a per-book gallery with different features (view modes, download, share).
 * This component renders the page-level masonry grid with book info.
 */

import { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image as ImageIcon,
  BookOpen,
  X,
} from 'lucide-react';
import { AuthenticatedImage } from '@/components/UI/AuthenticatedImage';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { GeneratedImage } from '@/types/api';

interface ImageWithBookInfo extends GeneratedImage {
  book_title: string;
  book_id: string;
}

interface DescriptionTypeOption {
  value: string;
  label: string;
}

interface ImageGridProps {
  images: ImageWithBookInfo[];
  descriptionTypes: DescriptionTypeOption[];
  onImageClick: (image: ImageWithBookInfo) => void;
}

export function ImageGrid({ images, descriptionTypes, onImageClick }: ImageGridProps) {
  const { t } = useTranslation();

  if (images.length === 0) {
    return (
      <div className="text-center py-16 rounded-xl border-2 bg-background border-border">
        <ImageIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-xl font-bold mb-2 text-foreground">
          {t('imagesGallery.no_results')}
        </h3>
        <p className="text-muted-foreground">
          {t('imagesGallery.no_results_hint')}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {images.map((image) => (
        <div
          key={image.id}
          onClick={() => onImageClick(image)}
          className="group cursor-pointer rounded-xl overflow-hidden border-2 transition-all hover:-translate-y-1 hover:shadow-xl bg-background border-border"
        >
          {/* Image */}
          <div className="aspect-[4/3] overflow-hidden bg-muted">
            <AuthenticatedImage
              src={image.image_url}
              alt={image.description?.text || 'Generated image'}
              className="w-full h-full object-cover transition-transform group-hover:scale-110"
              fallback={
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <ImageIcon className="w-8 h-8 text-muted-foreground" />
                </div>
              }
            />
          </div>

          {/* Info */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold truncate text-foreground">
                {image.book_title}
              </p>
            </div>
            <p className="text-sm line-clamp-2 mb-2 text-muted-foreground">
              {image.description?.text || image.description?.content}
            </p>
            <span className="inline-block px-2 py-1 rounded-sm text-xs font-medium bg-muted text-foreground">
              {descriptionTypes.find((t) => t.value === image.description?.type)?.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ImageModalOverlayProps {
  image: ImageWithBookInfo;
  descriptionTypes: DescriptionTypeOption[];
  onClose: () => void;
}

export function ImageModalOverlay({ image, descriptionTypes, onClose }: ImageModalOverlayProps) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(true, modalRef);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/80"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="relative max-w-4xl w-full max-h-[90vh] flex flex-col rounded-xl overflow-hidden bg-background"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={image.book_title}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 sm:top-4 sm:right-4 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg z-10 bg-muted"
          aria-label={t('common.close')}
        >
          <X className="w-6 h-6 text-foreground" aria-hidden="true" />
        </button>

        <AuthenticatedImage
          src={image.image_url}
          alt={image.description?.text || 'Generated image'}
          className="w-full max-h-[60vh] sm:max-h-[70vh] object-contain flex-shrink-0"
          fallback={
            <div className="w-full h-[40vh] flex items-center justify-center bg-muted">
              <ImageIcon className="w-16 h-16 text-muted-foreground" />
            </div>
          }
        />

        <div className="p-4 sm:p-6 overflow-y-auto">
          <h3 className="text-lg sm:text-2xl font-bold mb-2 sm:mb-3 text-foreground">
            {image.book_title}
          </h3>
          <p className="text-sm sm:text-base mb-3 sm:mb-4 text-muted-foreground line-clamp-3 sm:line-clamp-none">
            {image.description?.text || image.description?.content}
          </p>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-lg text-sm font-medium bg-primary text-primary-foreground">
              {descriptionTypes.find((t) => t.value === image.description?.type)?.label}
            </span>
            <span className="text-sm text-muted-foreground">
              {new Date(image.created_at).toLocaleDateString('ru-RU')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
