/**
 * SelectionMenu - Enhanced popup menu for selected text
 *
 * Displays a popup menu when text is selected in the EPUB reader.
 * Features:
 * - Copy to clipboard
 * - Bookmark current position
 * - Highlight with 4 color choices (yellow, green, blue, pink)
 * - Add note with color + textarea
 * - Smart positioning (above/below selection)
 * - Uses semantic CSS tokens for automatic theme support
 * - Mobile-friendly touch targets (min 44px)
 * - Click outside to close
 * - Submenu states: main | colors | note
 *
 * @component
 */

import { useEffect, useRef, useCallback, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Bookmark, Highlighter, StickyNote, X } from 'lucide-react';
import type { Selection } from '@/hooks/epub/useTextSelection';
import { HIGHLIGHT_COLORS } from '@/hooks/epub/useHighlights';

type SubmenuState = 'main' | 'colors' | 'note';

interface SelectionMenuProps {
  selection: Selection | null;
  onCopy: () => void;
  onBookmark?: () => void;
  onHighlightWithColor?: (color: string) => void;
  onNoteWithColor?: (color: string, note: string) => void;
  onClose: () => void;
}

/**
 * SelectionMenu - Memoized text selection popup with submenu support
 */
export const SelectionMenu = memo(function SelectionMenu({
  selection,
  onCopy,
  onBookmark,
  onHighlightWithColor,
  onNoteWithColor,
  onClose,
}: SelectionMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<SubmenuState>('main');
  const [noteText, setNoteText] = useState('');
  const [selectedNoteColor, setSelectedNoteColor] = useState<string>(HIGHLIGHT_COLORS[0].value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset submenu state when selection changes
  useEffect(() => {
    setSubmenu('main');
    setNoteText('');
    setSelectedNoteColor(HIGHLIGHT_COLORS[0].value);
  }, [selection?.cfiRange]);

  // Focus textarea when note submenu opens
  useEffect(() => {
    if (submenu === 'note') {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [submenu]);

  /**
   * Handle click outside to close menu
   */
  useEffect(() => {
    if (!selection) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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
  }, [selection, onClose]);

  /**
   * Handle Escape key to close menu or go back to main
   */
  useEffect(() => {
    if (!selection) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (submenu !== 'main') {
          setSubmenu('main');
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selection, onClose, submenu]);

  /**
   * Calculate menu position (above or below selection)
   */
  const getMenuStyle = useCallback((): React.CSSProperties => {
    if (!selection) return { display: 'none' };

    const menuHeight = submenu === 'note' ? 180 : 60;
    const menuWidth = submenu === 'main' ? 280 : 220;
    const offset = 10;

    const spaceAbove = selection.position.y;
    const spaceBelow = window.innerHeight - selection.position.y;

    const positionAbove = spaceBelow < menuHeight + offset && spaceAbove > menuHeight + offset;

    const left = Math.max(
      10,
      Math.min(selection.position.x - menuWidth / 2, window.innerWidth - menuWidth - 10)
    );

    const top = positionAbove
      ? selection.position.y - menuHeight - offset
      : selection.position.y + offset;

    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      zIndex: 600,
    };
  }, [selection, submenu]);

  const handleCopy = useCallback(() => {
    onCopy();
    onClose();
  }, [onCopy, onClose]);

  const handleBookmark = useCallback(() => {
    if (onBookmark) {
      onBookmark();
      onClose();
    }
  }, [onBookmark, onClose]);

  const handleHighlightColor = useCallback(
    (color: string) => {
      if (onHighlightWithColor) {
        onHighlightWithColor(color);
        onClose();
      }
    },
    [onHighlightWithColor, onClose]
  );

  const handleSaveNote = useCallback(() => {
    if (onNoteWithColor && noteText.trim()) {
      onNoteWithColor(selectedNoteColor, noteText.trim());
      onClose();
    }
  }, [onNoteWithColor, selectedNoteColor, noteText, onClose]);

  if (!selection) return null;

  return (
    <div
      ref={menuRef}
      style={getMenuStyle()}
      className="bg-popover text-popover-foreground border border-border rounded-lg shadow-lg backdrop-blur-sm overflow-hidden"
      role="menu"
      aria-label={t('reader.menu.aria_label', 'Text selection menu')}
    >
      {submenu === 'main' && (
        <div className="flex items-stretch divide-x divide-border">
          {/* Copy */}
          <button
            onClick={handleCopy}
            className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-h-[44px] min-w-[60px] hover:bg-muted active:bg-muted/80 transition-colors"
            aria-label={t('reader.menu.copy', 'Copy')}
          >
            <Copy className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs">{t('reader.menu.copy', 'Copy')}</span>
          </button>

          {/* Bookmark */}
          {onBookmark && (
            <button
              onClick={handleBookmark}
              className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-h-[44px] min-w-[60px] hover:bg-muted active:bg-muted/80 transition-colors"
              aria-label={t('reader.menu.bookmark', 'Bookmark')}
            >
              <Bookmark className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">{t('reader.menu.bookmark', 'Bookmark')}</span>
            </button>
          )}

          {/* Highlight - opens color picker */}
          {onHighlightWithColor && (
            <button
              onClick={() => setSubmenu('colors')}
              className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-h-[44px] min-w-[60px] hover:bg-muted active:bg-muted/80 transition-colors"
              aria-label={t('reader.menu.highlight', 'Highlight')}
            >
              <Highlighter className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">{t('reader.menu.highlight', 'Highlight')}</span>
            </button>
          )}

          {/* Note - opens color picker + textarea */}
          {onNoteWithColor && (
            <button
              onClick={() => setSubmenu('note')}
              className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-h-[44px] min-w-[60px] hover:bg-muted active:bg-muted/80 transition-colors"
              aria-label={t('reader.menu.note', 'Note')}
            >
              <StickyNote className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">{t('reader.menu.note', 'Note')}</span>
            </button>
          )}
        </div>
      )}

      {submenu === 'colors' && (
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('reader.menu.pick_color', 'Pick color')}
            </span>
            <button
              onClick={() => setSubmenu('main')}
              className="p-1 hover:bg-muted rounded min-w-[28px] min-h-[28px] flex items-center justify-center"
              aria-label={t('common.back', 'Back')}
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-center justify-center gap-4">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.name}
                onClick={() => handleHighlightColor(c.value)}
                className="w-8 h-8 rounded-full border-2 border-transparent hover:border-foreground/30 active:scale-90 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label={c.name}
              >
                <span className="w-7 h-7 rounded-full block" style={{ backgroundColor: c.value }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {submenu === 'note' && (
        <div className="p-3 w-[260px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('reader.menu.add_note', 'Add note')}
            </span>
            <button
              onClick={() => setSubmenu('main')}
              className="p-1 hover:bg-muted rounded min-w-[28px] min-h-[28px] flex items-center justify-center"
              aria-label={t('common.back', 'Back')}
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
          {/* Color picker row */}
          <div className="flex items-center gap-3 mb-2">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.name}
                onClick={() => setSelectedNoteColor(c.value)}
                className={`w-6 h-6 rounded-full border-2 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center ${
                  selectedNoteColor === c.value
                    ? 'border-foreground scale-110'
                    : 'border-transparent hover:border-foreground/30'
                }`}
                aria-label={c.name}
                aria-pressed={selectedNoteColor === c.value}
              >
                <span className="w-5 h-5 rounded-full block" style={{ backgroundColor: c.value }} />
              </button>
            ))}
          </div>
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={t('reader.menu.note_placeholder', 'Write a note...')}
            className="w-full h-16 px-2 py-1.5 text-sm bg-muted rounded border border-border resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSaveNote();
              }
            }}
          />
          <button
            onClick={handleSaveNote}
            disabled={!noteText.trim()}
            className="mt-2 w-full py-1.5 min-h-[36px] text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('reader.menu.save', 'Save')}
          </button>
        </div>
      )}

      {/* Character count for long selections (main menu only) */}
      {submenu === 'main' && selection.text.length > 100 && (
        <div className="px-3 py-1 text-xs text-muted-foreground border-t border-border bg-opacity-50">
          {selection.text.length} {t('reader.menu.characters', 'characters selected')}
        </div>
      )}
    </div>
  );
});
