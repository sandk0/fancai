import React, { type ReactNode } from 'react';
import { ReaderContext } from './useReaderContext';
import type { ReaderContextState } from './useReaderContext';

export type { ReaderContextState };

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
