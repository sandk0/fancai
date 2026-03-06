/**
 * BookmarksList - Displays bookmarks grouped by chapter
 *
 * Features:
 * - Grouped by chapter_number
 * - Click to navigate to bookmark position
 * - Delete bookmark with trash icon
 * - Empty state with bookmark icon
 * - i18n support
 *
 * @component
 */

import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, Trash2 } from 'lucide-react';

interface BookmarkData {
  id: string;
  cfi: string;
  chapter_number: number;
  text_excerpt: string;
  created_at: string;
}

interface BookmarksListProps {
  bookmarks: BookmarkData[];
  onNavigate: (cfi: string) => void;
  onDelete: (bookmarkId: string) => void;
}

export const BookmarksList: React.FC<BookmarksListProps> = React.memo(function BookmarksList({
  bookmarks,
  onNavigate,
  onDelete,
}) {
  const { t } = useTranslation();

  const grouped = useMemo(() => {
    const groups: Record<number, BookmarkData[]> = {};
    for (const b of bookmarks) {
      if (!groups[b.chapter_number]) {
        groups[b.chapter_number] = [];
      }
      groups[b.chapter_number].push(b);
    }
    // Sort by chapter number
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
    (e: React.MouseEvent, bookmarkId: string) => {
      e.stopPropagation();
      onDelete(bookmarkId);
    },
    [onDelete]
  );

  if (bookmarks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <Bookmark className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground text-center">
          {t('reader.bookmarks.empty', 'No bookmarks')}
        </p>
        <p className="text-xs text-muted-foreground/60 text-center mt-1">
          {t('reader.bookmarks.empty_hint', 'Select text and tap "Bookmark"')}
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
              <button
                key={bookmark.id}
                type="button"
                onClick={() => onNavigate(bookmark.cfi)}
                className="flex items-start gap-3 w-full px-4 py-3 min-h-[44px] text-left hover:bg-muted active:bg-muted/80 rounded-lg transition-colors group"
              >
                <Bookmark className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-clamp-2">{bookmark.text_excerpt}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(bookmark.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, bookmark.id)}
                  className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/10 rounded transition-all shrink-0"
                  aria-label={t('reader.bookmarks.delete', 'Delete bookmark')}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </button>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});
