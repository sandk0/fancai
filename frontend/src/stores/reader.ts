import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { booksAPI } from '@/api/books';
import { tabSync } from '@/services/tabSync';
import { logger } from '@/lib/logger';

// Migrate localStorage from old key to new (bookreader → fancai rebrand)
const OLD_STORAGE_KEY = 'reader-storage';
const STORAGE_KEY = 'fancai-reader';
if (typeof window !== 'undefined') {
  const oldData = localStorage.getItem(OLD_STORAGE_KEY);
  if (oldData && !localStorage.getItem(STORAGE_KEY)) {
    localStorage.setItem(STORAGE_KEY, oldData);
    localStorage.removeItem(OLD_STORAGE_KEY);
  }
}

export interface ReadingProgress {
  bookId: string;
  currentChapter: number;
  currentPage: number;
  progress: number; // 0-100
  lastReadAt: Date;
  totalTimeRead: number; // in seconds
}

// Reader theme type including 'night' and 'outdoor' modes
export type ReaderTheme = 'light' | 'dark' | 'sepia' | 'night' | 'outdoor';

// Navigation mode type
export type NavigationMode = 'swipe' | 'tap';

// Description density
export type DescriptionDensity = 'all' | 'key' | 'off';

// Description highlight mode
export type DescriptionHighlightMode = 'anchor' | 'full';

// Bookmark style type
export type BookmarkStyle = 'none' | 'highlight' | 'underline' | 'bold' | 'italic';

export interface StoreBookmark {
  id: string;
  cfiRange: string;
  chapter: number;
  text: string;
  color?: string | null;
  style: BookmarkStyle;
  note?: string;
  createdAt: Date;
}

interface ReaderState {
  // Settings
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  theme: ReaderTheme;
  backgroundColor: string;
  textColor: string;
  maxWidth: number;
  margin: number;
  navigationMode: NavigationMode; // 'swipe' or 'tap' - iOS always uses 'swipe'
  nameHighlightingEnabled: boolean;
  descriptionDensity: DescriptionDensity;
  descriptionHighlightMode: DescriptionHighlightMode;

  // Reading state
  readingProgress: Record<string, ReadingProgress>;
  bookmarks: Record<string, StoreBookmark[]>;

  // Actions
  updateFontSize: (size: number) => void;
  updateFontFamily: (family: string) => void;
  updateLineHeight: (height: number) => void;
  updateTheme: (theme: ReaderTheme) => void;
  updateMaxWidth: (width: number) => void;
  updateMargin: (margin: number) => void;
  updateNavigationMode: (mode: NavigationMode) => void;
  updateNameHighlighting: (enabled: boolean) => void;
  updateDescriptionDensity: (density: DescriptionDensity) => void;
  updateDescriptionHighlightMode: (mode: DescriptionHighlightMode) => void;
  updateReadingProgress: (bookId: string, chapter: number, progress: number, page?: number) => void;
  addBookmark: (
    bookId: string,
    chapter: number,
    cfiRange: string,
    text: string,
    color?: string | null,
    style?: string,
    note?: string
  ) => void;
  removeBookmark: (bookId: string, bookmarkId: string) => void;
  resetSettings: () => void;
  reset: () => void; // Clear all data (for logout)
  getReadingProgress: (bookId: string) => ReadingProgress | null;
  getTotalReadingTime: () => number;
}

const themeSettings: Record<ReaderTheme, { backgroundColor: string; textColor: string }> = {
  light: {
    backgroundColor: '#FFFFFF',
    textColor: '#1A1A1A',
  },
  dark: {
    backgroundColor: '#121212',
    textColor: '#E0E0E0',
  },
  sepia: {
    backgroundColor: '#FBF0D9',
    textColor: '#3D2914',
  },
  night: {
    backgroundColor: '#000000',
    textColor: '#B0B0B0',
  },
  outdoor: {
    backgroundColor: '#FFFEF5',
    textColor: '#000000',
  },
};

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, get) => ({
      // Initial settings
      fontSize: 18,
      fontFamily: 'Georgia, serif',
      lineHeight: 1.6,
      theme: 'light',
      backgroundColor: '#ffffff',
      textColor: '#1f2937',
      maxWidth: 800,
      margin: 40,
      navigationMode: 'swipe', // Default to swipe (modern UX)
      nameHighlightingEnabled: true,
      descriptionDensity: 'all' as DescriptionDensity,
      descriptionHighlightMode: 'anchor' as DescriptionHighlightMode,

      // Initial state
      readingProgress: {},
      bookmarks: {},

      // Settings actions
      updateFontSize: (size: number) => {
        set({ fontSize: Math.max(12, Math.min(32, size)) });
      },

      updateFontFamily: (family: string) => {
        set({ fontFamily: family });
      },

      updateLineHeight: (height: number) => {
        set({ lineHeight: Math.max(1.2, Math.min(2.5, height)) });
      },

      updateTheme: (theme: ReaderTheme) => {
        const settings = themeSettings[theme];
        set({
          theme,
          backgroundColor: settings.backgroundColor,
          textColor: settings.textColor,
        });
      },

      updateMaxWidth: (width: number) => {
        set({ maxWidth: Math.max(500, Math.min(1200, width)) });
      },

      updateMargin: (margin: number) => {
        set({ margin: Math.max(0, Math.min(100, margin)) });
      },

      updateNavigationMode: (mode: NavigationMode) => {
        set({ navigationMode: mode });
      },

      updateNameHighlighting: (enabled: boolean) => {
        set({ nameHighlightingEnabled: enabled });
      },

      updateDescriptionDensity: (density: DescriptionDensity) => {
        set({ descriptionDensity: density });
      },

      updateDescriptionHighlightMode: (mode: DescriptionHighlightMode) => {
        set({ descriptionHighlightMode: mode });
      },

      // Reading progress actions (optimistic update + background sync)
      updateReadingProgress: (bookId: string, chapter: number, progress: number, page?: number) => {
        const currentProgress = get().readingProgress[bookId];
        const now = new Date();
        const actualPage = page || currentProgress?.currentPage || 1;

        const updatedProgress: ReadingProgress = {
          bookId,
          currentChapter: chapter,
          currentPage: actualPage,
          progress: Math.max(0, Math.min(100, progress)),
          lastReadAt: now,
          totalTimeRead:
            (currentProgress?.totalTimeRead || 0) +
            (currentProgress
              ? (now.getTime() - new Date(currentProgress.lastReadAt).getTime()) / 1000
              : 0),
        };

        set((state) => ({
          readingProgress: {
            ...state.readingProgress,
            [bookId]: updatedProgress,
          },
        }));

        tabSync.broadcast({
          type: 'progress-update',
          bookId,
          chapter,
          progress: updatedProgress.progress,
          page: actualPage,
        });

        // Background sync with server (fire-and-forget)
        booksAPI
          .updateReadingProgress(bookId, {
            current_chapter: chapter,
            current_position_percent: 0,
          })
          .catch((error) => {
            logger.error('Failed to sync reading progress:', error);
          });
      },

      // Unified bookmarks actions (CFI range-based)
      addBookmark: (
        bookId: string,
        chapter: number,
        cfiRange: string,
        text: string,
        color?: string | null,
        style?: string,
        note?: string
      ) => {
        const bookmark: StoreBookmark = {
          id: `bookmark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          cfiRange,
          chapter,
          text: text.slice(0, 500),
          color: color ?? null,
          style: (style || 'none') as BookmarkStyle,
          note,
          createdAt: new Date(),
        };

        set((state) => ({
          bookmarks: {
            ...state.bookmarks,
            [bookId]: [...(state.bookmarks[bookId] || []), bookmark],
          },
        }));
      },

      removeBookmark: (bookId: string, bookmarkId: string) => {
        set((state) => ({
          bookmarks: {
            ...state.bookmarks,
            [bookId]: (state.bookmarks[bookId] || []).filter((b) => b.id !== bookmarkId),
          },
        }));
      },

      // Utility actions
      resetSettings: () => {
        set({
          fontSize: 18,
          fontFamily: 'Georgia, serif',
          lineHeight: 1.6,
          theme: 'light',
          backgroundColor: '#ffffff',
          textColor: '#1f2937',
          maxWidth: 800,
          margin: 40,
          navigationMode: 'swipe',
          nameHighlightingEnabled: true,
          descriptionDensity: 'all' as DescriptionDensity,
          descriptionHighlightMode: 'anchor' as DescriptionHighlightMode,
        });
      },

      // Full reset - clears all data (for logout)
      reset: () => {
        logger.debug('[ReaderStore] Resetting all data');
        set({
          // Reset settings to defaults
          fontSize: 18,
          fontFamily: 'Georgia, serif',
          lineHeight: 1.6,
          theme: 'light',
          backgroundColor: '#ffffff',
          textColor: '#1f2937',
          maxWidth: 800,
          margin: 40,
          navigationMode: 'swipe',
          nameHighlightingEnabled: true,
          descriptionDensity: 'all' as DescriptionDensity,
          descriptionHighlightMode: 'anchor' as DescriptionHighlightMode,
          // Clear all user data
          readingProgress: {},
          bookmarks: {},
        });
        // Also clear persisted storage
        localStorage.removeItem('fancai-reader');
        // Migration: clean up old key
        localStorage.removeItem('reader-storage');
      },

      getReadingProgress: (bookId: string) => {
        return get().readingProgress[bookId] || null;
      },

      getTotalReadingTime: () => {
        const progress = get().readingProgress;
        return Object.values(progress).reduce((total, p) => total + p.totalTimeRead, 0);
      },
    }),
    {
      name: 'fancai-reader',
      version: 4,
      partialize: (state) => ({
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        lineHeight: state.lineHeight,
        theme: state.theme,
        backgroundColor: state.backgroundColor,
        textColor: state.textColor,
        maxWidth: state.maxWidth,
        margin: state.margin,
        navigationMode: state.navigationMode,
        nameHighlightingEnabled: state.nameHighlightingEnabled,
        descriptionDensity: state.descriptionDensity,
        descriptionHighlightMode: state.descriptionHighlightMode,
        readingProgress: state.readingProgress,
        bookmarks: state.bookmarks,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          // Migrate old highlights into bookmarks
          const oldHighlights = (state.highlights || {}) as Record<
            string,
            {
              id: string;
              cfiRange: string;
              chapter: number;
              text: string;
              color: string;
              note?: string;
              createdAt: Date;
            }[]
          >;
          const oldBookmarks = (state.bookmarks || {}) as Record<string, unknown[]>;
          const newBookmarks: Record<string, StoreBookmark[]> = {};

          // Convert old highlights → unified bookmarks
          for (const [bookId, items] of Object.entries(oldHighlights)) {
            if (!newBookmarks[bookId]) newBookmarks[bookId] = [];
            for (const h of items) {
              newBookmarks[bookId].push({
                id: h.id,
                cfiRange: h.cfiRange,
                chapter: h.chapter,
                text: h.text,
                color: h.color,
                style: 'highlight',
                note: h.note,
                createdAt: h.createdAt,
              });
            }
          }

          // Convert old bookmarks (position-only) → unified bookmarks
          for (const [bookId, items] of Object.entries(oldBookmarks)) {
            if (!newBookmarks[bookId]) newBookmarks[bookId] = [];
            for (const rawItem of items) {
              const item = rawItem as {
                cfi?: string;
                chapter?: number;
                text?: string;
                createdAt?: Date;
              };
              if (item.cfi) {
                newBookmarks[bookId].push({
                  id: `migrated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  cfiRange: item.cfi,
                  chapter: item.chapter || 0,
                  text: item.text || '',
                  color: null,
                  style: 'none',
                  createdAt: item.createdAt || new Date(),
                });
              }
            }
          }

          state.bookmarks = newBookmarks;
          delete state.highlights;
        }
        if (version < 3) {
          // Enable entity name highlighting by default for existing users
          state.nameHighlightingEnabled = true;
        }
        if (version < 4) {
          // Add description highlight mode (anchor = compact, default)
          state.descriptionHighlightMode = 'anchor';
        }
        return state;
      },
    }
  )
);

tabSync.subscribe('progress-update', (message) => {
  if (message.type !== 'progress-update') return;

  const existing = useReaderStore.getState().readingProgress[message.bookId];

  useReaderStore.setState((state) => ({
    readingProgress: {
      ...state.readingProgress,
      [message.bookId]: {
        bookId: message.bookId,
        currentChapter: message.chapter,
        currentPage: message.page,
        progress: message.progress,
        lastReadAt: new Date(),
        totalTimeRead: existing?.totalTimeRead ?? 0,
      },
    },
  }));
});
