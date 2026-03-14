import React, { useState, useEffect, useCallback } from 'react';
import { Drawer } from 'vaul';
import { User, MapPin, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EntityDetail } from '@/types/entity';

interface EntityBottomSheetProps {
  entity: EntityDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenDrawer: (entityId: string) => void;
}

const SNAP_POINTS: [number, number] = [0.3, 0.6];

function getEntityIcon(type: string) {
  switch (type) {
    case 'character':
      return <User className="w-full h-full text-[var(--color-text-muted)]" />;
    case 'location':
      return <MapPin className="w-full h-full text-[var(--color-text-muted)]" />;
    default:
      return <Package className="w-full h-full text-[var(--color-text-muted)]" />;
  }
}

export const EntityBottomSheet: React.FC<EntityBottomSheetProps> = ({
  entity,
  isOpen,
  onClose,
  onOpenDrawer,
}) => {
  const { t } = useTranslation();

  const [activeSnap, setActiveSnap] = useState<number | string | null>(SNAP_POINTS[0]);

  useEffect(() => {
    if (isOpen) {
      setActiveSnap(SNAP_POINTS[0]);
    }
  }, [isOpen]);

  const handleOpenDrawer = useCallback(() => {
    if (entity) {
      onOpenDrawer(entity.id);
      onClose();
    }
  }, [entity, onOpenDrawer, onClose]);

  if (!entity) return null;

  const description =
    entity.biography || entity.visual_summary_clean || entity.visual_summary || '';
  const truncatedDescription =
    description.length > 100 ? description.slice(0, 100) + '...' : description;

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
        <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-base)] rounded-t-xl z-50 h-[95dvh] outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--color-accent-500)]">
          {/* Handle bar */}
          <div className="mx-auto w-10 h-1 rounded-full bg-[var(--color-bg-hover)] my-3 flex-shrink-0" />

          <Drawer.Title className="sr-only">{entity.name}</Drawer.Title>

          {/* Entity info */}
          <div className="flex gap-3 px-5 pb-4">
            <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-[var(--color-bg-muted)] flex items-center justify-center">
              {entity.avatar_url ? (
                <img
                  src={entity.avatar_url}
                  alt={entity.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-5 h-5">{getEntityIcon(entity.type)}</div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{entity.name}</div>
              <div className="text-[10px] text-[var(--color-text-muted)] capitalize">
                {t(`entities.type_${entity.type}`, entity.type)}
              </div>
              {truncatedDescription && (
                <p className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-3 leading-tight italic">
                  {truncatedDescription}
                </p>
              )}
            </div>
          </div>

          {/* Details button */}
          <div className="border-t border-[var(--color-border-default)] px-5 py-3">
            <button
              onClick={handleOpenDrawer}
              className="text-sm text-[var(--color-accent-500)] hover:text-[var(--color-accent-600)] font-medium transition-colors min-h-[44px] flex items-center"
            >
              {t('reader.entity_popup.details')}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
