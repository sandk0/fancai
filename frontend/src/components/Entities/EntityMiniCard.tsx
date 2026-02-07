import React from 'react';
import type { EntityDetail, EntityEvent } from '../../types/entity';
import { Avatar, AvatarImage, AvatarFallback } from '../UI/avatar';
import { Badge } from '../UI/badge';
import { getBaseRoleLabel } from './entityTypeLabels';

interface Props {
    entity: EntityDetail;
    currentChapter: number;
    relationCount?: number;
    onClick?: () => void;
}

export const EntityMiniCard: React.FC<Props> = ({ entity, currentChapter, relationCount = 0, onClick }) => {
    const roleLabel = getBaseRoleLabel(entity.dynamic_role || entity.base_role);
    const summary = entity.visual_summary_clean || entity.visual_summary;
    const truncatedSummary = summary && summary.length > 80 ? summary.slice(0, 80) + '...' : summary;

    // Find latest event up to current chapter
    const lastEvent: EntityEvent | undefined = (entity.events || [])
        .filter(e => e.chapter_number <= currentChapter)
        .sort((a, b) => b.chapter_number - a.chapter_number)[0];

    return (
        <button
            type="button"
            onClick={onClick}
            className="flex items-start gap-3 p-3 rounded-xl bg-[var(--color-bg-elevated)] shadow-lg border border-[var(--color-border-default)] max-w-[280px] text-left"
        >
            <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={entity.avatar_url || undefined} />
                <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
                    {entity.name[0]}
                </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-[var(--color-text-default)] truncate">
                        {entity.name}
                    </span>
                    {roleLabel && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">
                            {roleLabel}
                        </Badge>
                    )}
                </div>
                {truncatedSummary && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">
                        {truncatedSummary}
                    </p>
                )}
                {lastEvent && (
                    <p className="text-[10px] text-[var(--color-text-subtle)] mt-1 truncate">
                        {lastEvent.event_action}
                    </p>
                )}
                {relationCount > 0 && (
                    <span className="text-[10px] text-[var(--color-text-disabled)]">
                        {relationCount} {relationCount === 1 ? 'связь' : 'связей'}
                    </span>
                )}
            </div>
        </button>
    );
};
