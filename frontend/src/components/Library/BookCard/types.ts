import type { Book } from '@/types/api';

export type ProcessingState = 'not_processed' | 'processed' | 'processing' | 'error';

export interface BookCardProps {
  book: Book;
  onClick: () => void;
  onParsingComplete?: () => void;
  onDelete?: (bookId: string) => void;
  onProcessStart?: (bookId: string) => void;
}

export interface BookCoverProps {
  book: Book;
  imageLoaded: boolean;
  onImageLoad: () => void;
  coverUrl: string | null;
  isClickable: boolean;
  progressPercent: number;
  isAvailableOffline: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  isOnline: boolean;
}

export interface ProcessingButtonsProps {
  book: Book;
  processingState: ProcessingState;
  isStarting: boolean;
  onStartProcessing: () => void;
}

export interface DesktopHoverOverlayProps {
  /** Нужен только для стабильного `data-testid` кнопки удаления. */
  bookId: string;
  isClickable: boolean;
  isProcessing: boolean;
  processingState: ProcessingState;
  isAvailableOffline: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  onReadClick: (e: React.MouseEvent) => void;
  onDeleteClick: (e: React.MouseEvent) => void;
  onOfflineClick: (e: React.MouseEvent) => void;
  onProcessClick: (e: React.MouseEvent) => void;
  showDelete: boolean;
}

export interface MobileMenuProps {
  /** Нужен только для стабильных `data-testid` меню и удаления. */
  bookId: string;
  isOpen: boolean;
  isClickable: boolean;
  isAvailableOffline: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  showDelete: boolean;
  onToggle: (e: React.MouseEvent) => void;
  onClose: (e: React.MouseEvent) => void;
  onReadClick: (e: React.MouseEvent) => void;
  onDeleteClick: (e: React.MouseEvent) => void;
  onOfflineClick: (e: React.MouseEvent) => void;
}

export interface BookInfoProps {
  book: Book;
  processingState: ProcessingState;
}
