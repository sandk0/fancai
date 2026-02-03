/**
 * Internal epub.js types not exposed by the public API
 * These are implementation details used for iOS fixes and layout corrections
 */

/** epub.js internal layout object used by the rendering manager */
export interface EpubLayout {
  divisor: number;
  columnWidth: number;
  spreadWidth: number;
  pageWidth: number;
  delta: number;
  gap?: number;
  _spread: string | boolean;
  _minSpreadWidth?: number;
}

/** epub.js internal manager with gesture handling and stage access */
export interface EpubManager {
  layout?: EpubLayout;
  snap?: (...args: unknown[]) => Promise<void>;
  gestures?: {
    destroy?: () => void;
  } | null;
  stage?: {
    container?: HTMLElement & {
      scrollTo?: (options: ScrollToOptions | number, y?: number) => void;
      scrollBy?: (options: ScrollToOptions | number, y?: number) => void;
    };
  };
}

/** Extended rendition with internal manager access */
export interface EpubRenditionInternal {
  manager?: EpubManager;
}
