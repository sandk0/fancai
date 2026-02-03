/**
 * ImageFilters - Filter/search controls for the images gallery page
 */

import {
  Search,
  Filter,
  ChevronDown,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Book } from '@/types/api';

type DescriptionType = 'all' | 'location' | 'character' | 'atmosphere';
type SortOption = 'newest' | 'oldest' | 'book';

interface ImageFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedBook: string;
  onBookChange: (bookId: string) => void;
  descriptionType: DescriptionType;
  onDescriptionTypeChange: (type: DescriptionType) => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  books: Book[] | undefined;
  filteredCount: number;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
}

export function ImageFilters({
  searchQuery,
  onSearchChange,
  selectedBook,
  onBookChange,
  descriptionType,
  onDescriptionTypeChange,
  sortBy,
  onSortChange,
  showFilters,
  onToggleFilters,
  books,
  filteredCount,
  hasActiveFilters,
  onResetFilters,
}: ImageFiltersProps) {
  const { t } = useTranslation();

  const descriptionTypes = [
    { value: 'all', label: t('imagesGallery.all_types') },
    { value: 'location', label: t('imagesGallery.stats.locations') },
    { value: 'character', label: t('imagesGallery.stats.characters') },
    { value: 'atmosphere', label: t('imagesGallery.stats.atmosphere') },
  ];

  const sortOptions = [
    { value: 'newest', label: t('imagesGallery.sort_newest') },
    { value: 'oldest', label: t('imagesGallery.sort_oldest') },
    { value: 'book', label: t('imagesGallery.sort_book') },
  ];

  return (
    <>
      {/* Filters and Search */}
      <div className="p-6 rounded-xl border-2 mb-8 bg-background border-border">
        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('imagesGallery.search_placeholder')}
              className="w-full pl-12 pr-4 py-3 min-h-[44px] rounded-xl border-2 bg-muted border-border text-foreground text-base"
            />
          </div>
        </div>

        {/* Filter Toggle Button */}
        <button
          onClick={onToggleFilters}
          className={cn(
            'flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg border-2 transition-all border-border',
            showFilters ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
          )}
        >
          <Filter className="w-4 h-4" />
          <span className="font-medium">{t('imagesGallery.filters')}</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFilters && 'rotate-180')} />
        </button>

        {/* Filters Panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Book Filter */}
              <div>
                <label className="block text-sm font-medium mb-2 text-muted-foreground">
                  {t('imagesGallery.filter_book')}
                </label>
                <select
                  value={selectedBook}
                  onChange={(e) => onBookChange(e.target.value)}
                  className="w-full px-4 py-2 min-h-[44px] rounded-lg border-2 bg-muted border-border text-foreground"
                >
                  <option value="all">{t('imagesGallery.all_books')}</option>
                  {books?.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Type Filter */}
              <div>
                <label className="block text-sm font-medium mb-2 text-muted-foreground">
                  {t('imagesGallery.filter_type')}
                </label>
                <select
                  value={descriptionType}
                  onChange={(e) => onDescriptionTypeChange(e.target.value as DescriptionType)}
                  className="w-full px-4 py-2 min-h-[44px] rounded-lg border-2 bg-muted border-border text-foreground"
                >
                  {descriptionTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sort */}
              <div>
                <label className="block text-sm font-medium mb-2 text-muted-foreground">
                  {t('imagesGallery.sort')}
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => onSortChange(e.target.value as SortOption)}
                  className="w-full px-4 py-2 min-h-[44px] rounded-lg border-2 bg-muted border-border text-foreground"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm font-medium text-muted-foreground">
          {t('imagesGallery.found_count', { count: filteredCount })}
        </p>
        {hasActiveFilters && (
          <button
            onClick={onResetFilters}
            className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors bg-muted text-foreground"
          >
            <X className="w-4 h-4" />
            {t('imagesGallery.reset_filters')}
          </button>
        )}
      </div>
    </>
  );
}
