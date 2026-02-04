import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { BookCard } from './BookCard';
import { Skeleton } from '@/components/UI/Skeleton';
import { useColumns } from '@/hooks/useColumns';
import type { Book as BookType } from '@/types/api';

interface BookGridProps {
  books: BookType[];
  isLoading?: boolean;
  searchQuery?: string;
  onBookClick: (bookId: string) => void;
  onClearSearch?: () => void;
  onUploadClick?: () => void;
  onParsingComplete?: () => void;
  onDelete?: (bookId: string) => void;
}

const BookCardSkeleton = memo(() => (
  <div className="animate-pulse">
    <Skeleton variant="rectangular" className="aspect-[2/3] w-full rounded-xl" />
    <div className="mt-3 px-1"><Skeleton variant="text" className="h-4 w-3/4 mb-2" /><Skeleton variant="text" className="h-3 w-1/2" /></div>
  </div>
));

export const BookGrid = memo(function BookGrid({
  books, isLoading = false, searchQuery, onBookClick, onClearSearch, onUploadClick, onParsingComplete, onDelete,
}: BookGridProps) {
  const { t } = useTranslation();
  const columns = useColumns();
  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    if (parentRef.current) {
      setScrollMargin(parentRef.current.offsetTop);
    }
  }, []);

  const rows = useMemo(() => {
    const result = [];
    for (let i = 0; i < books.length; i += columns) {
      result.push(books.slice(i, i + columns));
    }
    return result;
  }, [books, columns]);

  const rowVirtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 450,
    overscan: 2,
    scrollMargin,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 lg:gap-5">
        {Array.from({ length: 12 }).map((_, i) => <BookCardSkeleton key={i} />)}
      </div>
    );
  }

  if (books.length === 0 && searchQuery) {
    return (
      <div className="text-center py-16 px-4">
        <h3 className="text-xl font-bold mb-2">{t('library.empty.search_title')}</h3>
        <p className="opacity-70 mb-6">{t('library.empty.search_desc', { query: searchQuery })}</p>
        {onClearSearch && <button onClick={onClearSearch} className="px-6 py-3 bg-primary text-white rounded-xl">{t('library.empty.clear_search')}</button>}
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <h3 className="text-xl font-bold mb-2">{t('library.empty.title')}</h3>
        <p className="opacity-70 mb-6">{t('library.empty.description')}</p>
        {onUploadClick && <button onClick={onUploadClick} className="px-6 py-3 bg-primary text-white rounded-xl flex items-center gap-2 mx-auto"><Plus className="w-5 h-5" />{t('library.upload')}</button>}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="w-full relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => (
        <div
          key={virtualRow.key}
          className="absolute top-0 left-0 w-full grid gap-3 sm:gap-4 lg:gap-5"
          style={{
            height: `${virtualRow.size}px`,
            transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
          }}
        >
          {rows[virtualRow.index].map((book) => (
            <BookCard key={book.id} book={book} onClick={() => onBookClick(book.id)} onParsingComplete={onParsingComplete} onDelete={onDelete} />
          ))}
        </div>
      ))}
    </div>
  );
});
