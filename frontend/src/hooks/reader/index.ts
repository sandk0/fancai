/**
 * Reader Custom Hooks
 *
 * This module exports all custom hooks for book reading functionality.
 * These hooks were extracted from the monolithic BookReader component
 * to improve maintainability and testability.
 *
 * Performance improvements:
 * - Component size: 1,037 lines → <250 lines
 * - Better separation of concerns
 * - Easier testing and maintenance
 * - Reusable hooks for future reader types
 *
 * @module hooks/reader
 */

export { usePagination } from './usePagination';
export { useReadingProgress } from './useReadingProgress';
export { useAutoParser } from './useAutoParser';
export { useDescriptionManagement } from './useDescriptionManagement';
export { useChapterNavigation } from './useChapterNavigation';
export { useKeyboardNavigation } from '../shared/useKeyboardNavigation';
export { useReaderImageModal } from './useReaderImageModal';
