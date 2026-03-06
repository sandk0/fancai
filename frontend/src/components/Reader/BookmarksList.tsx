/**
 * BookmarksList - Displays unified bookmarks grouped by chapter
 *
 * Features:
 * - Grouped by chapter_number
 * - Color indicator circle (if color set)
 * - Style badge (highlight/underline/bold/italic)
 * - Click to navigate to bookmark position
 * - Inline note editing
 * - Delete bookmark
 * - Empty state
 * - i18n support
 *
 * @component
 */

import React, { useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StickyNote, Trash2, Pencil, Check } from 'lucide-react';
import type { BookmarkResponse } from '@/hooks/api/useSync';

interface BookmarksListProps {
  bookmarks: BookmarkResponse[];
  onNavigate: (cfiRange: string, bookmarkId?: string) => void;
  onDelete: (bookmarkId: string, cfiRange: string) => void;
  onUpdateNote: (bookmarkId: string, note: string) => void;
}

const STYLE_LABELS: Record<string, string> = {
  underline: 'U',
  bold: 'B',
  italic: 'I',
};

export const BookmarksList: React.FC<BookmarksListProps> = React.memo(function BookmarksList({
  bookmarks,
  onNavigate,
  onDelete,
  onUpdateNote,
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');

  const grouped = useMemo(() => {
    const groups: Record<number, BookmarkResponse[]> = {};
    for (const b of bookmarks) {
      if (!groups[b.chapter_number]) {
        groups[b.chapter_number] = [];
      }
      groups[b.chapter_number].push(b);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([chapter, items]) => ({
        chapter: Number(chapter),
        items: items.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
      }));
  }, [bookmarks]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, bookmarkId: string, cfiRange: string) => {
      e.stopPropagation();
      onDelete(bookmarkId, cfiRange);
    },
    [onDelete]
  );

  const handleStartEdit = useCallback((e: React.MouseEvent, bookmark: BookmarkResponse) => {
    e.stopPropagation();
    setEditingId(bookmark.id);
    setEditNoteText(bookmark.note || '');
  }, []);

  const handleSaveNote = useCallback(
    (e: React.MouseEvent, bookmarkId: string) => {
      e.stopPropagation();
      onUpdateNote(bookmarkId, editNoteText);
      setEditingId(null);
      setEditNoteText('');
    },
    [editNoteText, onUpdateNote]
  );

  if (bookmarks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <StickyNote className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground text-center">
          {t('reader.bookmarks.empty', 'No notes')}
        </p>
        <p className="text-xs text-muted-foreground/60 text-center mt-1">
          {t('reader.bookmarks.empty_hint', 'Select text and tap "Note"')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(({ chapter, items }) => (
        <div key={chapter}>
          <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('reader.bookmarks.chapter', 'Chapter {{number}}', { number: chapter })}
          </div>
          <div className="space-y-1">
            {items.map((bookmark) => (
              <div key={bookmark.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(bookmark.cfi_range, bookmark.id)}
                  className="flex items-start gap-3 w-full px-4 py-3 min-h-[44px] text-left hover:bg-muted active:bg-muted/80 rounded-lg transition-colors group"
                >
                  {/* Color indicator or bookmark icon */}
                  {bookmark.color ? (
                    <span
                      className="w-3 h-3 rounded-full mt-1 shrink-0 ring-1 ring-border"
                      style={{ backgroundColor: bookmark.color }}
                    />
                  ) : (
                    <StickyNote className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm line-clamp-2 flex-1">{bookmark.text}</p>
                      {/* Style badge */}
                      {bookmark.style !== 'none' && STYLE_LABELS[bookmark.style] && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground">
                          {STYLE_LABELS[bookmark.style]}
                        </span>
                      )}
                    </div>
                    {bookmark.note && editingId !== bookmark.id && (
                      <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                        {bookmark.note}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(bookmark.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Edit note button */}
                    <button
                      type="button"
                      onClick={(e) => handleStartEdit(e, bookmark)}
                      className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-muted rounded transition-all"
                      aria-label={t('reader.bookmarks.edit_note', 'Edit note')}
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, bookmark.id, bookmark.cfi_range)}
                      className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/10 rounded transition-all"
                      aria-label={t('reader.bookmarks.delete', 'Delete bookmark')}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                </button>

                {/* Inline note editor */}
                {editingId === bookmark.id && (
                  <div className="px-4 pb-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={editNoteText}
                      onChange={(e) => setEditNoteText(e.target.value)}
                      placeholder={t('reader.bookmarks.note_placeholder', 'Add a note...')}
                      className="flex-1 h-16 px-2 py-1.5 text-sm bg-muted rounded border border-border resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          onUpdateNote(bookmark.id, editNoteText);
                          setEditingId(null);
                        }
                        if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={(e) => handleSaveNote(e, bookmark.id)}
                      className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors self-end"
                      aria-label={t('reader.bookmarks.save_note', 'Save')}
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});
