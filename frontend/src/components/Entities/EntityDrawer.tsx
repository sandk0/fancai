import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Drawer } from 'vaul';
import { EntityDetail, NetworkEdge } from '../../types/entity';
import { EntityProfile } from './EntityProfile';
import { isEntityMet, getFirstMeetingChapter } from '../../utils/entityUtils';
import { X, ChevronRight, Lock, Grid } from 'lucide-react';
import { ScrollArea } from '../UI/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../UI/avatar';

const DEBUG_MODE = process.env.NODE_ENV === 'development';

interface EntityDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    entities: Record<string, EntityDetail>;
    edges: NetworkEdge[];
    currentChapter: number;
    initialEntityId?: string | null;
}

export const EntityDrawer: React.FC<EntityDrawerProps> = ({
    isOpen,
    onClose,
    entities,
    edges,
    currentChapter,
    initialEntityId
}) => {
    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(initialEntityId || null);
    const navigate = useNavigate();
    const { bookId } = useParams();

    // Reset selection when closing/opening with new initialId
    useEffect(() => {
        if (isOpen && initialEntityId) {
            setSelectedEntityId(initialEntityId);
        } else if (isOpen && !initialEntityId) {
            setSelectedEntityId(null);
        }
    }, [isOpen, initialEntityId]);

    const entityList = Object.values(entities).sort((a, b) => (b.importance || 0) - (a.importance || 0));

    const relationships = React.useMemo(() => {
        if (!selectedEntityId || !edges) return [];
        return edges
            .filter(e => e.source === selectedEntityId || e.target === selectedEntityId)
            .map(e => {
                const otherId = e.source === selectedEntityId ? e.target : e.source;
                return {
                    entity: entities[otherId],
                    type: e.type,
                    description: e.description
                };
            })
            .filter(r => r.entity);
    }, [selectedEntityId, edges, entities]);

    return (
        <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <Drawer.Portal>
                <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
                <Drawer.Content className="bg-[#0a0a0a] flex flex-col rounded-t-[10px] h-[92vh] mt-24 fixed bottom-0 left-0 right-0 md:max-w-xl md:mx-auto z-50 outline-none border-t border-white/10 shadow-2xl">
                    <div className="p-4 bg-[#0a0a0a] rounded-t-[10px] flex-1 flex flex-col h-full">
                        <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-white/20 mb-4" />

                        {/* Header Controls */}
                        <div className="flex justify-between items-center mb-4 px-2">
                            {selectedEntityId ? (
                                <button
                                    onClick={() => setSelectedEntityId(null)}
                                    className="text-blue-400 text-sm font-medium hover:text-blue-300"
                                >
                                    ← К списку
                                </button>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <h2 className="text-lg font-semibold text-white">Персонажи</h2>
                                    <button
                                        onClick={() => navigate(`/book/${bookId}/gallery`)}
                                        className="p-1.5 bg-white/10 rounded-full text-purple-400 hover:bg-white/20 hover:text-purple-300 transition-colors"
                                        title="Открыть галерею"
                                    >
                                        <Grid size={16} />
                                    </button>
                                </div>
                            )}

                            <button
                                onClick={onClose}
                                className="p-3 bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-hidden relative">
                            {selectedEntityId && entities[selectedEntityId] ? (
                                <EntityProfile
                                    entity={entities[selectedEntityId]}
                                    relatedEntities={relationships}
                                    onEntityClick={(id) => setSelectedEntityId(id)}
                                    currentChapter={currentChapter}
                                />
                            ) : (
                                <ScrollArea className="h-full">
                                    <div className="space-y-2 pb-20 px-2">
                                        {entityList.map((entity) => {
                                            // Logic: Check if character is met via centralized utility
                                            const isMet = isEntityMet(entity, currentChapter);

                                            return (
                                                <div
                                                    key={entity.id}
                                                    onClick={() => setSelectedEntityId(entity.id)}
                                                    className={`flex items-center p-3 rounded-lg transition-colors cursor-pointer border border-transparent 
                                                        ${isMet ? 'bg-white/5 hover:bg-white/10 hover:border-white/10' : 'bg-transparent opacity-50 hover:opacity-100 hover:bg-white/5'}`}
                                                >
                                                    <Avatar className={`h-12 w-12 mr-4 border ${isMet ? 'border-white/10' : 'border-white/5'}`}>
                                                        <AvatarImage
                                                            src={entity.avatar_url || undefined}
                                                            className={!isMet ? 'grayscale brightness-50' : ''}
                                                        />
                                                        <AvatarFallback className="bg-neutral-800 text-gray-400">
                                                            {entity.name ? entity.name[0] : '?'}
                                                        </AvatarFallback>
                                                    </Avatar>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <h3 className={`font-medium truncate ${isMet ? 'text-slate-200' : 'text-slate-400'}`}>
                                                                {entity.name}
                                                            </h3>
                                                            {!isMet && <Lock className="w-3 h-3 text-slate-600" />}
                                                        </div>

                                                        <p className="text-xs text-slate-500 truncate">
                                                            {entity.type === 'CHARACTER' ? 'Персонаж' :
                                                                entity.type === 'LOCATION' ? 'Локация' : 'Объект'}
                                                        </p>

                                                        {/* DEBUG OVERLAY */}
                                                        {DEBUG_MODE && (
                                                            <div className="text-[10px] text-yellow-500 font-mono mt-1">
                                                                Ch: {currentChapter} vs First: {isEntityMet(entity, currentChapter) ? 'Met' : getFirstMeetingChapter(entity)}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <ChevronRight className="text-slate-600 w-5 h-5 ml-2" />
                                                </div>
                                            );
                                        })}

                                        {entityList.length === 0 && (
                                            <div className="text-center py-10 text-slate-500">
                                                Персонажи не найдены.
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>
                            )}
                        </div>
                    </div>
                </Drawer.Content>
            </Drawer.Portal>
        </Drawer.Root>
    );
};
