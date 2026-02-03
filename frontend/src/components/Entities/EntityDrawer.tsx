import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Drawer } from 'vaul';
import { EntityDetail, NetworkEdge } from '../../types/entity';
import { EntityProfile } from './EntityProfile';
import { EntityList } from './EntityList';
import { RelationshipCard } from './RelationshipCard';
import { X, Grid } from 'lucide-react';

interface SelectedRelationship {
    edge: NetworkEdge;
    sourceEntity: EntityDetail;
    targetEntity: EntityDetail;
}

interface EntityDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    entities: Record<string, EntityDetail>;
    edges: NetworkEdge[];
    currentChapter: number;
    maxChapterReached: number;
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
    isLoading = false,
    maxChapterReached,
}) => {
    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(initialEntityId || null);
    const [selectedRelationship, setSelectedRelationship] = useState<SelectedRelationship | null>(null);
    const navigate = useNavigate();
    const { bookId } = useParams();
    const { t } = useTranslation();

    const effectiveChapter = Math.max(currentChapter, maxChapterReached || 0);

    useEffect(() => {
        if (isOpen && initialEntityId) {
            setSelectedEntityId(initialEntityId);
            setSelectedRelationship(null);
        } else if (isOpen && !initialEntityId) {
            setSelectedEntityId(null);
            setSelectedRelationship(null);
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
                    description: e.description,
                    edge: e
                };
            })
            .filter(r => r.entity);
    }, [selectedEntityId, edges, entities]);

    const handleRelationshipClick = (edge: NetworkEdge, sourceEntity: EntityDetail, targetEntity: EntityDetail) => {
        setSelectedRelationship({ edge, sourceEntity, targetEntity });
    };

    const handleBackFromRelationship = () => {
        setSelectedRelationship(null);
    };

    const handleBackFromProfile = () => {
        if (selectedRelationship) {
            setSelectedRelationship(null);
        } else {
            setSelectedEntityId(null);
        }
    };

    const getBackButtonText = () => {
        if (selectedRelationship) return t('entityDrawer.back_to_profile');
        if (selectedEntityId) return t('entityDrawer.back_to_list');
        return null;
    };

    const getTitle = () => {
        if (selectedRelationship) {
            return `${selectedRelationship.sourceEntity.name} ↔ ${selectedRelationship.targetEntity.name}`;
        }
        return t('entityDrawer.title');
    };

    return (
        <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <Drawer.Portal>
                <Drawer.Overlay className="fixed inset-0 bg-[var(--color-bg-overlay)] backdrop-blur-sm z-50" />
                <Drawer.Content className="bg-[var(--color-bg-base)] flex flex-col rounded-t-[10px] h-[92vh] mt-24 fixed bottom-0 left-0 right-0 md:max-w-xl md:mx-auto z-50 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset border-t border-[var(--color-border-default)] shadow-2xl">
                    <div className="sr-only">
                        <Drawer.Description>
                            {t('entityDrawer.description')}
                        </Drawer.Description>
                    </div>
                    <div className="p-4 bg-[var(--color-bg-base)] rounded-t-[10px] flex-1 flex flex-col h-full">
                        <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-[var(--color-bg-hover)] mb-4" />

                        <div className="flex justify-between items-center mb-4 px-2">
                            {(selectedEntityId || selectedRelationship) ? (
                                <button
                                    onClick={selectedRelationship ? handleBackFromRelationship : handleBackFromProfile}
                                    className="text-[var(--color-link)] text-sm font-medium hover:text-[var(--color-link-hover)]"
                                >
                                    {getBackButtonText()}
                                </button>
                                ) : (
                                    <div className="flex items-center gap-3">
                                        <Drawer.Title className="text-lg font-semibold text-[var(--color-text-default)]">
                                            {getTitle()}
                                        </Drawer.Title>
                                        <button
                                            onClick={() => navigate(`/book/${bookId}/gallery`)}
                                        className="p-1.5 bg-[var(--color-bg-elevated)] rounded-full text-[var(--color-accent-500)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-accent-400)] transition-colors"
                                        title={t('entityDrawer.open_gallery')}
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
                            {selectedRelationship ? (
                                <div className="h-full overflow-auto p-2">
                                    <RelationshipCard
                                        edge={selectedRelationship.edge}
                                        sourceEntity={selectedRelationship.sourceEntity}
                                        targetEntity={selectedRelationship.targetEntity}
                                        currentChapter={effectiveChapter}
                                        currentCFI={currentCFI}
                                        onEntityClick={(id) => {
                                            setSelectedRelationship(null);
                                            setSelectedEntityId(id);
                                        }}
                                    />
                                </div>
                            ) : selectedEntityId && entities[selectedEntityId] ? (
                                <EntityProfile
                                    entity={entities[selectedEntityId]}
                                    relatedEntities={relationships}
                                    onEntityClick={(id) => setSelectedEntityId(id)}
                                    onRelationshipClick={handleRelationshipClick}
                                    currentChapter={effectiveChapter}
                                    currentCFI={currentCFI}
                                />
                            ) : (
                                <EntityList
                                    entities={entities}
                                    currentChapter={effectiveChapter}
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
