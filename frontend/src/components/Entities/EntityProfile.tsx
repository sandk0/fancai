import React from 'react';
import { EntityDetail } from '../../types/entity';
import { isEntityMet } from '../../utils/entityUtils';
import { SpoilerText } from './SpoilerText';
import { ScrollArea } from '../UI/scroll-area';
import { Avatar, AvatarImage, AvatarFallback } from '../UI/avatar';
import { Badge } from '../UI/badge';
import { Lock } from 'lucide-react';

interface RelationItem {
    entity: EntityDetail;
    type: string; // e.g. "ALLY", "ENEMY"
    description?: string | null;
}

interface EntityProfileProps {
    entity: EntityDetail;
    currentChapter: number;
    relatedEntities?: RelationItem[];
    onEntityClick?: (id: string) => void;
}

export const EntityProfile: React.FC<EntityProfileProps> = ({
    entity,
    currentChapter,
    relatedEntities = [],
    onEntityClick
}) => {
    // Determine visibility using centralized utility
    const isUnknown = !isEntityMet(entity, currentChapter);

    return (
        <div className="bg-slate-900 text-white min-h-[80vh] flex flex-col">
            {/* Hero Section - ALWAYS VISIBLE */}
            <div className="relative h-64 w-full">
                {entity.avatar_url ? (
                    <img
                        src={entity.avatar_url}
                        alt={entity.name}
                        className={`w-full h-full object-cover transition-all duration-700 ${isUnknown ? 'grayscale brightness-[0.4] blur-[2px]' : ''}`}
                        style={{ maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-b from-blue-950 to-slate-900 flex items-center justify-center">
                        <Avatar className="w-32 h-32 opacity-50">
                            <AvatarFallback className="text-6xl font-serif bg-blue-900/30 text-slate-400">
                                {entity.name[0]}
                            </AvatarFallback>
                        </Avatar>
                    </div>
                )}

                <div className="absolute bottom-0 left-0 p-6 w-full bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent">
                    <h1 className="text-3xl font-serif font-bold text-white drop-shadow-md flex items-center gap-3">
                        {entity.name}
                        {isUnknown && <Lock className="w-5 h-5 text-slate-400 opacity-70" />}
                    </h1>
                    <div className="flex gap-2 mt-2">
                        <Badge variant="outline" className="border-blue-500/50 text-blue-400">
                            {entity.type}
                        </Badge>
                        {isUnknown && (
                            <Badge variant="secondary" className="bg-slate-800 text-slate-400">
                                Не встречен
                            </Badge>
                        )}
                    </div>
                </div>
            </div>

            {/* Content Section */}
            <ScrollArea className="flex-1 p-6">
                <div className="space-y-6 pb-20">
                    {/* Visual Summary */}
                    {entity.visual_summary && (
                        <div className="bg-slate-800/30 p-4 rounded-lg border border-slate-700/50">
                            <h3 className="text-sm font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                                Внешность
                            </h3>
                            <p className="text-gray-400 italic text-sm">
                                {entity.visual_summary}
                            </p>
                        </div>
                    )}

                    {/* Relationships Section (NEW) */}
                    {!isUnknown && relatedEntities.length > 0 && (
                        <div>
                            <h3 className="text-lg font-bold mb-3 border-b border-slate-700 pb-2">Связи</h3>
                            <div className="grid grid-cols-1 gap-2">
                                {relatedEntities.map((rel, idx) => {
                                    // Check if relation target is met
                                    const isRelMet = isEntityMet(rel.entity, currentChapter);

                                    return (
                                        <div
                                            key={rel.entity.id + idx}
                                            onClick={() => isRelMet && onEntityClick?.(rel.entity.id)}
                                            className={`flex items-center p-2 rounded bg-slate-800/40 border border-slate-800 
                                                ${isRelMet ? 'cursor-pointer hover:bg-slate-800 hover:border-slate-700' : 'opacity-60 cursor-default'}`}
                                        >
                                            <Avatar className="h-8 w-8 mr-3">
                                                <AvatarImage src={rel.entity.avatar_url || undefined} className={!isRelMet ? "grayscale" : ""} />
                                                <AvatarFallback>{rel.entity.name[0]}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-center">
                                                    <span className={`text-sm font-medium truncate ${isRelMet ? 'text-slate-200' : 'text-slate-500'}`}>
                                                        {rel.entity.name}
                                                    </span>
                                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-slate-700 text-slate-400">
                                                        {rel.type}
                                                    </Badge>
                                                </div>
                                                {rel.description && (
                                                    <p className="text-xs text-slate-500 truncate mt-0.5">
                                                        {rel.description}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Progressive Lore (Notes) or Spoiler Warning */}
                    <div>
                        <h3 className="text-lg font-bold mb-4 border-b border-slate-700 pb-2">История</h3>

                        {isUnknown ? (
                            <div className="bg-slate-800/20 border border-slate-800 rounded-lg p-6 text-center space-y-3">
                                <Lock className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                                <h4 className="text-slate-300 font-medium">Информация скрыта</h4>
                                <p className="text-slate-500 text-sm">
                                    История этого персонажа скрыта, чтобы не испортить вам впечатление от чтения.
                                    Продолжайте читать, и информация откроется автоматически.
                                </p>
                            </div>
                        ) : (
                            // Visible Content
                            entity.notes.length === 0 ? (
                                <p className="text-gray-500">Нет записей.</p>
                            ) : (
                                <div className="space-y-4">
                                    {entity.notes.map((note, idx) => (
                                        <div key={idx} className="bg-slate-900/50 rounded p-3 text-sm leading-relaxed border-l-2 border-slate-700 pl-4">
                                            <SpoilerText
                                                text={note.text}
                                                chapterIndex={note.chapter_index}
                                                currentChapter={currentChapter}
                                            />
                                            <div className="text-xs text-right mt-1 text-slate-600">
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
