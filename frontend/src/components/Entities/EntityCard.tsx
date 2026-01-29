import React from 'react';
import { EntityDetail } from '../../types/entity';
import { isEntityMetCFI, getFirstMeetingChapter } from '../../utils/entityUtils';
import { ChevronRight, Lock } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../UI/avatar';

const DEBUG_MODE = process.env.NODE_ENV === 'development';

/** Map entity type to Russian label */
export const entityTypeLabels: Record<string, string> = {
    CHARACTER: 'Персонаж',
    LOCATION: 'Локация',
    OBJECT: 'Объект',
};

interface EntityCardProps {
    entity: EntityDetail;
    currentChapter: number;
    currentCFI?: string | null;
    onClick?: () => void;
}

export const EntityCard: React.FC<EntityCardProps> = ({
    entity,
    currentChapter,
    currentCFI,
    onClick,
}) => {
    const isMet = isEntityMetCFI(entity, currentCFI ?? null, currentChapter);
    const typeLabel = entityTypeLabels[entity.type] || entity.type;

    return (
        <div
            onClick={onClick}
            className={`flex items-center p-3 rounded-lg transition-colors cursor-pointer border border-transparent 
                ${isMet 
                    ? 'bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)] hover:border-[var(--color-border-subtle)]' 
                    : 'bg-transparent opacity-50 hover:opacity-100 hover:bg-[var(--color-bg-elevated)]'
                }`}
        >
            <Avatar className={`h-12 w-12 mr-4 border ${isMet ? 'border-[var(--color-border-default)]' : 'border-[var(--color-border-subtle)]'}`}>
                <AvatarImage
                    src={entity.avatar_url || undefined}
                    className={!isMet ? 'grayscale brightness-50' : ''}
                />
                <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
                    {entity.name ? entity.name[0] : '?'}
                </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h3 className={`font-medium truncate ${isMet ? 'text-[var(--color-text-default)]' : 'text-[var(--color-text-muted)]'}`}>
                        {entity.name}
                    </h3>
                    {!isMet && <Lock className="w-3 h-3 text-[var(--color-text-disabled)]" />}
                </div>

                <p className="text-xs text-[var(--color-text-subtle)] truncate">
                    {typeLabel}
                </p>

                {DEBUG_MODE && (
                    <div className="text-[10px] text-[var(--color-warning)] font-mono mt-1">
                        Ch: {currentChapter} | CFI: {currentCFI ? 'Y' : 'N'} | First: {isMet ? 'Met' : getFirstMeetingChapter(entity)}
                    </div>
                )}
            </div>

            <ChevronRight className="text-[var(--color-text-disabled)] w-5 h-5 ml-2" />
        </div>
    );
};
