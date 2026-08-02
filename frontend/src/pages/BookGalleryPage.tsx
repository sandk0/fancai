import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { ArrowLeft, Users, Lock } from 'lucide-react';
import { useEntityNetwork } from '@/hooks/useEntityNetwork';
import { booksAPI } from '@/api/books';
import { isEntityMetCFI } from '@/utils/entityUtils';
import { EntityType } from '@/types/entity';
import { ScrollArea } from '@/components/UI/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/UI/avatar';
import { Drawer } from 'vaul';
import { EntityProfile } from '@/components/Entities/EntityProfile';
import { PageMeta } from '@/components/SEO/PageMeta';
import { logger } from '@/lib/logger';

const BookGalleryPage: React.FC = () => {
     const { t } = useTranslation();
     const { bookId } = useParams<{ bookId: string }>();
     const navigate = useNavigate();

    // Track reading progress for spoiler protection (CFI-based for accuracy)
    const [currentChapter, setCurrentChapter] = useState<number>(0);
    const [currentCFI, setCurrentCFI] = useState<string | null>(null);

    useEffect(() => {
        if (bookId) {
            booksAPI.getReadingProgress(bookId)
                .then(res => {
                    setCurrentChapter(res.progress?.current_chapter || 0);
                    setCurrentCFI(res.progress?.reading_location_cfi || null);
                })
                .catch(err => logger.error("Failed to load progress for gallery:", err));
        }
    }, [bookId]);

     const { data: network, isLoading } = useEntityNetwork(bookId!, currentChapter);

    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<EntityType | 'ALL'>('ALL');

    const entities = useMemo(() => {
        if (!network?.entities) return [];
        return Object.values(network.entities).sort((a, b) => (b.importance || 0) - (a.importance || 0));
    }, [network]);

    const filteredEntities = useMemo(() => {
        return entities.filter(e => filterType === 'ALL' || e.type === filterType);
    }, [entities, filterType]);

    const stats = useMemo(() => ({
        total: entities.length,
        characters: entities.filter(e => e.type === 'character').length,
        locations: entities.filter(e => e.type === 'location').length,
    }), [entities]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-default)]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-accent-500)]"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-default)] flex flex-col">
            <PageMeta title={t('bookGallery.page_title')} description={t('bookGallery.page_description')} />
            {/* Header */}
            <header className="sticky top-0 z-10 bg-[var(--color-bg-base)]/80 backdrop-blur-md border-b border-[var(--color-border-default)] p-4">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate(-1)}
                            className="p-2 hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
                        >
                            <ArrowLeft className="w-6 h-6" />
                        </button>
                        <h1 className="text-xl font-serif font-bold tracking-wide flex items-center gap-2">
                            <Users className="w-5 h-5 text-[var(--color-info)]" />
                            {t('gallery.title')}
                        </h1>
                    </div>

                    <div className="text-sm text-[var(--color-text-muted)]">
                         {t('gallery.entities_count', { count: stats.total })}
                     </div>
                </div>
            </header>

            {/* Filters */}
            <div className="p-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] overflow-x-auto">
                <div className="max-w-7xl mx-auto flex gap-2">
                    <FilterBadge
                         active={filterType === 'ALL'}
                         onClick={() => setFilterType('ALL')}
                         label={t('gallery.filter_all')}
                         count={stats.total}
                     />
                     <FilterBadge
                         active={filterType === 'character'}
                         onClick={() => setFilterType('character')}
                         label={t('gallery.filter_characters')}
                         count={stats.characters}
                     />
                     <FilterBadge
                         active={filterType === 'location'}
                         onClick={() => setFilterType('location')}
                         label={t('gallery.filter_locations')}
                         count={stats.locations}
                     />
                </div>
            </div>

            {/* Grid */}
            <ScrollArea className="flex-1">
                <div className="p-6 max-w-7xl mx-auto">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {filteredEntities.map((entity) => {
                            const isMet = isEntityMetCFI(entity, currentCFI, currentChapter);

                            return (
                                <motion.div
                                    key={entity.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    whileHover={{ scale: 1.02 }}
                                    onClick={() => isMet && setSelectedEntityId(entity.id)}
                                    className={`group relative bg-[var(--color-bg-elevated)] rounded-xl overflow-hidden cursor-pointer border border-[var(--color-border-subtle)] transition-all aspect-[3/4]
                                        ${isMet ? 'hover:border-[var(--color-info)]/50' : 'opacity-70 hover:opacity-100'}`}
                                >
                                    {/* Main Image using Avatar component for consistency */}
                                    <Avatar className="absolute inset-0 w-full h-full rounded-none">
                                        <AvatarImage
                                            src={entity.avatar_url || undefined}
                                            alt={entity.name}
                                            className={`object-cover w-full h-full transition-transform duration-700 aspect-auto
                                                ${isMet ? 'group-hover:scale-110' : 'grayscale brightness-[0.2] blur-[2px]'}`}
                                        />
                                        <AvatarFallback className="w-full h-full rounded-none bg-gradient-to-br from-[var(--color-info)]/20 to-[var(--color-accent-500)]/20 flex items-center justify-center">
                                            <span className="text-4xl font-serif text-[var(--color-text-disabled)]">{entity.name[0]}</span>
                                        </AvatarFallback>
                                    </Avatar>

                                    {/* Spoiler Overlay */}
                                    {!isMet && (
                                        <div className="absolute inset-0 flex items-center justify-center z-10">
                                            <Lock className="w-8 h-8 text-[var(--color-text-disabled)]" />
                                        </div>
                                    )}

                                    {/* Gradient Overlay */}
                                    <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[var(--color-bg-base)] via-[var(--color-bg-base)]/60 to-transparent pointer-events-none" />

                                    {/* Content */}
                                    <div className="absolute bottom-0 left-0 p-4 w-full">
                                        <div className="flex justify-between items-end">
                                            <h3 className={`text-lg font-bold font-serif leading-tight mb-1 transition-colors ${isMet ? 'group-hover:text-[var(--color-info)]' : 'text-[var(--color-text-subtle)]'}`}>
                                                {entity.name}
                                            </h3>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] uppercase tracking-widest">
                                            <span>{entity.type}</span>
                                            {entity.importance > 7 && <span className="text-[var(--color-warning)]">★</span>}
                                        </div>
                                    </div>
                                </motion.div>
                            )
                        })}
                    </div>

                    {filteredEntities.length === 0 && (
                         <div className="text-center py-20 text-[var(--color-text-subtle)]">
                             {t('gallery.no_results')}
                         </div>
                     )}
                </div>
            </ScrollArea>

            {/* Detail Drawer - Reusing EntityProfile logic */}
            <Drawer.Root open={!!selectedEntityId} onOpenChange={(open) => !open && setSelectedEntityId(null)}>
                <Drawer.Portal>
                    <Drawer.Overlay className="fixed inset-0 bg-[var(--color-bg-overlay)] backdrop-blur-sm z-50" />
                    <Drawer.Content className="bg-[var(--color-bg-base)] flex flex-col rounded-t-[20px] h-[90vh] mt-24 fixed bottom-0 left-0 right-0 z-50 outline-hidden border-t border-[var(--color-border-default)]">
                        <div className="flex-1 relative rounded-t-[20px] overflow-hidden bg-[var(--color-bg-base)]">
                            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-[var(--color-text-disabled)] rounded-full z-20" />
                            {selectedEntityId && network && network.entities[selectedEntityId] && (
                                <EntityProfile
                                    entity={network.entities[selectedEntityId]}
                                    currentChapter={currentChapter} // Pass actual progress
                                    // Compute relations on the fly or strict them out? EntityProfile needs valid relations list.
                                    // For gallery we can just pass empty relations or compute them if we have edges.
                                    // network.edges exists. We should compute them.
                                    relatedEntities={network.edges ? network.edges
                                        .filter(e => e.source === selectedEntityId || e.target === selectedEntityId)
                                        .map(e => {
                                            const otherId = e.source === selectedEntityId ? e.target : e.source;
                                            return {
                                                entity: network.entities[otherId],
                                                type: e.type,
                                                description: e.description
                                            };
                                        })
                                        .filter(r => r.entity) : []
                                    }
                                    onEntityClick={(id) => setSelectedEntityId(id)}
                                />
                            )}
                        </div>
                    </Drawer.Content>
                </Drawer.Portal>
            </Drawer.Root>
        </div>
    );
};

const FilterBadge: React.FC<{ active: boolean, onClick: () => void, label: string, count: number }> = ({ active, onClick, label, count }) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${active
            ? 'bg-[var(--color-info)] text-[var(--color-bg-base)] shadow-lg shadow-[var(--color-info)]/20'
            : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-default)]'
            }`}
    >
        {label} <span className="opacity-50 ml-1 text-xs">{count}</span>
    </button>
);

export default BookGalleryPage;
