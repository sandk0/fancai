import React from 'react';
import { useTranslation } from 'react-i18next';
import type { EntityEvent } from '../../types/entity';
import { Badge } from '../UI/badge';

interface Props {
    events: EntityEvent[];
    currentChapter: number;
}

export const EntityEventTimeline: React.FC<Props> = ({ events, currentChapter }) => {
    const { t } = useTranslation();

    const filtered = events.filter(e => e.chapter_number <= currentChapter);
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
            <div className="absolute left-2 top-0 bottom-0 w-px bg-[var(--color-border-default)]" />
            {chapters.map(ch => (
                <div key={ch} className="relative mb-4 last:mb-0">
                    <div className="absolute -left-4 top-1 w-3 h-3 rounded-full bg-[var(--color-accent-500)] border-2 border-[var(--color-bg-base)]" />
                    <Badge variant="outline" className="text-[10px] mb-1.5">
                        {t('entities.chapter')} {ch}
                    </Badge>
                    <div className="space-y-1">
                        {grouped.get(ch)!.map((event, idx) => (
                            <div key={idx} className="text-sm text-[var(--color-text-muted)]">
                                <span>{event.event_action}</span>
                                {event.event_inner_state && (
                                    <span className="italic text-[var(--color-text-subtle)] ml-1">
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
