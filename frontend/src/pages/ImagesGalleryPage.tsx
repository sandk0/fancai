import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Image as ImageIcon,
  Sparkles,
  MapPin,
  User as UserIcon,
} from 'lucide-react';
import { booksAPI } from '@/api/books';
import { imagesAPI } from '@/api/images';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import { PageMeta } from '@/components/SEO/PageMeta';
import { ImageFilters } from '@/components/Images/ImageFilters';
import { ImageGrid, ImageModalOverlay } from '@/components/Images/ImageGrid';
import { ImagePagination } from '@/components/Images/ImagePagination';
import { logger } from '@/lib/logger';
import type { GeneratedImage, Book } from '@/types/api';

const CONCURRENCY_LIMIT = 3;
const IMAGES_PER_PAGE = 24;

type DescriptionType = 'all' | 'location' | 'character' | 'atmosphere';
type SortOption = 'newest' | 'oldest' | 'book';

interface ImageWithBookInfo extends GeneratedImage {
  book_title: string;
  book_id: string;
}

interface LoadingProgress {
  current: number;
  total: number;
  phase: 'idle' | 'loading' | 'complete';
}

async function loadImagesWithLimit(
  books: Book[],
  concurrency: number,
  onProgress: (current: number, total: number) => void
): Promise<ImageWithBookInfo[]> {
  const results: ImageWithBookInfo[] = [];
  const total = books.length;

  for (let i = 0; i < total; i += concurrency) {
    const batch = books.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (book) => {
        try {
          const response = await imagesAPI.getBookImages(book.id, undefined, 0, 100);
          return response.images.map((img) => ({
            ...img,
            book_title: book.title,
            book_id: book.id,
          } as ImageWithBookInfo));
        } catch (error) {
          logger.error(`Failed to fetch images for book ${book.id}:`, error);
          return [];
        }
      })
    );
    results.push(...batchResults.flat());
    onProgress(Math.min(i + concurrency, total), total);
  }

  return results;
}

const ImagesGalleryPage: React.FC = () => {
   const { t } = useTranslation();
   const [searchQuery, setSearchQuery] = useState('');
   const [selectedBook, setSelectedBook] = useState<string>('all');
   const [descriptionType, setDescriptionType] = useState<DescriptionType>('all');
   const [sortBy, setSortBy] = useState<SortOption>('newest');
   const [showFilters, setShowFilters] = useState(false);
   const [selectedImage, setSelectedImage] = useState<ImageWithBookInfo | null>(null);
   const [currentPage, setCurrentPage] = useState(1);
   const [loadingProgress, setLoadingProgress] = useState<LoadingProgress>({
     current: 0,
     total: 0,
     phase: 'idle',
   });

  const progressRef = useRef<LoadingProgress>({ current: 0, total: 0, phase: 'idle' });

  const handleProgress = useCallback((current: number, total: number) => {
    progressRef.current = { current, total, phase: 'loading' };
    setLoadingProgress({ current, total, phase: 'loading' });
  }, []);

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['books'],
    queryFn: () => booksAPI.getBooks({ skip: 0, limit: 100 }),
  });

  const { data: imagesData, isLoading: imagesLoading } = useQuery({
    queryKey: ['all-images', booksData?.books?.map((b) => b.id)],
    queryFn: async () => {
      if (!booksData?.books || booksData.books.length === 0) return [];

      setLoadingProgress({ current: 0, total: booksData.books.length, phase: 'loading' });

      const images = await loadImagesWithLimit(
        booksData.books,
        CONCURRENCY_LIMIT,
        handleProgress
      );

      setLoadingProgress((prev) => ({ ...prev, phase: 'complete' }));
      return images;
    },
    enabled: !!booksData?.books && booksData.books.length > 0,
  });

  const allImages = useMemo(() => imagesData || [], [imagesData]);

   const descriptionTypes = [
     { value: 'all', label: t('imagesGallery.all_types'), icon: Sparkles },
     { value: 'location', label: t('imagesGallery.stats.locations'), icon: MapPin },
     { value: 'character', label: t('imagesGallery.stats.characters'), icon: UserIcon },
     { value: 'atmosphere', label: t('imagesGallery.stats.atmosphere'), icon: Sparkles },
   ];

  const filteredImages = useMemo(() => {
    return allImages
      .filter((img) => {
        if (selectedBook !== 'all' && img.book_id !== selectedBook) return false;
        if (descriptionType !== 'all' && img.description?.type !== descriptionType) return false;
        if (searchQuery && !img.description?.text.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sortBy === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (sortBy === 'book') return a.book_title.localeCompare(b.book_title);
        return 0;
      });
  }, [allImages, selectedBook, descriptionType, searchQuery, sortBy]);

  const totalPages = Math.ceil(filteredImages.length / IMAGES_PER_PAGE);
  const paginatedImages = useMemo(() => {
    const startIndex = (currentPage - 1) * IMAGES_PER_PAGE;
    return filteredImages.slice(startIndex, startIndex + IMAGES_PER_PAGE);
  }, [filteredImages, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBook, descriptionType, searchQuery, sortBy]);

  const isLoading = booksLoading || imagesLoading;

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedImage(null);
    };
    if (selectedImage) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [selectedImage]);

  if (isLoading) {
    const progressPercent = loadingProgress.total > 0
      ? Math.round((loadingProgress.current / loadingProgress.total) * 100)
      : 0;

     return (
       <div className="flex flex-col items-center justify-center min-h-64 gap-4">
         <LoadingSpinner size="lg" text={t('imagesGallery.loading')} />
         {loadingProgress.total > 0 && (
           <div className="w-full max-w-sm space-y-2">
             <p className="text-center text-sm text-muted-foreground">
               {t('imagesGallery.loading_books', { current: loadingProgress.current, total: loadingProgress.total })}
             </p>
             <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
               <div
                 className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                 style={{ width: `${progressPercent}%` }}
               />
             </div>
             <p className="text-center text-xs text-muted-foreground/70">
               {progressPercent}% {t('imagesGallery.completed')}
             </p>
           </div>
         )}
       </div>
     );
  }

  const hasActiveFilters = selectedBook !== 'all' || descriptionType !== 'all' || !!searchQuery;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <PageMeta title={t('imagesGallery.page_title')} description={t('imagesGallery.page_description')} />
       {/* Header */}
       <div className="mb-8">
         <div className="flex items-center gap-3 mb-3">
           <ImageIcon className="w-8 h-8 text-primary" />
           <h1 className="fluid-h2 font-bold text-foreground">
             {t('imagesGallery.title')}
           </h1>
         </div>
         <p className="text-lg text-muted-foreground">
           {t('imagesGallery.subtitle')}
         </p>
       </div>

       {/* Stats */}
       <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
         <div className="p-3 sm:p-4 rounded-xl border-2 bg-background border-border">
           <p className="text-xs sm:text-sm font-medium mb-1 text-muted-foreground">
             {t('imagesGallery.stats.total')}
           </p>
           <p className="text-xl sm:text-2xl font-bold text-foreground">
             {allImages.length}
           </p>
         </div>

         <div className="p-3 sm:p-4 rounded-xl border-2 bg-background border-border">
           <p className="text-xs sm:text-sm font-medium mb-1 text-muted-foreground">
             {t('imagesGallery.stats.locations')}
           </p>
           <p className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">
             {allImages.filter((img) => img.description?.type === 'location').length}
           </p>
         </div>

         <div className="p-3 sm:p-4 rounded-xl border-2 bg-background border-border">
           <p className="text-xs sm:text-sm font-medium mb-1 text-muted-foreground">
             {t('imagesGallery.stats.characters')}
           </p>
           <p className="text-xl sm:text-2xl font-bold text-purple-600 dark:text-purple-400">
             {allImages.filter((img) => img.description?.type === 'character').length}
           </p>
         </div>

         <div className="p-3 sm:p-4 rounded-xl border-2 bg-background border-border">
           <p className="text-xs sm:text-sm font-medium mb-1 text-muted-foreground">
             {t('imagesGallery.stats.atmosphere')}
           </p>
           <p className="text-xl sm:text-2xl font-bold text-amber-600 dark:text-amber-400">
             {allImages.filter((img) => img.description?.type === 'atmosphere').length}
           </p>
         </div>
       </div>

       <ImageFilters
         searchQuery={searchQuery}
         onSearchChange={setSearchQuery}
         selectedBook={selectedBook}
         onBookChange={setSelectedBook}
         descriptionType={descriptionType}
         onDescriptionTypeChange={setDescriptionType}
         sortBy={sortBy}
         onSortChange={setSortBy}
         showFilters={showFilters}
         onToggleFilters={() => setShowFilters(!showFilters)}
         books={booksData?.books}
         filteredCount={filteredImages.length}
         hasActiveFilters={hasActiveFilters}
         onResetFilters={() => {
           setSelectedBook('all');
           setDescriptionType('all');
           setSearchQuery('');
         }}
       />

       <ImageGrid
         images={paginatedImages}
         descriptionTypes={descriptionTypes}
         onImageClick={setSelectedImage}
       />

       {filteredImages.length > 0 && (
         <ImagePagination
           currentPage={currentPage}
           totalPages={totalPages}
           totalItems={filteredImages.length}
           onPageChange={setCurrentPage}
         />
       )}

       {selectedImage && (
         <ImageModalOverlay
           image={selectedImage}
           descriptionTypes={descriptionTypes}
           onClose={() => setSelectedImage(null)}
         />
       )}
    </div>
  );
};

export default ImagesGalleryPage;
