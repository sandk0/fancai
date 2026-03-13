/**
 * HighlightTooltip - Compact tooltip shown on tap of an existing highlight
 *
 * Features:
 * - Shows note text (line-clamp-3) if present
 * - Color indicator dot
 * - Edit and Delete buttons with 44px touch targets
 * - Click outside to close
 * - Smart positioning above/below tap point
 *
 * @component
 */

import { useEffect, useRef, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import type { HighlightPopup } from '@/hooks/epub/useAnnotationRendering';

interface HighlightTooltipProps {
  popup: HighlightPopup | null;
  onEdit: (bookmarkId: string) => void;
  onDelete: (bookmarkId: string) => void;
  onClose: () => void;
}

export const HighlightTooltip = memo(function HighlightTooltip({
  popup,
  onEdit,
  onDelete,
  onClose,
}: HighlightTooltipProps) {
  const { t } = useTranslation();
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!popup) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Delay listener registration to avoid closing on the same tap that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDown);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [popup, onClose]);

  const getTooltipStyle = useCallback((): React.CSSProperties => {
    if (!popup) return { display: 'none' };

    const tooltipWidth = 280;
    const tooltipEstimatedHeight = popup.note ? 120 : 60;
    const offset = 10;

    // Position above or below tap point
    const positionAbove = popup.position.y > window.innerHeight * 0.5;

    const left = Math.max(
      10,
      Math.min(popup.position.x - tooltipWidth / 2, window.innerWidth - tooltipWidth - 10)
    );

    const top = positionAbove
      ? popup.position.y - tooltipEstimatedHeight - offset
      : popup.position.y + offset;

    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      zIndex: 600,
    };
  }, [popup]);

  if (!popup) return null;

  return (
    <>
      {/* Backdrop: painted (0.01 opacity) so mobile browsers register touch hits.
          Catches taps in the parent DOM; iframe taps handled by rendition.on('click'). */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 599, background: 'rgba(0,0,0,0.01)' }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        aria-hidden="true"
      />
      <div
        ref={tooltipRef}
        style={getTooltipStyle()}
        className="bg-popover text-popover-foreground border border-border rounded-lg shadow-lg max-w-[280px] p-3"
        role="tooltip"
        aria-label={t('reader.highlight_tooltip.aria_label', 'Highlight actions')}
      >
        {/* Note text (if present) */}
        {popup.note && popup.note.trim() !== '' && (
          <p className="text-sm text-muted-foreground line-clamp-3 mb-2">{popup.note}</p>
        )}

        {/* Actions row */}
        <div className="flex items-center justify-between">
          {/* Color indicator */}
          {popup.color && (
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: popup.color }}
              aria-hidden="true"
            />
          )}

          <div className="flex items-center gap-1 ml-auto">
            {/* Edit */}
            <button
              onClick={() => onEdit(popup.bookmarkId)}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md hover:bg-muted active:bg-muted/80 transition-colors"
              aria-label="Edit"
            >
              <Pencil className="w-[18px] h-[18px]" aria-hidden="true" />
            </button>

            {/* Delete */}
            <button
              onClick={() => onDelete(popup.bookmarkId)}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md hover:bg-destructive/10 active:bg-destructive/20 text-destructive transition-colors"
              aria-label="Delete"
            >
              <Trash2 className="w-[18px] h-[18px]" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
});
