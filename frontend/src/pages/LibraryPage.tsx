import React, { useState, useMemo, useDeferredValue, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'framer-motion';
import {
  Search,
  Filter,
  SortAsc,
  SortDesc,
  Plus,
  X,
  ChevronDown,
  BookOpen,
  Clock,
  CheckCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useBooks, useDeleteBook } from '@/hooks/api/useBooks';
import { bookKeys, getCurrentUserId } from '@/hooks/api/queryKeys';
import { notify } from '@/stores/ui';
import { BookUploadModal } from '@/components/Books/BookUploadModal';
import { BookGrid } from '@/components/Library/BookGrid';
import { DeleteConfirmModal } from '@/components/Library/DeleteConfirmModal';
import { useLibraryFilters } from '@/hooks/library/useLibraryFilters';
import { cn } from '@/lib/utils';
import type { Book } from '@/types/api';
import { PageMeta } from '@/components/SEO/PageMeta';

const BOOKS_PER_PAGE = 24;
const SCROLL_KEY = 'library-scroll';

const LibraryPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Local state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('created_desc');
  const [genreFilter, setGenreFilter] = useState('all');
  const [progressFilter, setProgressFilter] = useState('all');
  const [selectedBookForDelete, setSelectedBookForDelete] = useState<Book | null>(null);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Scroll restoration
  useEffect(() => {
    const savedScroll = sessionStorage.getItem(SCROLL_KEY);
    if (savedScroll) window.scrollTo(0, parseInt(savedScroll, 10));
    return () => { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); };
  }, []);

  // Block body scroll when filters are open
  useEffect(() => {
    if (showFilters) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [showFilters]);

  // Debounce search
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Pull-to-refresh
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef(0);
  const PULL_THRESHOLD = 80;

  // Options memoized with translation
  const sortOptions = useMemo(() => [
    { value: 'created_desc', label: t('library.sort.created_desc'), icon: SortDesc },
    { value: 'created_asc', label: t('library.sort.created_asc'), icon: SortAsc },
    { value: 'title_asc', label: t('library.sort.title_asc'), icon: SortAsc },
    { value: 'title_desc', label: t('library.sort.title_desc'), icon: SortDesc },
    { value: 'author_asc', label: t('library.sort.author_asc'), icon: SortAsc },
    { value: 'accessed_desc', label: t('library.sort.accessed_desc'), icon: Clock },
  ], [t]);

  const genreOptions = useMemo(() => [
    { value: 'all', label: t('library.filter.genres.all') },
    { value: 'fiction', label: t('library.filter.genres.fiction') },
    { value: 'non-fiction', label: t('library.filter.genres.non-fiction') },
    { value: 'fantasy', label: t('library.filter.genres.fantasy') },
    { value: 'sci-fi', label: t('library.filter.genres.sci-fi') },
    { value: 'romance', label: t('library.filter.genres.romance') },
    { value: 'mystery', label: t('library.filter.genres.mystery') },
    { value: 'thriller', label: t('library.filter.genres.thriller') },
  ], [t]);

  const progressOptions = useMemo(() => [
    { value: 'all', label: t('library.filter.progress_opts.all'), icon: BookOpen },
    { value: 'not_started', label: t('library.filter.progress_opts.not_started'), icon: BookOpen },
    { value: 'in_progress', label: t('library.filter.progress_opts.in_progress'), icon: Loader2 },
    { value: 'completed', label: t('library.filter.progress_opts.completed'), icon: CheckCircle },
  ], [t]);

  // Fetch books
  const skip = (currentPage - 1) * BOOKS_PER_PAGE;
  const { data, isLoading, refetch } = useBooks(
    { skip, limit: BOOKS_PER_PAGE, sort_by: sortBy },
    {
      refetchOnMount: 'always',
      refetchInterval: (query) => {
        const books = query.state.data?.books || [];
        return books.some(b => b.is_processing) ? 5000 : false;
      },
    }
  );

  const books = data?.books || [];
  const totalBooks = data?.total || 0;

  // Mutations
  const deleteBookMutation = useDeleteBook({
    onSuccess: () => {
      notify.success(t('library.delete.success'));
      setSelectedBookForDelete(null);
    },
    onError: (err) => {
      notify.error(t('library.delete.error'), err instanceof Error ? err.message : '');
    },
  });

  // Filter logic
  const { filteredBooks, stats } = useLibraryFilters(books, deferredSearchQuery);
  
  const displayBooks = useMemo(() => {
    let result = filteredBooks;
    if (genreFilter !== 'all') {
      result = result.filter(b => b.genre?.toLowerCase().includes(genreFilter.toLowerCase()));
    }
    if (progressFilter !== 'all') {
      result = result.filter(b => {
        const p = b.reading_progress_percent ?? 0;
        if (progressFilter === 'not_started') return p === 0;
        if (progressFilter === 'in_progress') return p > 0 && p < 100;
        if (progressFilter === 'completed') return p >= 100;
        return true;
      });
    }
    return result;
  }, [filteredBooks, genreFilter, progressFilter]);

  const totalPages = Math.ceil(totalBooks / BOOKS_PER_PAGE);
  const activeFiltersCount = (genreFilter !== 'all' ? 1 : 0) + (progressFilter !== 'all' ? 1 : 0);

  // Handlers
  const handleUploadClick = () => setShowUploadModal(true);
  const handleBookClick = (id: string) => {
    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    navigate(`/book/${id}`);
  };
  const handleClearSearch = () => setSearchQuery('');
  const handleSortChange = (val: string) => {
    setSortBy(val);
    setCurrentPage(1);
    setShowSortDropdown(false);
  };
  const handleClearFilters = () => {
    setGenreFilter('all');
    setProgressFilter('all');
  };

  const handleDeleteClick = (id: string) => {
    const b = books.find(x => x.id === id);
    if (b) setSelectedBookForDelete(b);
  };

  // Pull refresh handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0 && !isRefreshing) startY.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (window.scrollY === 0 && startY.current > 0 && !isRefreshing) {
      const diff = e.touches[0].clientY - startY.current;
      if (diff > 0) {
        setPullDistance(Math.min(diff * 0.5, PULL_THRESHOLD * 1.5));
        setIsPulling(true);
        if (diff > 10) e.preventDefault();
      }
    }
  };
  const handleTouchEnd = async () => {
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await refetch();
        notify.success(t('library.refresh.success'));
      } catch {
        notify.error(t('library.refresh.error'));
      } finally {
        setIsRefreshing(false);
      }
    }
    setPullDistance(0);
    setIsPulling(false);
    startY.current = 0;
  };

  const currentSortOption = sortOptions.find(o => o.value === sortBy);

  return (
    <div className="min-h-screen bg-background" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <PageMeta title={t('library.page_title')} description={t('library.page_description')} />
      <AnimatePresence>
        {(isPulling || isRefreshing) && (
          <m.div className="fixed top-0 left-0 right-0 flex justify-center items-center z-50 pt-safe pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ transform: `translateY(${isRefreshing ? 40 : pullDistance - 40}px)` }}>
            <div className={cn("w-10 h-10 rounded-full border-2 border-primary flex items-center justify-center bg-background shadow-lg", (pullDistance >= PULL_THRESHOLD || isRefreshing) && 'bg-primary/10')}>
              <RefreshCw className={cn("w-5 h-5 text-primary", isRefreshing && 'animate-spin', !isRefreshing && pullDistance >= PULL_THRESHOLD && 'rotate-180')} />
            </div>
          </m.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-4 lg:py-6 pb-24 md:pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-3 sm:mb-4 md:mb-6">
          <div>
            <h1 className="fluid-h2 font-bold text-foreground">{t('library.title')}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {t(`library.books_count_${totalBooks === 1 ? 'one' : totalBooks >= 2 && totalBooks <= 4 ? 'few' : 'many'}`, { count: totalBooks })}
              {stats.processingBooks > 0 && <span className="ml-2 text-amber-600 text-xs">{t('library.processing', { count: stats.processingBooks })}</span>}
            </p>
          </div>
          <m.button className="hidden md:flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-primary text-primary-foreground shadow-lg" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleUploadClick}>
            <Plus className="w-5 h-5" />
            <span>{t('library.upload')}</span>
          </m.button>
        </div>

        <div className="flex flex-col gap-3 mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t('library.search_placeholder')} className="w-full pl-12 pr-10 py-3 rounded-xl border-2 border-border bg-card text-foreground" />
            {searchQuery && <button onClick={handleClearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-muted"><X className="w-4 h-4 text-muted-foreground" /></button>}
          </div>

          <div className="flex gap-3">
            <div className="relative flex-1 sm:flex-initial">
              <button onClick={() => setShowSortDropdown(!showSortDropdown)} className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground w-full sm:w-auto sm:min-w-[160px]">
                {currentSortOption && <currentSortOption.icon className="w-4 h-4 text-muted-foreground" />}
                <span className="flex-1 text-left text-sm">{currentSortOption?.label || t('library.sort.label')}</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform", showSortDropdown && 'rotate-180')} />
              </button>
              <AnimatePresence>
                {showSortDropdown && (
                  <>
                    <m.div className="fixed inset-0 z-40" onClick={() => setShowSortDropdown(false)} />
                    <m.div className="absolute top-full mt-2 right-0 w-48 bg-card border border-border rounded-xl shadow-xl z-[100]" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                      {sortOptions.map(o => (
                        <button key={o.value} onClick={() => handleSortChange(o.value)} className={cn("w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted", sortBy === o.value && "bg-primary/10 text-primary")}>
                          <o.icon className="w-4 h-4" />
                          <span>{o.label}</span>
                        </button>
                      ))}
                    </m.div>
                  </>
                )}
              </AnimatePresence>
            </div>
            <button onClick={() => setShowFilters(!showFilters)} className={cn("flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-colors", showFilters || activeFiltersCount > 0 ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border')}>
              <Filter className="w-5 h-5" />
              <span className="hidden sm:inline">{t('library.filter.toggle')}</span>
              {activeFiltersCount > 0 && <span className="ml-1 px-2 py-0.5 rounded-full bg-primary-foreground/20 text-xs font-semibold">{activeFiltersCount}</span>}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showFilters && (
            <m.div className="mb-6 p-4 sm:p-6 rounded-xl border-2 border-border bg-card" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <div className="flex flex-col sm:flex-row gap-6">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-2">{t('library.filter.genre')}</label>
                  <select value={genreFilter} onChange={e => setGenreFilter(e.target.value)} className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background">
                    {genreOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-2">{t('library.filter.progress')}</label>
                  <div className="grid grid-cols-2 sm:flex gap-2">
                    {progressOptions.map(o => (
                      <button key={o.value} onClick={() => setProgressFilter(o.value)} className={cn("flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm", progressFilter === o.value ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                        <o.icon className="w-4 h-4" />
                        <span>{o.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {activeFiltersCount > 0 && <div className="mt-4 pt-4 border-t border-border"><button onClick={handleClearFilters} className="text-sm text-primary font-medium">{t('library.filter.reset')}</button></div>}
            </m.div>
          )}
        </AnimatePresence>

        <BookGrid books={displayBooks} isLoading={isLoading && books.length === 0} searchQuery={searchQuery} onBookClick={handleBookClick} onClearSearch={handleClearSearch} onUploadClick={handleUploadClick} onParsingComplete={() => queryClient.invalidateQueries({ queryKey: bookKeys.all(getCurrentUserId()) })} onDelete={handleDeleteClick} />

        {totalPages > 1 && displayBooks.length > 0 && (
          <div className="flex justify-center items-center gap-2 mt-8">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-4 py-2 rounded-lg border bg-card disabled:opacity-50">{t('library.pagination.prev')}</button>
            <span className="px-4 py-2 text-muted-foreground">{t('library.pagination.page', { current: currentPage, total: totalPages })}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-4 py-2 rounded-lg border bg-card disabled:opacity-50">{t('library.pagination.next')}</button>
          </div>
        )}
      </div>

      <m.button className="fixed bottom-[72px] right-4 md:hidden w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center z-30" whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={handleUploadClick} aria-label={t('library.upload')}><Plus className="w-6 h-6" /></m.button>
      <BookUploadModal isOpen={showUploadModal} onClose={() => setShowUploadModal(false)} onUploadSuccess={() => setCurrentPage(1)} />
      <DeleteConfirmModal isOpen={!!selectedBookForDelete} bookTitle={selectedBookForDelete?.title || ''} isDeleting={deleteBookMutation.isPending} onConfirm={() => deleteBookMutation.mutate(selectedBookForDelete!.id)} onCancel={() => setSelectedBookForDelete(null)} />
    </div>
  );
};

export default LibraryPage;
