import React, { useState, useEffect } from 'react';
import { Drawer } from 'vaul';
import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImageForDescription } from '@/hooks/api/useImages/useImageQueries';
import { useGenerateImage, useRegenerateImage } from '@/hooks/api/useImages/useImageMutations';
import { notify } from '@/stores/ui';
import type { Description, GeneratedImage } from '@/types/api';

interface DescriptionDrawerProps {
  description: Description | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenImage: (description: Description, image?: GeneratedImage) => void;
  bookId: string;
}

const SNAP_POINTS: [number, number] = [0.4, 0.8];

/**
 * DescriptionDrawer - Bottom sheet showing full description content
 * with image generation controls.
 *
 * Uses vaul Drawer with snap points [0.4, 0.8] for mobile-friendly
 * swipeable bottom sheet. Includes generate/view image button,
 * regeneration button with overlay spinner, and image preview.
 *
 * SSoT for images: useImageForDescription TQ query (IndexedDB L1 -> API L2).
 * Mutation state is reset on description change to prevent stale data (Bug 2 fix).
 */
export const DescriptionDrawer: React.FC<DescriptionDrawerProps> = ({
  description,
  isOpen,
  onClose,
  onOpenImage,
  bookId,
}) => {
  const { t } = useTranslation();
  const generateMutation = useGenerateImage();
  const regenerateMutation = useRegenerateImage();

  // SSoT: image from TQ cache (IndexedDB L1 -> API L2)
  const { data: image, isLoading: isImageLoading } = useImageForDescription(
    description?.id ?? '',
    bookId,
    { enabled: !!description?.id && isOpen }
  );

  // Reset mutations on description change (Bug 2 fix: prevents stale generateMutation.data)
  useEffect(() => {
    generateMutation.reset();
    regenerateMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description?.id]);

  const [activeSnap, setActiveSnap] = useState<number | string | null>(SNAP_POINTS[0]);

  // Reset snap point when opening
  useEffect(() => {
    if (isOpen) {
      setActiveSnap(SNAP_POINTS[0]);
    }
  }, [isOpen]);

  if (!description) return null;

  const handleGenerate = () => {
    generateMutation.mutate({
      descriptionId: description.id,
      bookId,
    });
  };

  const renderImageButton = () => {
    const isRegenerating = regenerateMutation.isPending;

    // Loading image from TQ cache
    if (isImageLoading) {
      return (
        <div className="mt-4 w-full py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary/50 text-sm font-medium flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      );
    }

    // Image exists — show "View" + "Regenerate" buttons
    if (image?.status === 'completed') {
      return (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => onOpenImage(description!, image)}
            className="flex-1 py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
          >
            {t('reader.description_drawer.view_image')}
          </button>
          <button
            onClick={() => {
              regenerateMutation.mutate(
                { imageId: image.id, bookId },
                {
                  onError: (error: unknown) => {
                    notify.error(
                      t('reader.description_drawer.regeneration_error', 'Ошибка регенерации'),
                      error instanceof Error ? error.message : String(error)
                    );
                  },
                }
              );
            }}
            disabled={isRegenerating}
            className="py-2.5 px-3 min-h-[44px] rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isRegenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>
        </div>
      );
    }

    // Generation in progress
    if (generateMutation.isPending) {
      return (
        <button
          disabled
          className="mt-4 w-full py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary/50 text-sm font-medium flex items-center justify-center gap-2"
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('reader.description_drawer.generating')}
        </button>
      );
    }

    // Generation error — show retry button
    if (generateMutation.isError) {
      return (
        <button
          onClick={handleGenerate}
          className="mt-4 w-full py-2.5 min-h-[44px] rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 transition-colors"
        >
          {t('reader.description_drawer.generate')}
        </button>
      );
    }

    // Default: "Generate" button
    return (
      <button
        onClick={handleGenerate}
        className="mt-4 w-full py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
      >
        {t('reader.description_drawer.generate')}
      </button>
    );
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={activeSnap}
      setActiveSnapPoint={setActiveSnap}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-base)] rounded-t-xl z-50 h-[95dvh] outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
          {/* Handle bar */}
          <div className="mx-auto w-10 h-1 rounded-full bg-muted-foreground/30 my-3 flex-shrink-0" />

          {/* Scrollable content */}
          <div className="overflow-y-auto px-5 pb-6 pb-safe">
            {/* Type badge */}
            <Drawer.Title className="sr-only">
              {t(`reader.description_drawer.type.${description.type}`)}
            </Drawer.Title>
            <span className="inline-block text-xs text-[var(--color-text-muted)] px-2 py-1 bg-[var(--color-bg-subtle)] rounded mb-3">
              {t(`reader.description_drawer.type.${description.type}`)}
            </span>

            {/* Full description text */}
            <p className="text-sm text-[var(--color-text-default)] leading-relaxed whitespace-pre-line">
              {description.content}
            </p>

            {/* Image button: always visible */}
            {renderImageButton()}

            {/* Image preview: from TQ query or just-generated (with description_id guard) */}
            {(image?.status === 'completed' ||
              (generateMutation.data &&
                generateMutation.data.description_id === description.id)) && (
              <button
                onClick={() => onOpenImage(description!, image || undefined)}
                className="mt-3 w-full rounded-lg overflow-hidden relative"
              >
                <img
                  src={image?.image_url || generateMutation.data?.image_url || ''}
                  alt={description.content.slice(0, 80)}
                  className="w-full h-auto rounded-lg"
                />
                {/* Overlay spinner during regeneration */}
                {regenerateMutation.isPending && (
                  <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-white" />
                  </div>
                )}
              </button>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
