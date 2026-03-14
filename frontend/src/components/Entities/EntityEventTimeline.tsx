import React from 'react';
import { useTranslation } from 'react-i18next';
import type { EntityEvent } from '../../types/entity';

interface Props {
  events: EntityEvent[];
  currentChapter: number;
}

export const EntityEventTimeline: React.FC<Props> = ({ events, currentChapter }) => {
  const { t } = useTranslation();

  const filtered = events.filter((e) => e.chapter_number <= currentChapter);
  if (filtered.length === 0) return null;

  // Group by chapter
  const grouped = new Map<number, EntityEvent[]>();
  for (const event of filtered) {
    const list = grouped.get(event.chapter_number) || [];
    list.push(event);
    grouped.set(event.chapter_number, list);
  }

  const chapters = Array.from(grouped.keys()).sort((a, b) => a - b);

  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-0 bottom-0 w-[2px] bg-[var(--color-border-default)]" />
      {chapters.map((ch) => (
        <div key={ch} className="relative mb-6 last:mb-0">
          <div className="absolute -left-4 top-1 w-2.5 h-2.5 rounded-full bg-[var(--color-accent-500)] ring-2 ring-[var(--color-bg-base)]" />
          <span className="font-serif text-xs font-medium text-[var(--color-accent-500)]">
            {t('entities.chapter')} {ch}
          </span>
          <div className="space-y-1 mt-1.5">
            {grouped.get(ch)!.map((event, idx) => (
              <div key={idx} className="text-sm text-[var(--color-text-muted)]">
                <span>{event.event_action}</span>
                {event.event_inner_state && (
                  <span className="font-serif italic text-[var(--color-text-subtle)] ml-1">
                    — {event.event_inner_state}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
