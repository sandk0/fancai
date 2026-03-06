/**
 * HighlightsList - Displays highlights grouped by chapter
 *
 * Features:
 * - Grouped by chapter_number
 * - Color indicator circle for each highlight
 * - Click to navigate to highlight position
 * - Inline note editing
 * - Delete highlight
 * - Empty state
 * - i18n support
 *
 * @component
 */

import React, { useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Highlighter, Trash2, Pencil, Check } from 'lucide-react';

interface HighlightData {
  id: string;
  cfi_range: string;
  chapter_number: number;
  text: string;
  color: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface HighlightsListProps {
  highlights: HighlightData[];
  onNavigate: (cfiRange: string) => void;
  onDelete: (highlightId: string, cfiRange: string) => void;
  onUpdateNote: (highlightId: string, note: string) => void;
}

export const HighlightsList: React.FC<HighlightsListProps> = React.memo(function HighlightsList({
  highlights,
  onNavigate,
  onDelete,
  onUpdateNote,
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');

  const grouped = useMemo(() => {
    const groups: Record<number, HighlightData[]> = {};
    for (const h of highlights) {
      if (!groups[h.chapter_number]) {
        groups[h.chapter_number] = [];
      }
      groups[h.chapter_number].push(h);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([chapter, items]) => ({
        chapter: Number(chapter),
        items: items.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
      }));
  }, [highlights]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, highlightId: string, cfiRange: string) => {
      e.stopPropagation();
      onDelete(highlightId, cfiRange);
    },
    [onDelete]
  );

  const handleStartEdit = useCallback((e: React.MouseEvent, highlight: HighlightData) => {
    e.stopPropagation();
    setEditingId(highlight.id);
    setEditNoteText(highlight.note || '');
  }, []);

  const handleSaveNote = useCallback(
    (e: React.MouseEvent, highlightId: string) => {
      e.stopPropagation();
      onUpdateNote(highlightId, editNoteText);
      setEditingId(null);
      setEditNoteText('');
    },
    [editNoteText, onUpdateNote]
  );

  if (highlights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <Highlighter className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground text-center">
          {t('reader.highlights.empty', 'No highlights')}
        </p>
        <p className="text-xs text-muted-foreground/60 text-center mt-1">
          {t('reader.highlights.empty_hint', 'Select text and tap "Highlight"')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(({ chapter, items }) => (
        <div key={chapter}>
          <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('reader.highlights.chapter', 'Chapter {{number}}', { number: chapter })}
          </div>
          <div className="space-y-1">
            {items.map((highlight) => (
              <div key={highlight.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(highlight.cfi_range)}
                  className="flex items-start gap-3 w-full px-4 py-3 min-h-[44px] text-left hover:bg-muted active:bg-muted/80 rounded-lg transition-colors group"
                >
                  {/* Color indicator */}
                  <span
                    className="w-3 h-3 rounded-full mt-1 shrink-0 ring-1 ring-border"
                    style={{ backgroundColor: highlight.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm line-clamp-3">{highlight.text}</p>
                    {highlight.note && editingId !== highlight.id && (
                      <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                        {highlight.note}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(highlight.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Edit note button */}
                    <button
                      type="button"
                      onClick={(e) => handleStartEdit(e, highlight)}
                      className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-muted rounded transition-all"
                      aria-label={t('reader.highlights.edit_note', 'Edit note')}
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, highlight.id, highlight.cfi_range)}
                      className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/10 rounded transition-all"
                      aria-label={t('reader.highlights.delete', 'Delete highlight')}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                </button>

                {/* Inline note editor */}
                {editingId === highlight.id && (
                  <div className="px-4 pb-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={editNoteText}
                      onChange={(e) => setEditNoteText(e.target.value)}
                      placeholder={t('reader.highlights.note_placeholder', 'Add a note...')}
                      className="flex-1 h-16 px-2 py-1.5 text-sm bg-muted rounded border border-border resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          onUpdateNote(highlight.id, editNoteText);
                          setEditingId(null);
                        }
                        if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={(e) => handleSaveNote(e, highlight.id)}
                      className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors self-end"
                      aria-label={t('reader.highlights.save_note', 'Save')}
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
