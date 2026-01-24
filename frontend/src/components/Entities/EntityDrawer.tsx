import React, { useState, useEffect } from 'react';
import { Drawer } from 'vaul';
import { EntityDetail } from '../../types/entity';
import { EntityProfile } from './EntityProfile';
import { isEntityMet } from '../../utils/entityUtils';
import { X, ChevronRight, Lock } from 'lucide-react';
import { ScrollArea } from '../UI/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../UI/avatar';

interface EntityDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    entities: Record<string, EntityDetail>;
    currentChapter: number;
    initialEntityId?: string | null;
}

export const EntityDrawer: React.FC<EntityDrawerProps> = ({
    isOpen,
    onClose,
    entities,
    currentChapter,
    initialEntityId
}) => {
    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(initialEntityId || null);

    // Reset selection when closing/opening with new initialId
    useEffect(() => {
        if (isOpen && initialEntityId) {
            setSelectedEntityId(initialEntityId);
        } else if (isOpen && !initialEntityId) {
            setSelectedEntityId(null);
        }
    }, [isOpen, initialEntityId]);

    const entityList = Object.values(entities).sort((a, b) => (b.importance || 0) - (a.importance || 0));

    return (
        <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <Drawer.Portal>
                <Drawer.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
                <Drawer.Content className="bg-slate-900 flex flex-col rounded-t-[10px] h-[92vh] mt-24 fixed bottom-0 left-0 right-0 z-50 outline-none border-t border-slate-700">
                    <div className="p-4 bg-slate-900 rounded-t-[10px] flex-1 flex flex-col h-full">
                        <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-slate-700 mb-4" />

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
                                <h2 className="text-lg font-semibold text-white">Персонажи</h2>
                            )}

                            <button
                                onClick={onClose}
                                className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-hidden relative">
                            {selectedEntityId && entities[selectedEntityId] ? (
                                <EntityProfile
                                    entity={entities[selectedEntityId]}
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
                                                        ${isMet ? 'bg-slate-800/50 hover:bg-slate-800 hover:border-slate-700' : 'bg-slate-900/30 opacity-70 hover:opacity-100 hover:bg-slate-800/30'}`}
                                                >
                                                    <Avatar className={`h-12 w-12 mr-4 border ${isMet ? 'border-slate-700' : 'border-slate-800'}`}>
                                                        <AvatarImage
                                                            src={entity.avatar_url || undefined}
                                                            className={!isMet ? 'grayscale brightness-50' : ''}
                                                        />
                                                        <AvatarFallback className="bg-slate-800 text-slate-500">
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

                                                        {/* DEBUG OVERLAY (Hidden by default, can un-comment if needed) */}
                                                        {/* <div className="text-[10px] text-yellow-600 font-mono mt-1">
                                                            Debug: {safeCurrentChapter} vs {firstMeeting}
                                                        </div> */}
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
