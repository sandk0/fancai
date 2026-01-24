import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Users, Lock } from 'lucide-react';
import { useEntityNetwork } from '@/hooks/useEntityNetwork';
import { booksAPI } from '@/api/books';
import { isEntityMet } from '@/utils/entityUtils';
import { EntityType } from '@/types/entity';
import { ScrollArea } from '@/components/UI/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/UI/avatar';
import { Drawer } from 'vaul';
import { EntityProfile } from '@/components/Entities/EntityProfile';

const BookGalleryPage: React.FC = () => {
    const { bookId } = useParams<{ bookId: string }>();
    const navigate = useNavigate();
    const { data: network, isLoading } = useEntityNetwork(bookId!);

    // Track reading progress for spoiler protection
    const [currentChapter, setCurrentChapter] = useState<number>(0);

    useEffect(() => {
        if (bookId) {
            booksAPI.getReadingProgress(bookId)
                .then(res => {
                    // If progress exists, use it. If not started, 0.
                    setCurrentChapter(res.progress?.current_chapter || 0);
                })
                .catch(err => console.error("Failed to load progress for gallery:", err));
        }
    }, [bookId]);

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
            <div className="flex items-center justify-center min-h-screen bg-black text-white">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-10 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/10 p-4">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate(-1)}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                        >
                            <ArrowLeft className="w-6 h-6" />
                        </button>
                        <h1 className="text-xl font-serif font-bold tracking-wide flex items-center gap-2">
                            <Users className="w-5 h-5 text-purple-400" />
                            Галерея Персонажей
                        </h1>
                    </div>

                    <div className="text-sm text-gray-400">
                        {stats.total} сущностей
                    </div>
                </div>
            </header>

            {/* Filters */}
            <div className="p-4 border-b border-white/5 bg-white/5 overflow-x-auto">
                <div className="max-w-7xl mx-auto flex gap-2">
                    <FilterBadge
                        active={filterType === 'ALL'}
                        onClick={() => setFilterType('ALL')}
                        label="Все"
                        count={stats.total}
                    />
                    <FilterBadge
                        active={filterType === 'character'}
                        onClick={() => setFilterType('character')}
                        label="Персонажи"
                        count={stats.characters}
                    />
                    <FilterBadge
                        active={filterType === 'location'}
                        onClick={() => setFilterType('location')}
                        label="Локации"
                        count={stats.locations}
                    />
                </div>
            </div>

            {/* Grid */}
            <ScrollArea className="flex-1">
                <div className="p-6 max-w-7xl mx-auto">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {filteredEntities.map((entity) => {
                            const isMet = isEntityMet(entity, currentChapter);

                            return (
                                <motion.div
                                    key={entity.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    whileHover={{ scale: 1.02 }}
                                    onClick={() => isMet && setSelectedEntityId(entity.id)}
                                    className={`group relative bg-white/5 rounded-xl overflow-hidden cursor-pointer border border-white/5 transition-all aspect-[3/4]
                                        ${isMet ? 'hover:border-purple-500/50' : 'opacity-70 hover:opacity-100'}`}
                                >
                                    {/* Main Image using Avatar component for consistency */}
                                    <Avatar className="absolute inset-0 w-full h-full rounded-none">
                                        <AvatarImage
                                            src={entity.avatar_url || undefined}
                                            alt={entity.name}
                                            className={`object-cover w-full h-full transition-transform duration-700 aspect-auto
                                                ${isMet ? 'group-hover:scale-110' : 'grayscale brightness-[0.2] blur-[2px]'}`}
                                        />
                                        <AvatarFallback className="w-full h-full rounded-none bg-gradient-to-br from-purple-900/20 to-blue-900/20 flex items-center justify-center">
                                            <span className="text-4xl font-serif text-white/20">{entity.name[0]}</span>
                                        </AvatarFallback>
                                    </Avatar>

                                    {/* Spoiler Overlay */}
                                    {!isMet && (
                                        <div className="absolute inset-0 flex items-center justify-center z-10">
                                            <Lock className="w-8 h-8 text-white/50" />
                                        </div>
                                    )}

                                    {/* Gradient Overlay */}
                                    <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none" />

                                    {/* Content */}
                                    <div className="absolute bottom-0 left-0 p-4 w-full">
                                        <div className="flex justify-between items-end">
                                            <h3 className={`text-lg font-bold font-serif leading-tight mb-1 transition-colors ${isMet ? 'group-hover:text-purple-300' : 'text-gray-500'}`}>
                                                {entity.name}
                                            </h3>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-widest">
                                            <span>{entity.type}</span>
                                            {entity.importance > 7 && <span className="text-yellow-500">★</span>}
                                        </div>
                                    </div>
                                </motion.div>
                            )
                        })}
                    </div>

                    {filteredEntities.length === 0 && (
                        <div className="text-center py-20 text-gray-500">
                            Ничего не найдено.
                        </div>
                    )}
                </div>
            </ScrollArea>

            {/* Detail Drawer - Reusing EntityProfile logic */}
            <Drawer.Root open={!!selectedEntityId} onOpenChange={(open) => !open && setSelectedEntityId(null)}>
                <Drawer.Portal>
                    <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
                    <Drawer.Content className="bg-[#0a0a0a] flex flex-col rounded-t-[20px] h-[90vh] mt-24 fixed bottom-0 left-0 right-0 z-50 outline-none border-t border-white/10">
                        <div className="flex-1 relative rounded-t-[20px] overflow-hidden bg-[#0a0a0a]">
                            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-white/20 rounded-full z-20" />
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
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${active
            ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20'
            : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
    >
        {label} <span className="opacity-50 ml-1 text-xs">{count}</span>
    </button>
);

export default BookGalleryPage;
