import React from 'react';
import { EntityDetail, NetworkEdge } from '../../types/entity';
import { isEntityMetCFI } from '../../utils/entityUtils';
import { SpoilerText } from './SpoilerText';
import { ScrollArea } from '../UI/scroll-area';
import { Avatar, AvatarImage, AvatarFallback } from '../UI/avatar';
import { Badge } from '../UI/badge';
import { Lock, ChevronRight } from 'lucide-react';

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

export const EntityProfile: React.FC<EntityProfileProps> = ({
    entity,
    currentChapter,
    currentCFI,
    relatedEntities = [],
    onEntityClick,
    onRelationshipClick
}) => {
    const isUnknown = !isEntityMetCFI(entity, currentCFI ?? null, currentChapter);

    return (
        <div className="bg-[var(--color-bg-base)] text-[var(--color-text-default)] h-full flex flex-col">
            <div className="relative h-64 w-full flex-shrink-0">
                {entity.avatar_url ? (
                    <img
                        src={entity.avatar_url}
                        alt={entity.name}
                        className={`w-full h-full object-cover transition-all duration-700 ${isUnknown ? 'grayscale brightness-[0.4] blur-[2px]' : ''}`}
                        style={{ maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-b from-blue-950 to-[var(--color-bg-base)] flex items-center justify-center">
                        <Avatar className="w-32 h-32 opacity-50">
                            <AvatarFallback className="text-6xl font-serif bg-[var(--color-bg-elevated,white/10)] text-[var(--color-text-muted)]">
                                {entity.name[0]}
                            </AvatarFallback>
                        </Avatar>
                    </div>
                )}

                <div className="absolute bottom-0 left-0 p-6 w-full bg-gradient-to-t from-[var(--color-bg-base)] via-[var(--color-bg-base)]/80 to-transparent">
                    <h1 className="text-3xl font-serif font-bold text-[var(--color-text-default)] drop-shadow-md flex items-center gap-3">
                        {entity.name}
                        {isUnknown && <Lock className="w-5 h-5 text-[var(--color-text-muted)] opacity-70" />}
                    </h1>
                    <div className="flex gap-2 mt-2">
                        <Badge variant="outline" className="border-[var(--color-accent-500)]/50 text-[var(--color-accent-500)]">
                            {entity.type}
                        </Badge>
                        {isUnknown && (
                            <Badge variant="secondary" className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
                                Не встречен
                            </Badge>
                        )}
                    </div>
                </div>
            </div>

            <ScrollArea className="flex-1 p-6">
                <div className="space-y-6 pb-20">
                    {entity.visual_summary && (
                        <div className="bg-[var(--color-bg-elevated,white/5)] p-4 rounded-lg border border-[var(--color-border-default,white/10)]">
                            <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
                                Внешность
                            </h3>
                            <p className="text-[var(--color-text-muted)] italic text-sm">
                                {entity.visual_summary}
                            </p>
                        </div>
                    )}

                    {!isUnknown && relatedEntities.length > 0 && (
                        <div>
                            <h3 className="text-lg font-bold mb-3 border-b border-[var(--color-border-default,white/10)] pb-2">Связи</h3>
                            <div className="grid grid-cols-1 gap-2">
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
                                        <div
                                            key={rel.entity.id + idx}
                                            onClick={handleClick}
                                            className={`flex items-center p-3 rounded bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] 
                                                ${isRelMet ? 'cursor-pointer hover:bg-[var(--color-bg-hover)] hover:border-[var(--color-border-default)] transition-colors' : 'opacity-60 cursor-default'}`}
                                        >
                                            <Avatar className="h-8 w-8 mr-3">
                                                <AvatarImage src={rel.entity.avatar_url || undefined} className={!isRelMet ? "grayscale" : ""} />
                                                <AvatarFallback>{rel.entity.name[0]}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-center">
                                                    <span className={`text-sm font-medium truncate ${isRelMet ? 'text-[var(--color-text-default)]' : 'text-[var(--color-text-muted)]'}`}>
                                                        {rel.entity.name}
                                                    </span>
                                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
                                                        {rel.type}
                                                    </Badge>
                                                </div>
                                                {rel.description && (
                                                    <p className="text-xs text-[var(--color-text-subtle)] truncate mt-0.5">
                                                        {rel.description}
                                                    </p>
                                                )}
                                            </div>
                                            {isRelMet && <ChevronRight className="w-4 h-4 text-[var(--color-text-disabled)] ml-2" />}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div>
                        <h3 className="text-lg font-bold mb-4 border-b border-[var(--color-border-default,white/10)] pb-2">История</h3>

                        {isUnknown ? (
                            <div className="bg-[var(--color-bg-elevated,white/5)] border border-[var(--color-border-default,white/10)] rounded-lg p-6 text-center space-y-3">
                                <Lock className="w-8 h-8 text-[var(--color-text-disabled)] mx-auto mb-2" />
                                <h4 className="text-[var(--color-text-default)] font-medium">Информация скрыта</h4>
                                <p className="text-[var(--color-text-muted)] text-sm">
                                    История этого персонажа скрыта, чтобы не испортить вам впечатление от чтения.
                                    Продолжайте читать, и информация откроется автоматически.
                                </p>
                            </div>
                        ) : (
                            entity.notes.length === 0 ? (
                                <p className="text-[var(--color-text-muted)]">Нет записей.</p>
                            ) : (
                                <div className="space-y-4">
                                    {entity.notes.map((note, idx) => (
                                        <div key={idx} className="bg-[var(--color-bg-muted)]/20 rounded p-3 text-sm leading-relaxed border-l-2 border-[var(--color-border-default,white/20)] pl-4">
                                                    <SpoilerText
                                                        text={note.text}
                                                        chapterIndex={note.chapter_index}
                                                        currentChapter={currentChapter}
                                                        noteCfi={note.cfi}
                                                        currentCfi={currentCFI}
                                                    />
                                            <div className="text-xs text-right mt-1 text-[var(--color-text-disabled)]">
                                                Глава {note.chapter_index} • {note.type}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )
                        )}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
};
