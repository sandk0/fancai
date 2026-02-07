import React from 'react';
import { useTranslation } from 'react-i18next';
import { useRecap } from '@/hooks/api/useRecap';
import { Avatar, AvatarImage, AvatarFallback } from '../UI/avatar';
import { Badge } from '../UI/badge';
import { Card } from '../UI/Card';

interface Props {
    bookId: string;
    currentChapter: number;
    onEntityClick?: (entityId: string) => void;
}

export const RecapPanel: React.FC<Props> = ({ bookId, currentChapter, onEntityClick }) => {
    const { t } = useTranslation();
    const { data, isLoading } = useRecap(bookId, currentChapter);

    if (isLoading || !data?.entities?.length) return null;

    return (
        <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                {t('entities.recap_title')}
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
                {data.entities.map(entity => (
                    <Card
                        key={entity.id}
                        asChild
                        interactive
                        variant="elevated"
                        padding="sm"
                        className="min-w-[140px] max-w-[160px] shrink-0"
                    >
                        <button
                            type="button"
                            onClick={() => onEntityClick?.(entity.id)}
                            className="flex flex-col items-center text-center"
                        >
                            <Avatar className="h-12 w-12 mb-2">
                                <AvatarImage src={entity.avatar_url || undefined} />
                                <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
                                    {entity.name[0]}
                                </AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-medium text-[var(--color-text-default)] truncate w-full">
                                {entity.name}
                            </span>
                            {entity.dynamic_role && (
                                <Badge variant="secondary" className="text-[9px] h-4 px-1 mt-1">
                                    {entity.dynamic_role}
                                </Badge>
                            )}
                            {entity.last_event && (
                                <p className="text-[10px] text-[var(--color-text-subtle)] mt-1 line-clamp-2">
                                    {entity.last_event.event_action}
                                </p>
                            )}
                        </button>
                    </Card>
                ))}
            </div>
        </section>
    );
};
