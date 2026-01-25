import React, { useState, useMemo } from 'react';
import { EntityDetail } from '../../types/entity';
import { EntityCard, entityTypeLabels } from './EntityCard';
import { EntityListSkeleton } from '../UI/Skeleton';
import { ScrollArea } from '../UI/scroll-area';
import { Input } from '../UI/Input';
import { Search, X, ChevronDown } from 'lucide-react';

type EntityType = 'CHARACTER' | 'LOCATION' | 'OBJECT';

const INITIAL_VISIBLE_COUNT = 20;
const LOAD_MORE_COUNT = 20;

const TYPE_FILTERS: { type: EntityType | 'ALL'; label: string }[] = [
    { type: 'ALL', label: 'Все' },
    { type: 'CHARACTER', label: entityTypeLabels.CHARACTER },
    { type: 'LOCATION', label: entityTypeLabels.LOCATION },
    { type: 'OBJECT', label: entityTypeLabels.OBJECT },
];

interface EntityListProps {
    entities: Record<string, EntityDetail>;
    currentChapter: number;
    currentCFI?: string | null;
    onEntitySelect: (id: string) => void;
    isLoading?: boolean;
}

export const EntityList: React.FC<EntityListProps> = ({
    entities,
    currentChapter,
    currentCFI,
    onEntitySelect,
    isLoading = false,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTypeFilter, setActiveTypeFilter] = useState<EntityType | 'ALL'>('ALL');
    const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

    const filteredEntities = useMemo(() => {
        let result = Object.values(entities).sort((a, b) => (b.importance || 0) - (a.importance || 0));

        if (activeTypeFilter !== 'ALL') {
            result = result.filter((e) => e.type === activeTypeFilter);
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            result = result.filter((e) => e.name.toLowerCase().includes(query));
        }

        return result;
    }, [entities, activeTypeFilter, searchQuery]);

    const visibleEntities = useMemo(() => {
        return filteredEntities.slice(0, visibleCount);
    }, [filteredEntities, visibleCount]);

    const hasMore = filteredEntities.length > visibleCount;

    const loadMore = () => {
        setVisibleCount((prev) => prev + LOAD_MORE_COUNT);
    };

    const clearSearch = () => {
        setSearchQuery('');
        setVisibleCount(INITIAL_VISIBLE_COUNT);
    };

    const handleTypeFilterChange = (type: EntityType | 'ALL') => {
        setActiveTypeFilter(type);
        setVisibleCount(INITIAL_VISIBLE_COUNT);
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
        setVisibleCount(INITIAL_VISIBLE_COUNT);
    };

    if (isLoading) {
        return <EntityListSkeleton count={6} className="pt-2" />;
    }

    return (
        <div className="flex flex-col h-full">
            <div className="px-2 pb-3">
                <Input
                    inputSize="sm"
                    placeholder="Поиск..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    leftIcon={<Search className="w-4 h-4" />}
                    rightIcon={
                        searchQuery ? (
                            <button
                                onClick={clearSearch}
                                className="p-0.5 hover:bg-white/10 rounded transition-colors"
                                aria-label="Очистить поиск"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        ) : undefined
                    }
                    className="bg-[var(--color-bg-elevated,#1a1a1a)] border-[var(--color-border-subtle,white/5)]"
                />
            </div>

            <div className="flex gap-2 px-2 pb-3 overflow-x-auto scrollbar-hide">
                {TYPE_FILTERS.map((filter) => (
                    <button
                        key={filter.type}
                        onClick={() => handleTypeFilterChange(filter.type)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors
                            ${activeTypeFilter === filter.type
                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                : 'bg-[var(--color-bg-elevated,white/5)] text-[var(--color-text-muted,#94a3b8)] border border-transparent hover:bg-[var(--color-bg-hover,white/10)]'
                            }`}
                    >
                        {filter.label}
                    </button>
                ))}
            </div>

            <ScrollArea className="flex-1">
                <div className="space-y-2 pb-20 px-2">
                    {visibleEntities.map((entity) => (
                        <EntityCard
                            key={entity.id}
                            entity={entity}
                            currentChapter={currentChapter}
                            currentCFI={currentCFI}
                            onClick={() => onEntitySelect(entity.id)}
                        />
                    ))}

                    {hasMore && (
                        <button
                            onClick={loadMore}
                            className="w-full py-3 mt-2 flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted,#94a3b8)] hover:text-[var(--color-text-default)] bg-[var(--color-bg-elevated,white/5)] hover:bg-[var(--color-bg-hover,white/10)] rounded-lg transition-colors"
                        >
                            <ChevronDown className="w-4 h-4" />
                            Показать ещё ({filteredEntities.length - visibleCount})
                        </button>
                    )}

                    {filteredEntities.length === 0 && (
                        <div className="text-center py-10 text-[var(--color-text-muted,#64748b)]">
                            {searchQuery || activeTypeFilter !== 'ALL'
                                ? 'Ничего не найдено'
                                : 'Персонажи не найдены'
                            }
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};
