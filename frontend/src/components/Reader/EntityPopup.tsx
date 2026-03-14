import React, { useEffect, useRef, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, m } from 'motion/react';
import { User, MapPin, Package } from 'lucide-react';
import type { EntityDetail } from '@/types/entity';

interface EntityPopupProps {
  entity: EntityDetail | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onOpenDrawer: (entityId: string) => void;
}

const POPUP_WIDTH = 240;
const POPUP_HEIGHT = 140;
const VIEWPORT_PADDING = 12;

function getPopupStyle(position: { x: number; y: number }): React.CSSProperties {
  const { x, y } = position;

  let left = x - POPUP_WIDTH / 2;
  left = Math.max(
    VIEWPORT_PADDING,
    Math.min(left, window.innerWidth - POPUP_WIDTH - VIEWPORT_PADDING)
  );

  const spaceBelow = window.innerHeight - y;
  const positionAbove = spaceBelow < POPUP_HEIGHT + 20;
  const top = positionAbove ? y - POPUP_HEIGHT - 8 : y + 8;

  return {
    position: 'fixed',
    left: `${left}px`,
    top: `${Math.max(VIEWPORT_PADDING, top)}px`,
    width: `${POPUP_WIDTH}px`,
    zIndex: 500,
  };
}

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

export const EntityPopup = memo(function EntityPopup({
  entity,
  position,
  onClose,
  onOpenDrawer,
}: EntityPopupProps) {
  const { t } = useTranslation();
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!entity) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [entity, onClose]);

  useEffect(() => {
    if (!entity) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [entity, onClose]);

  const handleOpenDrawer = useCallback(() => {
    if (entity) {
      onOpenDrawer(entity.id);
      onClose();
    }
  }, [entity, onOpenDrawer, onClose]);

  const description =
    entity?.biography || entity?.visual_summary_clean || entity?.visual_summary || '';
  const truncatedDescription =
    description.length > 100 ? description.slice(0, 100) + '...' : description;

  return (
    <AnimatePresence>
      {entity && position && (
        <m.div
          ref={popupRef}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.15 }}
          style={getPopupStyle(position)}
          className="bg-[var(--color-bg-elevated)] text-[var(--color-text-default)] border border-[var(--color-border-default)] rounded-xl shadow-lg backdrop-blur-sm overflow-hidden"
        >
          <div className="flex gap-3 p-3">
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
                {t(`entities.types.${entity.type}`, entity.type)}
              </div>
              {truncatedDescription && (
                <p className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2 leading-tight italic">
                  {truncatedDescription}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-[var(--color-border-default)] px-3 py-1.5">
            <button
              onClick={handleOpenDrawer}
              className="text-xs text-[var(--color-accent-500)] hover:text-[var(--color-accent-600)] font-medium transition-colors"
            >
              {t('reader.entity_popup.details')}
            </button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
});
