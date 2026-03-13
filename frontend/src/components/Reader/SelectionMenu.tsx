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

export interface EditModeData {
  bookmarkId: string;
  note: string | null;
  color: string | null;
  text_color: string | null;
  style: string;
  position: { x: number; y: number };
  onSave: (
    bookmarkId: string,
    opts: { color?: string | null; style?: string; note?: string; text_color?: string | null }
  ) => void;
}

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
  editMode?: EditModeData;
}

/**
 * SelectionMenu - Memoized text selection popup with note submenu
 */
export const SelectionMenu = memo(function SelectionMenu({
  selection,
  onCopy,
  onBookmark,
  onClose,
  editMode,
}: SelectionMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<SubmenuState>('main');
  const [noteText, setNoteText] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(BOOKMARK_COLORS[0].value);
  const [selectedTextColor, setSelectedTextColor] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<BookmarkStyle>('none');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset submenu state when selection changes or edit mode activates
  useEffect(() => {
    if (editMode) {
      // Edit mode: pre-populate from existing bookmark
      setSubmenu('note');
      setNoteText(editMode.note ?? '');
      setSelectedColor(editMode.color ?? BOOKMARK_COLORS[0].value);
      setSelectedTextColor(editMode.text_color ?? null);
      setSelectedStyle((editMode.style as BookmarkStyle) ?? 'none');
    } else {
      setSubmenu('main');
      setNoteText('');
      setSelectedColor(BOOKMARK_COLORS[0].value);
      setSelectedTextColor(null);
      setSelectedStyle('none');
    }
  }, [selection?.cfiRange, editMode?.bookmarkId]);

  // Note: no auto-focus on textarea — on mobile it forces the keyboard open,
  // which is disruptive when the user just wants to pick a color/style without typing

  // Handle click outside to close menu
  useEffect(() => {
    if (!selection && !editMode) return;

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
  }, [selection, editMode, onClose]);

  // Handle Escape key to close menu or go back to main
  useEffect(() => {
    if (!selection && !editMode) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (editMode) {
          // In edit mode, Escape always closes
          onClose();
        } else if (submenu !== 'main') {
          setSubmenu('main');
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selection, editMode, onClose, submenu]);

  // Calculate menu position (above or below selection)
  const getMenuStyle = useCallback((): React.CSSProperties => {
    const pos = editMode?.position ?? selection?.position;
    if (!pos) return { display: 'none' };

    const menuHeight = submenu === 'note' ? 320 : 60;
    const menuWidth = submenu === 'main' ? 160 : 260;
    const offset = 10;

    // Use bottom of selection for below-placement, fallback for editMode
    const posBottom = ('bottom' in pos ? (pos as { bottom: number }).bottom : null) ?? pos.y + 20;
    const spaceAbove = pos.y;
    const spaceBelow = window.innerHeight - posBottom;

    const positionAbove = spaceBelow < menuHeight + offset && spaceAbove > menuHeight + offset;

    const left = Math.max(10, Math.min(pos.x - menuWidth / 2, window.innerWidth - menuWidth - 10));

    const top = positionAbove ? pos.y - menuHeight - offset : posBottom + offset;

    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      zIndex: 600,
    };
  }, [selection, editMode, submenu]);

  const handleCopy = useCallback(() => {
    onCopy();
    onClose();
  }, [onCopy, onClose]);

  // Save note — allow saving without text if there's a style/color/text_color
  const handleSaveNote = useCallback(() => {
    const opts = {
      color: selectedColor,
      style: selectedStyle,
      note: noteText.trim() || undefined,
      text_color: selectedTextColor,
    };

    if (editMode) {
      editMode.onSave(editMode.bookmarkId, opts);
      onClose();
      return;
    }

    if (!onBookmark) return;

    const hasVisualStyle = selectedStyle !== 'none' || selectedColor || selectedTextColor;
    const hasNote = noteText.trim();

    if (!hasVisualStyle && !hasNote) return;

    onBookmark(opts);
    onClose();
  }, [editMode, onBookmark, selectedColor, selectedTextColor, selectedStyle, noteText, onClose]);

  if (!selection && !editMode) return null;

  const hasVisualStyle = selectedStyle !== 'none' || selectedColor || selectedTextColor;
  const canSave = hasVisualStyle || noteText.trim();

  return (
    <>
      {/* Backdrop to dismiss menu on outside tap.
          Must have a painted background (rgba 0.01) — mobile browsers skip fully
          transparent elements during touch hit-testing. */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 599, background: 'rgba(0,0,0,0.01)' }}
        onClick={onClose}
        onTouchStart={onClose}
        aria-hidden="true"
      />
      <div
        ref={menuRef}
        style={getMenuStyle()}
        className="bg-popover text-popover-foreground border border-border rounded-lg shadow-lg backdrop-blur-sm overflow-hidden"
        role="menu"
        aria-label={t('reader.menu.aria_label', 'Text selection menu')}
      >
        {submenu === 'main' && !editMode && (
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
                {editMode
                  ? t('reader.menu.edit_note', 'Edit note')
                  : t('reader.menu.add_note', 'Add note')}
              </span>
              <button
                onClick={() => (editMode ? onClose() : setSubmenu('main'))}
                className="p-1 hover:bg-muted rounded min-w-[28px] min-h-[28px] flex items-center justify-center"
                aria-label={editMode ? t('common.close', 'Close') : t('common.back', 'Back')}
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
                  <span
                    className="w-5 h-5 rounded-full block"
                    style={{ backgroundColor: c.value }}
                  />
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
                  <span
                    className="w-5 h-5 rounded-full block"
                    style={{ backgroundColor: c.value }}
                  />
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
        {submenu === 'main' && !editMode && selection && selection.text.length > 100 && (
          <div className="px-3 py-1 text-xs text-muted-foreground border-t border-border bg-opacity-50">
            {selection.text.length} {t('reader.menu.characters', 'characters selected')}
          </div>
        )}
      </div>
    </>
  );
});
