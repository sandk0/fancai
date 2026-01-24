import React, { useState } from 'react';
import { Drawer } from 'vaul';
import { EntityDetail } from '../../types/entity';
import { EntityProfile } from './EntityProfile';
import { X, ChevronRight, User } from 'lucide-react';
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
    React.useEffect(() => {
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
                                    ← Back to List
                                </button>
                            ) : (
                                <h2 className="text-lg font-semibold text-white">Characters</h2>
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
                                            // Check if met logic (simplified) with safe access
                                            const mentions = entity.mentions || [];
                                            const firstMeeting = mentions.length > 0 ? Math.min(...mentions) : 9999;
                                            const isMet = firstMeeting <= currentChapter;

                                            return (
                                                <div
                                                    key={entity.id}
                                                    onClick={() => setSelectedEntityId(entity.id)}
                                                    className="flex items-center p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors cursor-pointer border border-transparent hover:border-slate-700"
                                                >
                                                    <Avatar className="h-12 w-12 mr-4 border border-slate-700">
                                                        <AvatarImage src={isMet ? (entity.avatar_url || undefined) : undefined} className={!isMet ? 'blur-sm grayscale' : ''} />
                                                        <AvatarFallback className="bg-slate-700 text-slate-400">
                                                            {isMet ? (entity.name ? entity.name[0] : '?') : '?'}
                                                        </AvatarFallback>
                                                    </Avatar>

                                                    <div className="flex-1 min-w-0">
                                                        <h3 className="font-medium text-slate-200 truncate">
                                                            {isMet ? entity.name : 'Unknown Entity'}
                                                        </h3>
                                                        <p className="text-xs text-slate-500 truncate">
                                                            {isMet ? entity.type : 'Keep reading to discover'}
                                                        </p>
                                                    </div>

                                                    <ChevronRight className="text-slate-600 w-5 h-5 ml-2" />
                                                </div>
                                            );
                                        })}

                                        {entityList.length === 0 && (
                                            <div className="text-center py-10 text-slate-500">
                                                {/* If empty, show loading or empty state. Since we don't have isLoading prop here yet, assume empty if ready */}
                                                No characters found.
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
