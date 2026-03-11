import React, { useState, useEffect } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { useIsMobile } from '@/hooks/shared/useIsMobile';

interface MobilePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  snapPoints?: (number | string)[];
  defaultSnap?: number | string;
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
          setActiveSnap(null);
          onClose();
        }
      }}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnap}
      setActiveSnapPoint={setActiveSnap}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Drawer.Content className="bg-background flex flex-col rounded-t-2xl fixed bottom-0 left-0 right-0 z-50 outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
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

          {/* Scrollable content with safe area padding */}
          <div className="overflow-y-auto flex-1 pb-safe">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
