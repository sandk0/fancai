/**
 * DownloadBookButton - Button component for downloading books for offline reading.
 *
 * Displays different states:
 * - Download button (not downloaded)
 * - Progress indicator (downloading)
 * - Success indicator with delete option (downloaded)
 * - Error state with retry option
 *
 * Features:
 * - Responsive design (icon-only or with text)
 * - Touch-friendly (min 44px targets)
 * - Accessible ARIA labels
 * - Dropdown menu for offline book management
 *
 * @module components/Library/DownloadBookButton
 */

import { memo, useCallback } from 'react'
import { Download, X, Check, Trash2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button, Spinner } from '@/components/UI/button'
import { Progress } from '@/components/UI/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/UI/dropdown-menu'
import { useDownloadBook } from '@/hooks/useDownloadBook'

// ============================================================================
// Types
// ============================================================================

interface DownloadBookButtonProps {
  /** Book ID to download */
  bookId: string
  /** Button display variant */
  variant?: 'default' | 'icon'
  /** Additional CSS classes */
  className?: string
  /** Disable the button */
  disabled?: boolean
}

// ============================================================================
// Component
// ============================================================================

/**
 * Button for downloading books for offline reading.
 *
 * @example
 * ```tsx
 * // Default variant with text
 * <DownloadBookButton bookId="123" />
 *
 * // Icon-only variant
 * <DownloadBookButton bookId="123" variant="icon" />
 *
 * // With custom styling
 * <DownloadBookButton bookId="123" className="ml-2" />
 * ```
 */
export const DownloadBookButton = memo(function DownloadBookButton({
  bookId,
  variant = 'default',
  className,
  disabled = false,
}: DownloadBookButtonProps) {
  const { t } = useTranslation()
  const {
    isAvailableOffline,
    isDownloading,
    downloadProgress,
    error,
    startDownload,
    cancelDownload,
    deleteOfflineBook,
    retryDownload,
  } = useDownloadBook(bookId)

  // Handle download click
  const handleDownloadClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      startDownload()
    },
    [startDownload]
  )

  // Handle cancel click
  const handleCancelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      cancelDownload()
    },
    [cancelDownload]
  )

  // Handle delete click
  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      deleteOfflineBook()
    },
    [deleteOfflineBook]
  )

  // Handle retry click
  const handleRetryClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      retryDownload()
    },
    [retryDownload]
  )

  // ========================================
  // Render: Available Offline
  // ========================================
  if (isAvailableOffline) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={variant === 'icon' ? 'icon' : 'sm'}
            className={cn(
              'text-green-600 hover:text-green-700',
              variant === 'icon' && 'h-9 w-9',
              className
            )}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('library.download.offline_options')}
          >
            <Check className="h-4 w-4" />
            {variant !== 'icon' && (
              <span className="ml-1.5 text-xs">{t('library.download.offline')}</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            onClick={handleDeleteClick}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('library.download.delete_offline')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // ========================================
  // Render: Downloading
  // ========================================
  if (isDownloading) {
    if (variant === 'icon') {
      return (
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-9 w-9 relative', className)}
          onClick={handleCancelClick}
          aria-label={t('library.download.cancel')}
        >
          <Spinner className="h-4 w-4 absolute" />
          <X className="h-3 w-3 opacity-0 hover:opacity-100 transition-opacity" />
        </Button>
      )
    }

    return (
      <div
        className={cn('flex items-center gap-2', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <Progress
          value={downloadProgress}
          className="w-16 h-2"
        />
        <span className="text-xs text-muted-foreground min-w-[2.5rem]">
          {downloadProgress}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleCancelClick}
          aria-label={t('library.download.cancel')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  // ========================================
  // Render: Error State
  // ========================================
  if (error) {
    return (
      <Button
        variant="destructive"
        size={variant === 'icon' ? 'icon' : 'sm'}
        className={cn(variant === 'icon' && 'h-9 w-9', className)}
        onClick={handleRetryClick}
        disabled={disabled}
        title={error}
        aria-label={t('library.download.retry')}
      >
        <RefreshCw className="h-4 w-4" />
        {variant !== 'icon' && <span className="ml-1.5 text-xs">{t('library.download.retry')}</span>}
      </Button>
    )
  }

  // ========================================
  // Render: Default (Not Downloaded)
  // ========================================
  return (
    <Button
      variant="ghost"
      size={variant === 'icon' ? 'icon' : 'sm'}
      className={cn(
        'text-muted-foreground hover:text-foreground',
        variant === 'icon' && 'h-9 w-9',
        className
      )}
      onClick={handleDownloadClick}
      disabled={disabled}
      title={t('library.download.title')}
      aria-label={t('library.download.title')}
    >
      <Download className="h-4 w-4" />
      {variant !== 'icon' && <span className="ml-1.5 text-xs">{t('library.download.download')}</span>}
    </Button>
  )
})

export default DownloadBookButton
