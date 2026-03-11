import React, { useState, useEffect } from 'react';
import { Drawer } from 'vaul';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGenerateImage } from '@/hooks/api/useImages/useImageMutations';
import type { Description, GeneratedImage } from '@/types/api';

interface DescriptionDrawerProps {
  description: Description | null;
  image?: GeneratedImage;
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
 * generation spinner, and image preview.
 */
export const DescriptionDrawer: React.FC<DescriptionDrawerProps> = ({
  description,
  image,
  isOpen,
  onClose,
  onOpenImage,
  bookId,
}) => {
  const { t } = useTranslation();
  const generateMutation = useGenerateImage();

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
    // Show "View image" when there's a completed image
    if (image?.status === 'completed') {
      return (
        <button
          onClick={() => onOpenImage(description, image)}
          className="mt-4 w-full py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
        >
          {t('reader.description_drawer.view_image')}
        </button>
      );
    }

    // Show spinner when generating
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

    // Default: show "Generate" button
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
        <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-elevated)] rounded-t-xl z-50 h-[95dvh] outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
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

            {/* Image preview after successful generation */}
            {generateMutation.data && (
              <button
                onClick={() => onOpenImage(description, image)}
                className="mt-3 w-full rounded-lg overflow-hidden"
              >
                <img
                  src={generateMutation.data.image_url}
                  alt={description.content.slice(0, 80)}
                  className="w-full h-auto rounded-lg"
                />
              </button>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
