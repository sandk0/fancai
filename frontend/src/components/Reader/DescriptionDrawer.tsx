import React from 'react';
import { Drawer } from 'vaul';
import type { Description, GeneratedImage } from '@/types/api';

interface DescriptionDrawerProps {
  description: Description | null;
  image?: GeneratedImage;
  isOpen: boolean;
  onClose: () => void;
  onOpenImage: (description: Description, image?: GeneratedImage) => void;
}

/**
 * DescriptionDrawer - Bottom sheet showing full description content.
 * Uses vaul Drawer for mobile-friendly swipeable bottom sheet.
 */
export const DescriptionDrawer: React.FC<DescriptionDrawerProps> = ({
  description,
  image,
  isOpen,
  onClose,
  onOpenImage,
}) => {
  if (!description) return null;

  const typeLabels: Record<string, string> = {
    location: 'Location',
    character: 'Character',
    atmosphere: 'Atmosphere',
    object: 'Object',
    action: 'Action',
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-elevated)] rounded-t-xl max-h-[60vh] z-50 outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
          {/* Handle bar */}
          <div className="mx-auto w-10 h-1 rounded-full bg-muted-foreground/30 my-3 flex-shrink-0" />

          {/* Scrollable content */}
          <div className="overflow-y-auto px-5 pb-6 pb-safe">
            {/* Type badge */}
            <Drawer.Title className="sr-only">
              {typeLabels[description.type] || description.type}
            </Drawer.Title>
            <span className="inline-block text-xs text-[var(--color-text-muted)] px-2 py-1 bg-[var(--color-bg-subtle)] rounded mb-3">
              {typeLabels[description.type] || description.type}
            </span>

            {/* Full description text */}
            <p className="text-sm text-[var(--color-text-default)] leading-relaxed whitespace-pre-line">
              {description.content}
            </p>

            {/* Image button */}
            {image && image.status === 'completed' && (
              <button
                onClick={() => onOpenImage(description, image)}
                className="mt-4 w-full py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
              >
                Open image
              </button>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
