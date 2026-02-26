import React from 'react';
import { useTranslation } from 'react-i18next';
import { EntityDetail, NetworkEdge } from '../../types/entity';
import { isEntityMetCFI } from '../../utils/entityUtils';
import { entityTypeLabels, getBaseRoleLabel } from './entityTypeLabels';
import { EntityEventTimeline } from './EntityEventTimeline';
import { ScrollArea } from '../UI/scroll-area';
import { Avatar, AvatarImage, AvatarFallback } from '../UI/avatar';
import { Badge } from '../UI/badge';
import { Card } from '../UI/Card';
import { cn } from '@/lib/utils';
import { Lock, ChevronRight, User, MapPin, Box } from 'lucide-react';

interface RelationItem {
    entity: EntityDetail;
    type: string;
    description?: string | null;
    edge?: NetworkEdge;
}

interface EntityProfileProps {
    entity: EntityDetail;
    currentChapter: number;
    currentCFI?: string | null;
    relatedEntities?: RelationItem[];
    onEntityClick?: (id: string) => void;
    onRelationshipClick?: (edge: NetworkEdge, sourceEntity: EntityDetail, targetEntity: EntityDetail) => void;
}

const PlaceholderIcon: React.FC<{ type: string; className?: string }> = ({ type, className }) => {
    switch (type) {
        case 'location': return <MapPin className={className} />;
        case 'object': return <Box className={className} />;
        default: return <User className={className} />;
    }
};

export const EntityProfile: React.FC<EntityProfileProps> = ({
    entity,
    currentChapter,
    currentCFI,
    relatedEntities = [],
    onEntityClick,
    onRelationshipClick
}) => {
    const { t } = useTranslation();
    const isUnknown = !isEntityMetCFI(entity, currentCFI ?? null, currentChapter);
    const roleLabel = getBaseRoleLabel(entity.dynamic_role || entity.base_role);
    const biography = entity.biography;
    const appearance = entity.visual_summary_clean || entity.visual_summary;
    // Backend already filters events by current chapter in _filter_events_by_chapter().
    const events = entity.events || [];

    return (
        <div className="bg-[var(--color-bg-base)] text-[var(--color-text-default)] h-full flex flex-col">
            <div className="relative h-64 w-full flex-shrink-0">
                {entity.avatar_url ? (
                    <img
                        src={entity.avatar_url}
                        alt={entity.name}
                        className={cn(
                            "w-full h-full object-cover transition-all duration-700",
                            isUnknown && "grayscale brightness-[0.4] blur-[2px]"
                        )}
                        style={{ maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-b from-[var(--color-bg-emphasis)] to-[var(--color-bg-base)] flex items-center justify-center">
                        <Avatar className="w-32 h-32 opacity-50">
                            <AvatarFallback className="text-6xl font-serif bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
                                <PlaceholderIcon type={entity.type} className="w-16 h-16" />
                            </AvatarFallback>
                        </Avatar>
                    </div>
                )}

                <div className="absolute bottom-0 left-0 p-6 w-full bg-gradient-to-t from-[var(--color-bg-base)] via-[var(--color-bg-base)]/80 to-transparent">
                    <h1 className="text-3xl font-serif font-bold text-[var(--color-text-default)] drop-shadow-md flex items-center gap-3">
                        {entity.name}
                        {isUnknown && <Lock className="w-5 h-5 text-[var(--color-text-muted)] opacity-70" aria-hidden="true" />}
                    </h1>
                    <div className="flex gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="border-[var(--color-accent-500)]/50 text-[var(--color-accent-500)]">
                            {entityTypeLabels[entity.type] || entity.type}
                        </Badge>
                        {roleLabel && !isUnknown && (
                            <Badge variant="secondary" className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
                                {roleLabel}
                            </Badge>
                        )}
                        {entity.first_mention_chapter != null && !isUnknown && (
                            <Badge variant="secondary" className="bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
                                {t('entities.first_appearance', { chapter: entity.first_mention_chapter })}
                            </Badge>
                        )}
                        {isUnknown && (
                            <Badge variant="secondary" className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
                                {t('entities.not_met')}
                            </Badge>
                        )}
                    </div>
                </div>
            </div>

            <ScrollArea className="flex-1 p-6">
                <div className="space-y-6 pb-20">
                    {!isUnknown && biography && (
                        <Card variant="elevated" padding="md">
                            <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
                                {t('entities.about')}
                            </h3>
                            <p className="text-sm text-[var(--color-text-default)] leading-relaxed">
                                {biography}
                            </p>
                        </Card>
                    )}

                    {appearance && (
                        <Card variant="elevated" padding="md">
                            <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
                                {t('entities.appearance')}
                            </h3>
                            <p className="text-[var(--color-text-muted)] italic text-sm">
                                {appearance}
                            </p>
                        </Card>
                    )}

                    {entity.aliases && entity.aliases.length > 0 && !isUnknown && (
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
                                {t('entities.aliases_section')}
                            </h3>
                            <div className="flex gap-1.5 flex-wrap">
                                {entity.aliases.map((alias, i) => (
                                    <Badge key={i} variant="outline" className="text-xs">
                                        {alias}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}

                    {!isUnknown && relatedEntities.length > 0 && (
                        <section aria-labelledby="relations-heading">
                            <h3 id="relations-heading" className="text-lg font-semibold mb-3 border-b border-[var(--color-border-default)] pb-2">
                                {t('entities.relations')}
                            </h3>
                            <div className="grid grid-cols-1 gap-2" role="list">
                                {relatedEntities.map((rel, idx) => {
                                    const isRelMet = isEntityMetCFI(rel.entity, currentCFI ?? null, currentChapter);
                                    const hasEdge = rel.edge && onRelationshipClick;

                                    const handleClick = () => {
                                        if (!isRelMet) return;
                                        if (hasEdge && rel.edge) {
                                            onRelationshipClick(rel.edge, entity, rel.entity);
                                        } else {
                                            onEntityClick?.(rel.entity.id);
                                        }
                                    };

                                    return (
                                        <Card
                                            key={rel.entity.id + idx}
                                            asChild
                                            interactive
                                            variant="subtle"
                                            padding="sm"
                                            disabled={!isRelMet}
                                            className={cn("w-full", !isRelMet && "opacity-60")}
                                        >
                                            <button
                                                type="button"
                                                role="listitem"
                                                onClick={handleClick}
                                                aria-label={`${rel.entity.name} — ${rel.type}`}
                                                className="flex items-center text-left"
                                            >
                                                <Avatar className="h-8 w-8 mr-3">
                                                    <AvatarImage
                                                        src={rel.entity.avatar_url || undefined}
                                                        className={!isRelMet ? "grayscale" : ""}
                                                    />
                                                    <AvatarFallback>{rel.entity.name[0]}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex justify-between items-center">
                                                        <span className={cn(
                                                            "text-sm font-medium truncate",
                                                            isRelMet ? "text-[var(--color-text-default)]" : "text-[var(--color-text-muted)]"
                                                        )}>
                                                            {rel.entity.name}
                                                        </span>
                                                        <Badge
                                                            variant="secondary"
                                                            className="text-[10px] h-5 px-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]"
                                                        >
                                                            {rel.type}
                                                        </Badge>
                                                    </div>
                                                    {rel.description && (
                                                        <p className="text-xs text-[var(--color-text-subtle)] truncate mt-0.5">
                                                            {rel.description}
                                                        </p>
                                                    )}
                                                </div>
                                                {isRelMet && (
                                                    <ChevronRight
                                                        className="w-4 h-4 text-[var(--color-text-disabled)] ml-2 shrink-0"
                                                        aria-hidden="true"
                                                    />
                                                )}
                                            </button>
                                        </Card>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {!isUnknown && events.length > 0 && (
                        <section aria-labelledby="events-heading">
                            <h3 id="events-heading" className="text-lg font-semibold mb-4 border-b border-[var(--color-border-default)] pb-2">
                                {t('entities.by_chapters')}
                            </h3>
                            <EntityEventTimeline events={entity.events || []} currentChapter={currentChapter} />
                        </section>
                    )}

                    {isUnknown && (
                        <Card variant="elevated" padding="lg" className="text-center space-y-3">
                            <Lock className="w-8 h-8 text-[var(--color-text-disabled)] mx-auto mb-2" aria-hidden="true" />
                            <h4 className="text-[var(--color-text-default)] font-medium">{t('entities.info_hidden')}</h4>
                            <p className="text-[var(--color-text-muted)] text-sm">
                                {t('entities.info_hidden_desc')}
                            </p>
                        </Card>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};
