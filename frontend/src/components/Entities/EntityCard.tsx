import React from 'react';
import { useTranslation } from 'react-i18next';
import { EntityDetail } from '../../types/entity';
import { isEntityMetCFI, getFirstMeetingChapter } from '../../utils/entityUtils';
import { ChevronRight, Lock, User, MapPin, Box } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../UI/avatar';
import { Badge } from '../UI/badge';
import { Card } from '../UI/Card';
import { cn } from '@/lib/utils';
import { entityTypeLabels, getBaseRoleLabel } from './entityTypeLabels';

const DEBUG_MODE = import.meta.env.DEV;

interface EntityCardProps {
    entity: EntityDetail;
    currentChapter: number;
    currentCFI?: string | null;
    onClick?: () => void;
}

const TypeIcon: React.FC<{ type: string; className?: string }> = ({ type, className }) => {
    switch (type) {
        case 'location': return <MapPin className={className} />;
        case 'object': return <Box className={className} />;
        default: return <User className={className} />;
    }
};

export const EntityCard: React.FC<EntityCardProps> = ({
    entity,
    currentChapter,
    currentCFI,
    onClick,
}) => {
    const { t } = useTranslation();
    const isMet = isEntityMetCFI(entity, currentCFI ?? null, currentChapter);
    const typeLabel = entityTypeLabels[entity.type] || entity.type;
    const roleLabel = getBaseRoleLabel(entity.dynamic_role || entity.base_role);
    const summary = entity.visual_summary_clean || entity.visual_summary;

    // Find latest event up to current chapter
    const lastEvent = (entity.events || [])
        .filter(e => e.chapter_number <= currentChapter)
        .sort((a, b) => b.chapter_number - a.chapter_number)[0];

    return (
        <Card
            asChild
            interactive
            variant={isMet ? "elevated" : "ghost"}
            padding="sm"
            disabled={!isMet}
            className={cn(
                "w-full",
                !isMet && "opacity-50 hover:opacity-100"
            )}
        >
            <button
                type="button"
                onClick={onClick}
                aria-label={isMet ? entity.name : `${entity.name} — ${t('entities.not_met')}`}
                className="flex items-center text-left"
            >
                <Avatar className={cn(
                    "h-12 w-12 mr-4 border",
                    isMet ? "border-[var(--color-border-default)]" : "border-[var(--color-border-subtle)]"
                )}>
                    <AvatarImage
                        src={entity.avatar_url || undefined}
                        className={!isMet ? 'grayscale brightness-50' : ''}
                    />
                    <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
                        {entity.avatar_url ? (entity.name ? entity.name[0] : '?') : (
                            <TypeIcon type={entity.type} className="w-5 h-5" />
                        )}
                    </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className={cn(
                            "font-medium truncate",
                            isMet ? "text-[var(--color-text-default)]" : "text-[var(--color-text-muted)]"
                        )}>
                            {entity.name}
                        </h3>
                        {!isMet && <Lock className="w-3 h-3 text-[var(--color-text-disabled)]" aria-hidden="true" />}
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-[var(--color-text-subtle)]">{typeLabel}</span>
                        {roleLabel && isMet && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1">
                                {roleLabel}
                            </Badge>
                        )}
                    </div>

                    {isMet && summary && (
                        <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5 italic">
                            {summary.length > 50 ? `${summary.slice(0, 50)}...` : summary}
                        </p>
                    )}

                    {isMet && lastEvent && (
                        <p className="text-[10px] text-[var(--color-text-subtle)] truncate mt-0.5">
                            {lastEvent.event_action}
                        </p>
                    )}

                    {DEBUG_MODE && (
                        <div className="text-[10px] text-[var(--color-warning)] font-mono mt-1">
                            Ch: {currentChapter} | CFI: {currentCFI ? 'Y' : 'N'} | First: {isMet ? 'Met' : getFirstMeetingChapter(entity)}
                        </div>
                    )}
                </div>

                <ChevronRight className="text-[var(--color-text-disabled)] w-5 h-5 ml-2 shrink-0" aria-hidden="true" />
            </button>
        </Card>
    );
};
