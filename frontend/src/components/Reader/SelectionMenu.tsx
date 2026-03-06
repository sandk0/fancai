/**
 * SelectionMenu - Popup menu for selected text in EPUB reader
 *
 * Features:
 * - Copy to clipboard
 * - Note with style/color/text-color picker + optional textarea
 * - Smart positioning (above/below selection)
 * - Mobile-friendly touch targets (min 44px)
 * - Click outside to close
 * - Submenu states: main | note
 *
 * @component
 */

import { useEffect, useRef, useCallback, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, StickyNote, X } from 'lucide-react';
import type { Selection } from '@/hooks/epub/useTextSelection';
import { BOOKMARK_COLORS } from '@/hooks/epub/useBookmarks';

type SubmenuState = 'main' | 'note';

type BookmarkStyle = 'none' | 'underline' | 'bold' | 'italic';

const STYLE_OPTIONS: { key: BookmarkStyle; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'underline', label: 'Underline' },
  { key: 'bold', label: 'Bold' },
  { key: 'italic', label: 'Italic' },
];

interface SelectionMenuProps {
  selection: Selection | null;
  onCopy: () => void;
  onBookmark?: (opts: {
    color?: string | null;
    style?: string;
    note?: string;
    text_color?: string | null;
  }) => void;
  onClose: () => void;
}

/**
 * SelectionMenu - Memoized text selection popup with note submenu
 */
export const SelectionMenu = memo(function SelectionMenu({
  selection,
  onCopy,
  onBookmark,
  onClose,
}: SelectionMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<SubmenuState>('main');
  const [noteText, setNoteText] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(BOOKMARK_COLORS[0].value);
  const [selectedTextColor, setSelectedTextColor] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<BookmarkStyle>('none');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset submenu state when selection changes
  useEffect(() => {
    setSubmenu('main');
    setNoteText('');
    setSelectedColor(BOOKMARK_COLORS[0].value);
    setSelectedTextColor(null);
    setSelectedStyle('none');
  }, [selection?.cfiRange]);

  // Focus textarea when note submenu opens
  useEffect(() => {
    if (submenu === 'note') {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [submenu]);

  // Handle click outside to close menu
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

  // Handle Escape key to close menu or go back to main
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

  // Calculate menu position (above or below selection)
  const getMenuStyle = useCallback((): React.CSSProperties => {
    if (!selection) return { display: 'none' };

    const menuHeight = submenu === 'note' ? 320 : 60;
    const menuWidth = submenu === 'main' ? 160 : 260;
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

  // Save note — allow saving without text if there's a style/color/text_color
  const handleSaveNote = useCallback(() => {
    if (!onBookmark) return;

    const hasVisualStyle = selectedStyle !== 'none' || selectedColor || selectedTextColor;
    const hasNote = noteText.trim();

    if (!hasVisualStyle && !hasNote) return;

    onBookmark({
      color: selectedColor,
      style: selectedStyle,
      note: hasNote ? noteText.trim() : undefined,
      text_color: selectedTextColor,
    });
    onClose();
  }, [onBookmark, selectedColor, selectedTextColor, selectedStyle, noteText, onClose]);

  if (!selection) return null;

  const hasVisualStyle = selectedStyle !== 'none' || selectedColor || selectedTextColor;
  const canSave = hasVisualStyle || noteText.trim();

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
            className="flex flex-col items-center justify-center gap-1 px-4 py-2 min-h-[44px] min-w-[60px] hover:bg-muted active:bg-muted/80 transition-colors"
            aria-label={t('reader.menu.copy', 'Copy')}
          >
            <Copy className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs">{t('reader.menu.copy', 'Copy')}</span>
          </button>

          {/* Note - opens style/color picker + textarea */}
          {onBookmark && (
            <button
              onClick={() => setSubmenu('note')}
              className="flex flex-col items-center justify-center gap-1 px-4 py-2 min-h-[44px] min-w-[60px] hover:bg-muted active:bg-muted/80 transition-colors"
              aria-label={t('reader.menu.note', 'Note')}
            >
              <StickyNote className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">{t('reader.menu.note', 'Note')}</span>
            </button>
          )}
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

          {/* Style row */}
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {STYLE_OPTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSelectedStyle(s.key)}
                className={`px-2 py-1 text-xs rounded-md border transition-all min-h-[28px] ${
                  selectedStyle === s.key
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border hover:border-foreground/30 text-muted-foreground'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Background color row */}
          <div className="mb-1">
            <span className="text-[10px] text-muted-foreground">
              {t('reader.menu.bg_color', 'Background')}
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setSelectedColor(null)}
              className={`w-6 h-6 rounded-full border-2 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center ${
                selectedColor === null
                  ? 'border-foreground scale-110'
                  : 'border-border hover:border-foreground/30'
              }`}
              aria-label="No background color"
            >
              <span className="w-5 h-5 rounded-full block bg-muted relative overflow-hidden">
                <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                  /
                </span>
              </span>
            </button>
            {BOOKMARK_COLORS.map((c) => (
              <button
                key={c.name}
                onClick={() => setSelectedColor(c.value)}
                className={`w-6 h-6 rounded-full border-2 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center ${
                  selectedColor === c.value
                    ? 'border-foreground scale-110'
                    : 'border-transparent hover:border-foreground/30'
                }`}
                aria-label={c.name}
              >
                <span className="w-5 h-5 rounded-full block" style={{ backgroundColor: c.value }} />
              </button>
            ))}
          </div>

          {/* Text color row */}
          <div className="mb-1">
            <span className="text-[10px] text-muted-foreground">
              {t('reader.menu.text_color', 'Text color')}
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setSelectedTextColor(null)}
              className={`w-6 h-6 rounded-full border-2 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center ${
                selectedTextColor === null
                  ? 'border-foreground scale-110'
                  : 'border-border hover:border-foreground/30'
              }`}
              aria-label="No text color"
            >
              <span className="w-5 h-5 rounded-full block bg-muted relative overflow-hidden">
                <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                  /
                </span>
              </span>
            </button>
            {BOOKMARK_COLORS.map((c) => (
              <button
                key={c.name}
                onClick={() => setSelectedTextColor(c.value)}
                className={`w-6 h-6 rounded-full border-2 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center ${
                  selectedTextColor === c.value
                    ? 'border-foreground scale-110'
                    : 'border-transparent hover:border-foreground/30'
                }`}
                aria-label={`${c.name} text`}
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
            placeholder={t('reader.menu.note_placeholder', 'Write a note (optional)...')}
            className="w-full h-16 px-2 py-1.5 text-sm bg-muted rounded border border-border resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSaveNote();
              }
            }}
          />
          <button
            onClick={handleSaveNote}
            disabled={!canSave}
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
