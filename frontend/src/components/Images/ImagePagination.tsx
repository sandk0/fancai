/**
 * ImagePagination - Pagination controls for the images gallery
 */

import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImagePaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export function ImagePagination({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
}: ImagePaginationProps) {
  const { t } = useTranslation();

  if (totalPages <= 1) return null;

  return (
    <>
      <div className="flex items-center justify-center gap-2 mt-8">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className={cn(
            'flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-colors',
            'border-border bg-background',
            currentPage === 1
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-muted cursor-pointer'
          )}
          aria-label={t('imagesGallery.prev_page')}
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>

        <div className="flex items-center gap-1">
          {/* First page */}
          {currentPage > 3 && (
            <>
              <button
                onClick={() => onPageChange(1)}
                className="w-10 h-10 rounded-lg border-2 border-border bg-background hover:bg-muted text-foreground font-medium"
              >
                1
              </button>
              {currentPage > 4 && (
                <span className="px-2 text-muted-foreground">...</span>
              )}
            </>
          )}

          {/* Page numbers around current */}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (page) =>
                page >= currentPage - 2 &&
                page <= currentPage + 2 &&
                page >= 1 &&
                page <= totalPages
            )
            .map((page) => (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={cn(
                  'w-10 h-10 rounded-lg border-2 font-medium transition-colors',
                  page === currentPage
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border bg-background hover:bg-muted text-foreground'
                )}
              >
                {page}
              </button>
            ))}

          {/* Last page */}
          {currentPage < totalPages - 2 && (
            <>
              {currentPage < totalPages - 3 && (
                <span className="px-2 text-muted-foreground">...</span>
              )}
              <button
                onClick={() => onPageChange(totalPages)}
                className="w-10 h-10 rounded-lg border-2 border-border bg-background hover:bg-muted text-foreground font-medium"
              >
                {totalPages}
              </button>
            </>
          )}
        </div>

        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className={cn(
            'flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-colors',
            'border-border bg-background',
            currentPage === totalPages
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-muted cursor-pointer'
          )}
          aria-label={t('imagesGallery.next_page')}
        >
          <ChevronRight className="w-5 h-5 text-foreground" />
        </button>
      </div>

      {/* Page info */}
      <p className="text-center text-sm text-muted-foreground mt-4">
        {t('imagesGallery.page_info', { current: currentPage, total: totalPages, count: totalItems })}
      </p>
    </>
  );
}
