import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Drawer } from 'vaul';
import { EntityDetail, NetworkEdge } from '../../types/entity';
import { EntityProfile } from './EntityProfile';
import { EntityList } from './EntityList';
import { X, Grid } from 'lucide-react';

interface EntityDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    entities: Record<string, EntityDetail>;
    edges: NetworkEdge[];
    currentChapter: number;
    currentCFI?: string | null;
    initialEntityId?: string | null;
    isLoading?: boolean;
}

export const EntityDrawer: React.FC<EntityDrawerProps> = ({
    isOpen,
    onClose,
    entities,
    edges,
    currentChapter,
    currentCFI,
    initialEntityId,
    isLoading = false
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
                <Drawer.Overlay className="fixed inset-0 bg-[var(--color-bg-overlay)] backdrop-blur-sm z-50" />
                <Drawer.Content className="bg-[var(--color-bg-base)] flex flex-col rounded-t-[10px] h-[92vh] mt-24 fixed bottom-0 left-0 right-0 md:max-w-xl md:mx-auto z-50 outline-none border-t border-[var(--color-border-default)] shadow-2xl">
                    <div className="p-4 bg-[var(--color-bg-base)] rounded-t-[10px] flex-1 flex flex-col h-full">
                        <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-[var(--color-bg-hover)] mb-4" />

                        <div className="flex justify-between items-center mb-4 px-2">
                            {selectedEntityId ? (
                                <button
                                    onClick={() => setSelectedEntityId(null)}
                                    className="text-[var(--color-link)] text-sm font-medium hover:text-[var(--color-link-hover)]"
                                >
                                    ← К списку
                                </button>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <h2 className="text-lg font-semibold text-[var(--color-text-default)]">Персонажи</h2>
                                    <button
                                        onClick={() => navigate(`/book/${bookId}/gallery`)}
                                        className="p-1.5 bg-[var(--color-bg-elevated)] rounded-full text-[var(--color-accent-500)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-accent-400)] transition-colors"
                                        title="Открыть галерею"
                                    >
                                        <Grid size={16} />
                                    </button>
                                </div>
                            )}

                            <button
                                onClick={onClose}
                                className="p-3 bg-[var(--color-bg-elevated)] rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-default)] transition-colors"
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
                                    currentCFI={currentCFI}
                                />
                            ) : (
                                <EntityList
                                    entities={entities}
                                    currentChapter={currentChapter}
                                    currentCFI={currentCFI}
                                    onEntitySelect={(id) => setSelectedEntityId(id)}
                                    isLoading={isLoading}
                                />
                            )}
                        </div>
                    </div>
                </Drawer.Content>
            </Drawer.Portal>
        </Drawer.Root>
    );
};
