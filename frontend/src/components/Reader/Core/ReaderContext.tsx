import React, { createContext, useContext, ReactNode } from 'react';
import type { Rendition, Book as EpubBook, NavItem } from '@/types/epub';

interface ReaderContextState {
  bookId: string;
  rendition: Rendition | null;
  book: EpubBook | null;
  isReady: boolean;
  isLoading: boolean;
  
  // Progress & Navigation
  currentCFI: string;
  currentChapter: number;
  progress: number;
  currentPage: number;
  totalPages: number;
  
  // Content
  toc: NavItem[];
  
  // UI State
  isTocOpen: boolean;
  setTocOpen: (open: boolean) => void;
  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  isBookInfoOpen: boolean;
  setBookInfoOpen: (open: boolean) => void;
  isEntityDrawerOpen: boolean;
  setEntityDrawerOpen: (open: boolean) => void;
}

const ReaderContext = createContext<ReaderContextState | undefined>(undefined);

export const useReaderContext = () => {
  const context = useContext(ReaderContext);
  if (!context) {
    throw new Error('useReaderContext must be used within a ReaderProvider');
  }
  return context;
};

export const ReaderProvider: React.FC<{
  value: ReaderContextState;
  children: ReactNode;
}> = ({ value, children }) => {
  return (
    <ReaderContext.Provider value={value}>
      {children}
    </ReaderContext.Provider>
  );
};
