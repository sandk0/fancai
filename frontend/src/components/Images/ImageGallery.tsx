import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Download, Share2, Image, Filter, Grid, List } from 'lucide-react';
import { m, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { imagesAPI } from '@/api/images';
import { notify } from '@/stores/ui';
import { ImageModal } from './ImageModal';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import ErrorMessage from '@/components/UI/ErrorMessage';
import { LazyImage } from '@/components/UI/LazyImage';
import { downloadWithAuth } from '@/utils/fetchWithTokenRefresh';
import { cn } from '@/utils/cn';
import type { GeneratedImage } from '@/types/api';
import { logger } from '@/lib/logger';

interface ImageGalleryProps {
  bookId: string;
  chapterNumber?: number;
  className?: string;
}

type ViewMode = 'grid' | 'list';
type FilterType = 'all' | 'location' | 'character' | 'atmosphere' | 'object' | 'action';

export const ImageGallery: React.FC<ImageGalleryProps> = ({
  bookId,
  chapterNumber,
  className = '',
}) => {
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { t } = useTranslation();

  // Fetch images for the book
  const {
    data: imagesResponse,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['book-images', bookId, chapterNumber],
    queryFn: () => imagesAPI.getBookImages(bookId, chapterNumber),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const images = React.useMemo(() => imagesResponse?.images || [], [imagesResponse?.images]);

  // Filter images based on search and filter criteria
  const filteredImages = React.useMemo(() => {
    let filtered = images;

    // Apply filter by description type
    if (filter !== 'all') {
      filtered = filtered.filter((img) => img.description?.type === filter);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (img) =>
          img.description?.content.toLowerCase().includes(query) ||
          img.description?.type.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [images, filter, searchQuery]);

  // Get unique description types for filter options
  const availableTypes = React.useMemo(() => {
    const types = new Set(images.map((img) => img.description?.type).filter(Boolean));
    return Array.from(types);
  }, [images]);

  const handleImageClick = (image: GeneratedImage) => {
    setSelectedImage(image);
  };

  const handleDownload = async (image: GeneratedImage) => {
    try {
      const filename = `fancai-${image.id}-${Date.now()}.jpg`;
      await downloadWithAuth(image.image_url, filename);
      notify.success('Download Started', 'Image download has begun');
    } catch (error) {
      logger.error('[ImageGallery] Download failed:', error);
      notify.error('Download Failed', 'Failed to download image');
    }
  };

  const handleShare = async (image: GeneratedImage) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'fancai - Generated Image',
          text: image.description?.content || 'AI-generated book illustration',
          url: image.image_url,
        });
      } catch (error) {
        logger.error('Share failed:', error);
      }
    } else {
      // Fallback to clipboard
      try {
        await navigator.clipboard.writeText(image.image_url);
        notify.success('Copied to Clipboard', 'Image URL copied to clipboard');
      } catch {
        notify.error('Share Failed', 'Failed to share image');
      }
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <LoadingSpinner size="lg" text={t('imageGallery.loading')} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <ErrorMessage
          title={t('imageGallery.error_title')}
          message={t('imageGallery.error_message')}
          action={{ label: t('imageGallery.retry'), onClick: () => refetch() }}
        />
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className={`text-center py-12 ${className}`}>
        <Image className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">
          {t('imageGallery.empty_title')}
        </h3>
        <p className="text-muted-foreground max-w-sm mx-auto">{t('imageGallery.empty_desc')}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1">{t('imageGallery.title')}</h2>
          <p className="text-muted-foreground">
            {t('imageGallery.count', { filtered: filteredImages.length, total: images.length })}
          </p>
        </div>

        <div className="flex items-center space-x-2 mt-4 sm:mt-0">
          <button
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
            title={`Switch to ${viewMode === 'grid' ? 'list' : 'grid'} view`}
          >
            {viewMode === 'grid' ? <List className="h-5 w-5" /> : <Grid className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1">
          <input
            type="text"
            placeholder={t('imageGallery.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-card text-foreground"
          />
        </div>

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterType)}
          className="px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-card text-foreground"
        >
          <option value="all">{t('imageGallery.all_types')}</option>
          {availableTypes.map((type) => (
            <option key={type} value={type}>
              {(type ?? '').charAt(0).toUpperCase() + (type ?? '').slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Images */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredImages.map((image, index) => (
            <m.div
              key={image.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="group relative bg-card rounded-lg overflow-hidden shadow-xs hover:shadow-lg transition-shadow"
            >
              <div
                role="button"
                tabIndex={0}
                className="aspect-square cursor-pointer overflow-hidden relative focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                onClick={() => handleImageClick(image)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleImageClick(image);
                  }
                }}
                aria-label={`View image: ${image.description?.content || 'Generated image'}`}
              >
                <LazyImage
                  src={image.image_url}
                  alt={image.description?.content || 'Generated image'}
                  className="w-full h-full"
                  imageClassName="group-hover:scale-105 transition-transform duration-300"
                  rootMargin="100px"
                />

                {/* Overlay - hidden on mobile since actions are always visible */}
                <div
                  className={cn(
                    'absolute inset-0 transition-colors flex items-center justify-center pointer-events-none',
                    'bg-black/0 md:group-hover:bg-black/40',
                    'opacity-0 md:group-hover:opacity-100'
                  )}
                  aria-hidden="true"
                >
                  <Eye className="h-8 w-8 text-white" />
                </div>
              </div>

              {/* Actions - always visible on mobile, hover-only on desktop */}
              <div
                className={cn(
                  'absolute top-2 right-2 flex space-x-1 transition-opacity',
                  'opacity-100 md:opacity-0 md:group-hover:opacity-100'
                )}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(image);
                  }}
                  className="p-1.5 bg-black/50 text-white rounded-lg hover:bg-black/70 active:bg-black/80 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white"
                  aria-label="Download image"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleShare(image);
                  }}
                  className="p-1.5 bg-black/50 text-white rounded-lg hover:bg-black/70 active:bg-black/80 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white"
                  aria-label="Share image"
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {/* Info */}
              <div className="p-3">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {image.description?.content || 'Generated image'}
                </p>
                {image.description?.type && (
                  <span className="inline-block mt-2 px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
                    {image.description.type}
                  </span>
                )}
              </div>
            </m.div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredImages.map((image, index) => (
            <m.div
              key={image.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex items-center space-x-4 bg-card rounded-lg p-4 shadow-xs hover:shadow-lg transition-shadow"
            >
              <div
                className="w-20 h-20 flex-shrink-0 cursor-pointer rounded-lg overflow-hidden"
                onClick={() => handleImageClick(image)}
              >
                <LazyImage
                  src={image.image_url}
                  alt={image.description?.content || 'Generated image'}
                  className="w-full h-full"
                  imageClassName="hover:scale-105 transition-transform"
                  rootMargin="100px"
                />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-foreground text-sm font-medium line-clamp-2">
                  {image.description?.content || 'Generated image'}
                </p>
                {image.description?.type && (
                  <span className="inline-block mt-1 px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
                    {image.description.type}
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleImageClick(image)}
                  className="p-2 text-muted-foreground hover:text-primary transition-colors"
                  title={t('imageGallery.view')}
                >
                  <Eye className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDownload(image)}
                  className="p-2 text-muted-foreground hover:text-primary transition-colors"
                  title={t('imageGallery.download')}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleShare(image)}
                  className="p-2 text-muted-foreground hover:text-primary transition-colors"
                  title={t('imageGallery.share')}
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            </m.div>
          ))}
        </div>
      )}

      {/* Empty state for filtered results */}
      {filteredImages.length === 0 && images.length > 0 && (
        <div className="text-center py-12">
          <Filter className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">
            {t('imageGallery.no_filtered')}
          </h3>
          <p className="text-muted-foreground">{t('imageGallery.no_filtered_hint')}</p>
        </div>
      )}

      {/* Image Modal */}
      <AnimatePresence>
        {selectedImage && (
          <ImageModal
            imageUrl={selectedImage.image_url}
            title={selectedImage.description?.type}
            description={selectedImage.description?.content}
            isOpen={!!selectedImage}
            onClose={() => setSelectedImage(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
