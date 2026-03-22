import React, { useState, useEffect } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { useIsMobile } from '@/hooks/shared/useIsMobile';
import { Z_INDEX } from '@/lib/zIndex';
import { logger } from '@/lib/logger';

interface MobilePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  snapPoints?: (number | string)[];
  defaultSnap?: number | string;
  /** When true, drawer can only be dragged by handle bar, not content. Prevents false dismiss on scroll. */
  handleOnly?: boolean;
}

/**
 * MobilePanel - Universal wrapper: vaul bottom-sheet on mobile, passthrough on desktop
 *
 * On mobile (< 768px): renders vaul Drawer with snap points, handle bar, backdrop blur.
 * On desktop: renders children directly without any wrapper.
 *
 * @component
 */
export const MobilePanel: React.FC<MobilePanelProps> = ({
  isOpen,
  onClose,
  title,
  children,
  snapPoints = [0.5, 0.95],
  defaultSnap,
  handleOnly = false,
}) => {
  const isMobile = useIsMobile();

  const [activeSnap, setActiveSnap] = useState<number | string | null>(
    defaultSnap ?? snapPoints[snapPoints.length - 1]
  );

  // Sync activeSnap when opening or when defaultSnap/snapPoints change
  useEffect(() => {
    if (isOpen) {
      setActiveSnap(defaultSnap ?? snapPoints[snapPoints.length - 1]);
    }
  }, [isOpen, defaultSnap, snapPoints]);

  if (!isMobile) {
    return <>{children}</>;
  }

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnap}
      setActiveSnapPoint={setActiveSnap}
      handleOnly={handleOnly}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" style={{ zIndex: Z_INDEX.modalOverlay }} />
        <Drawer.Content
          className="bg-background flex flex-col rounded-t-2xl fixed bottom-0 left-0 right-0 h-dvh outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          style={{ zIndex: Z_INDEX.modal, paddingBottom: 'var(--snap-point-height, 0px)' }}
          onPointerDown={(e) =>
            logger.debug('[MobilePanel] Drawer.Content pointerdown', {
              target: (e.target as HTMLElement).tagName,
            })
          }
          onTouchStart={(e) =>
            logger.debug('[MobilePanel] Drawer.Content touchstart', {
              target: (e.target as HTMLElement).tagName,
            })
          }
          onClick={(e) =>
            logger.debug('[MobilePanel] Drawer.Content click', {
              target: (e.target as HTMLElement).tagName,
            })
          }
        >
          {/* Handle bar */}
          <div className="mx-auto w-10 h-1 rounded-full bg-muted-foreground/30 my-3 flex-shrink-0" />

          {/* Header with title and close button */}
          <div className="flex items-center justify-between px-5 pb-3 border-b flex-shrink-0">
            <Drawer.Title className="text-lg font-bold">{title}</Drawer.Title>
            <button
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-muted rounded-lg"
              aria-label="Close"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Content container — flex column so children's flex-1 works */}
          <div className="flex-1 flex flex-col min-h-0 pb-safe">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
