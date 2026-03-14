import React, { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { EntityDetail } from '@/types/entity';
import { EntityCard } from './EntityCard';
import { entityTypeLabels } from './entityTypeLabels';
import { EntityListSkeleton } from '@/components/UI/Skeleton';
import { Input } from '@/components/UI/Input';
import { Search, X, BookOpen } from 'lucide-react';

type EntityTypeFilter = 'character' | 'location' | 'object';

const VIRTUALIZATION_THRESHOLD = 30;
const ESTIMATED_ITEM_HEIGHT = 80;
const MAX_STAGGER_ITEMS = 10;

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
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(query) ||
          e.aliases?.some((a) => a.toLowerCase().includes(query))
      );
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
      {/* Search — borderless, only border-bottom */}
      <div className="px-3 py-2">
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
          className="border-0 border-b border-[var(--color-border-subtle)] rounded-none bg-transparent italic placeholder:italic focus:ring-0 focus:ring-offset-0 focus:border-[var(--color-accent-500)]"
        />
      </div>

      {/* Filters — underlined text tabs */}
      <div className="flex gap-4 px-3 pb-2 overflow-x-auto scrollbar-hide">
        {TYPE_FILTERS.map((filter) => (
          <button
            key={filter.type}
            onClick={() => handleTypeFilterChange(filter.type)}
            className={`text-xs uppercase tracking-wider whitespace-nowrap pb-1.5 transition-colors border-b-2 ${
              activeTypeFilter === filter.type
                ? 'text-[var(--color-accent-500)] border-[var(--color-accent-500)] font-medium'
                : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text-default)]'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {filteredEntities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
          <BookOpen className="w-8 h-8 mb-3 text-[var(--color-text-disabled)]" />
          <p className="font-serif italic text-sm">
            {searchQuery || activeTypeFilter !== 'ALL'
              ? t('entities.no_results')
              : t('entities.no_entities')}
          </p>
        </div>
      ) : useVirtualization ? (
        <div ref={parentRef} className="flex-1 overflow-auto px-3" style={{ contain: 'strict' }}>
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
        <div className="flex-1 overflow-auto px-3 pb-20">
          {filteredEntities.map((entity, index) => (
            <div
              key={entity.id}
              className="entity-stagger-item"
              style={{
                animationDelay: `${Math.min(index, MAX_STAGGER_ITEMS) * 50}ms`,
              }}
            >
              <EntityCard
                entity={entity}
                currentChapter={currentChapter}
                currentCFI={currentCFI}
                onClick={() => onEntitySelect(entity.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
