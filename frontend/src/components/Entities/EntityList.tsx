import React, { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { EntityDetail } from '../../types/entity';
import { EntityCard } from './EntityCard';
import { entityTypeLabels } from './entityTypeLabels';
import { EntityListSkeleton } from '../UI/Skeleton';
import { Input } from '../UI/Input';
import { Search, X } from 'lucide-react';

type EntityTypeFilter = 'character' | 'location' | 'object';

const VIRTUALIZATION_THRESHOLD = 30;
const ESTIMATED_ITEM_HEIGHT = 72;

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
    const { t } = useTranslation();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTypeFilter, setActiveTypeFilter] = useState<EntityTypeFilter | 'ALL'>('ALL');
    const parentRef = useRef<HTMLDivElement>(null);

    const TYPE_FILTERS: { type: EntityTypeFilter | 'ALL'; label: string }[] = [
        { type: 'ALL', label: t('entities.filter_all') },
        { type: 'character', label: entityTypeLabels.character },
        { type: 'location', label: entityTypeLabels.location },
        { type: 'object', label: entityTypeLabels.object },
    ];

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

    const useVirtualization = filteredEntities.length > VIRTUALIZATION_THRESHOLD;

    const virtualizer = useVirtualizer({
        count: filteredEntities.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ESTIMATED_ITEM_HEIGHT,
        overscan: 5,
        enabled: useVirtualization,
    });

    const clearSearch = () => {
        setSearchQuery('');
    };

    const handleTypeFilterChange = (type: EntityTypeFilter | 'ALL') => {
        setActiveTypeFilter(type);
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    };

    if (isLoading) {
        return <EntityListSkeleton count={6} className="pt-2" />;
    }

    return (
        <div className="flex flex-col h-full">
            <div className="px-2 pb-3">
                <Input
                    inputSize="sm"
                    placeholder={t('entities.search_placeholder')}
                    value={searchQuery}
                    onChange={handleSearchChange}
                    leftIcon={<Search className="w-4 h-4" />}
                    rightIcon={
                        searchQuery ? (
                            <button
                                onClick={clearSearch}
                                className="p-0.5 hover:bg-[var(--color-bg-hover)] rounded-sm transition-colors"
                                aria-label={t('entities.clear_search')}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        ) : undefined
                    }
                    className="bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)]"
                />
            </div>

            <div className="flex gap-2 px-2 pb-3 overflow-x-auto scrollbar-hide">
                {TYPE_FILTERS.map((filter) => (
                    <button
                        key={filter.type}
                        onClick={() => handleTypeFilterChange(filter.type)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors
                            ${activeTypeFilter === filter.type
                                ? 'bg-[var(--color-info-muted)] text-[var(--color-info)] border border-[var(--color-info)]/30'
                                : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] border border-transparent hover:bg-[var(--color-bg-hover)]'
                            }`}
                    >
                        {filter.label}
                    </button>
                ))}
            </div>

            {filteredEntities.length === 0 ? (
                <div className="text-center py-10 text-[var(--color-text-muted)]">
                    {searchQuery || activeTypeFilter !== 'ALL'
                        ? t('entities.no_results')
                        : t('entities.no_entities')
                    }
                </div>
            ) : useVirtualization ? (
                <div
                    ref={parentRef}
                    className="flex-1 overflow-auto px-2"
                    style={{ contain: 'strict' }}
                >
                    <div
                        style={{
                            height: `${virtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const entity = filteredEntities[virtualRow.index];
                            return (
                                <div
                                    key={entity.id}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <EntityCard
                                        entity={entity}
                                        currentChapter={currentChapter}
                                        currentCFI={currentCFI}
                                        onClick={() => onEntitySelect(entity.id)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-auto px-2 pb-20">
                    <div className="space-y-2">
                        {filteredEntities.map((entity) => (
                            <EntityCard
                                key={entity.id}
                                entity={entity}
                                currentChapter={currentChapter}
                                currentCFI={currentCFI}
                                onClick={() => onEntitySelect(entity.id)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
