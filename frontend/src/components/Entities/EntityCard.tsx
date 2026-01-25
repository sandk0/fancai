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
                    ? 'bg-[var(--color-bg-elevated,white/5)] hover:bg-[var(--color-bg-hover,white/10)] hover:border-[var(--color-border-subtle,white/10)]' 
                    : 'bg-transparent opacity-50 hover:opacity-100 hover:bg-[var(--color-bg-elevated,white/5)]'
                }`}
        >
            <Avatar className={`h-12 w-12 mr-4 border ${isMet ? 'border-[var(--color-border-default,white/10)]' : 'border-[var(--color-border-subtle,white/5)]'}`}>
                <AvatarImage
                    src={entity.avatar_url || undefined}
                    className={!isMet ? 'grayscale brightness-50' : ''}
                />
                <AvatarFallback className="bg-neutral-800 text-[var(--color-text-muted,gray)]">
                    {entity.name ? entity.name[0] : '?'}
                </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h3 className={`font-medium truncate ${isMet ? 'text-[var(--color-text-default,#e2e8f0)]' : 'text-[var(--color-text-muted,#94a3b8)]'}`}>
                        {entity.name}
                    </h3>
                    {!isMet && <Lock className="w-3 h-3 text-[var(--color-text-disabled,#475569)]" />}
                </div>

                <p className="text-xs text-[var(--color-text-subtle,#64748b)] truncate">
                    {typeLabel}
                </p>

                {DEBUG_MODE && (
                    <div className="text-[10px] text-yellow-500 font-mono mt-1">
                        Ch: {currentChapter} | CFI: {currentCFI ? 'Y' : 'N'} | First: {isMet ? 'Met' : getFirstMeetingChapter(entity)}
                    </div>
                )}
            </div>

            <ChevronRight className="text-[var(--color-text-disabled,#475569)] w-5 h-5 ml-2" />
        </div>
    );
};
