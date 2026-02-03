/**
 * useEpubThemes - Custom hook for managing EPUB themes
 *
 * Provides theme switching functionality (light/dark/sepia) and font size control.
 *
 * @param rendition - epub.js Rendition instance
 * @returns Theme state and control functions
 *
 * @example
 * const { theme, fontSize, setTheme, setFontSize } = useEpubThemes(rendition);
 * setTheme('dark');
 * setFontSize(120);
 */

import { useState, useEffect, useCallback } from 'react';
import type { Rendition } from '@/types/epub';
import { logger } from '@/lib/logger';

export type ThemeName = 'light' | 'dark' | 'sepia' | 'night' | 'outdoor';

interface ThemeStyles {
  body: Record<string, string>;
  p?: Record<string, string>;
  a?: Record<string, string>;
  h1?: Record<string, string>;
  h2?: Record<string, string>;
  h3?: Record<string, string>;
}

interface UseEpubThemesReturn {
  theme: ThemeName;
  fontSize: number;
  setTheme: (theme: ThemeName) => void;
  setFontSize: (size: number) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
}

/**
 * NOTE: This hook shares the same localStorage key as useTheme.ts
 * This ensures EPUB reader theme stays in sync with app theme.
 * The 'system' preference from useTheme is resolved to 'light' or 'dark' before reaching here.
 */
const THEME_STORAGE_KEY = 'app-theme'; // Sync with useTheme.ts
const FONT_SIZE_STORAGE_KEY = 'epub_reader_font_size';

const DEFAULT_THEME: ThemeName = 'light';
const DEFAULT_FONT_SIZE = 100; // percentage
const MIN_FONT_SIZE = 75;
const MAX_FONT_SIZE = 200;
const FONT_SIZE_STEP = 10;

/**
 * Theme definitions - colors match globals.css CSS variables
 */
const THEMES: Record<ThemeName, ThemeStyles> = {
  light: {
    body: {
      color: '#1A1A1A', // --foreground
      background: '#FFFFFF', // --background
      'font-family': 'Georgia, serif',
      'line-height': '1.6',
    },
    p: {
      'margin-bottom': '1em',
    },
    a: {
      color: 'hsl(221.2, 83.2%, 53.3%)', // --primary
    },
    h1: { color: '#1A1A1A' },
    h2: { color: '#1A1A1A' },
    h3: { color: '#1A1A1A' },
  },
  dark: {
    body: {
      color: '#E8E8E8', // --foreground (dark)
      background: '#121212', // --background (dark) - neutral gray, not blue-tinted
      'font-family': 'Georgia, serif',
      'line-height': '1.6',
    },
    p: {
      'margin-bottom': '1em',
    },
    a: {
      color: 'hsl(217.2, 91.2%, 59.8%)', // --primary (dark)
    },
    h1: { color: '#E8E8E8' },
    h2: { color: '#E8E8E8' },
    h3: { color: '#E8E8E8' },
  },
  sepia: {
    body: {
      color: '#3D2914', // --foreground (sepia)
      background: '#FBF0D9', // --background (sepia)
      'font-family': 'Georgia, serif',
      'line-height': '1.6',
    },
    p: {
      'margin-bottom': '1em',
    },
    a: {
      color: 'hsl(28, 79%, 45%)', // --primary (sepia)
    },
    h1: { color: '#3D2914' },
    h2: { color: '#3D2914' },
    h3: { color: '#3D2914' },
  },
  night: {
    body: {
      color: '#B0B0B0', // --foreground (night)
      background: '#000000', // --background (night) - pure black
      'font-family': 'Georgia, serif',
      'line-height': '1.6',
    },
    p: {
      'margin-bottom': '1em',
    },
    a: {
      color: 'hsl(217.2, 91.2%, 59.8%)', // --primary (night)
    },
    h1: { color: '#B0B0B0' },
    h2: { color: '#B0B0B0' },
    h3: { color: '#B0B0B0' },
  },
  outdoor: {
    body: {
      color: '#000000', // Pure black for maximum contrast
      background: '#FFFEF5', // Slightly warm white to reduce glare
      'font-family': 'Georgia, serif',
      'line-height': '1.6',
      'font-weight': '500', // Slightly bolder for better outdoor readability
    },
    p: {
      'margin-bottom': '1em',
    },
    a: {
      color: '#1E40AF', // Deep blue for high contrast links
      'font-weight': '600',
    },
    h1: { color: '#000000', 'font-weight': '700' },
    h2: { color: '#000000', 'font-weight': '700' },
    h3: { color: '#000000', 'font-weight': '600' },
  },
};

export const useEpubThemes = (
  rendition: Rendition | null
): UseEpubThemesReturn => {
  // Load theme from localStorage or use default
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return (saved as ThemeName) || DEFAULT_THEME;
  });

  // Load font size from localStorage or use default
  const [fontSize, setFontSizeState] = useState<number>(() => {
    const saved = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_FONT_SIZE;
  });

  /**
   * Apply theme to rendition
   */
  const applyTheme = useCallback((themeName: ThemeName, size: number) => {
    if (!rendition) return;

    try {
      const themeStyles = THEMES[themeName];
      const fontSizeMultiplier = size / 100;

      // Apply base theme styles
      const styledTheme = {
        ...themeStyles,
        body: {
          ...themeStyles.body,
          'font-size': `${fontSizeMultiplier}em`,
        },
      };

      rendition.themes.default(styledTheme);
    } catch (err) {
      logger.error('[useEpubThemes] Error applying theme:', err);
    }
  }, [rendition]);

  /**
   * Sync theme with HTML root element for Tailwind and global styles
   */
  const syncHtmlRoot = useCallback((themeName: ThemeName) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'sepia', 'outdoor');
    root.setAttribute('data-theme', themeName);

    if (themeName === 'dark' || themeName === 'night') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else if (themeName === 'sepia') {
      root.classList.add('sepia');
      root.style.colorScheme = 'light';
    } else if (themeName === 'outdoor') {
      root.classList.add('outdoor');
      root.style.colorScheme = 'light';
    } else {
      root.style.colorScheme = 'light';
    }
  }, []);

  /**
   * Change theme
   */
  const setTheme = useCallback((newTheme: ThemeName) => {
    setThemeState(newTheme);
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);

    // Sync with HTML root for Tailwind and global styles
    syncHtmlRoot(newTheme);

    applyTheme(newTheme, fontSize);
  }, [fontSize, applyTheme, syncHtmlRoot]);

  /**
   * Change font size
   */
  const setFontSize = useCallback((newSize: number) => {
    const clampedSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, newSize));
    setFontSizeState(clampedSize);
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, clampedSize.toString());
    applyTheme(theme, clampedSize);
  }, [theme, applyTheme]);

  /**
   * Increase font size
   */
  const increaseFontSize = useCallback(() => {
    setFontSize(fontSize + FONT_SIZE_STEP);
  }, [fontSize, setFontSize]);

  /**
   * Decrease font size
   */
  const decreaseFontSize = useCallback(() => {
    setFontSize(fontSize - FONT_SIZE_STEP);
  }, [fontSize, setFontSize]);

  /**
   * Apply theme when rendition is ready
   */
  useEffect(() => {
    if (rendition) {
      applyTheme(theme, fontSize);
    }
  }, [rendition, theme, fontSize, applyTheme]);

  /**
   * Sync HTML root on initial mount and when theme changes
   * This ensures Tailwind dark mode and global CSS variables stay in sync
   */
  useEffect(() => {
    syncHtmlRoot(theme);
  }, [theme, syncHtmlRoot]);

  return {
    theme,
    fontSize,
    setTheme,
    setFontSize,
    increaseFontSize,
    decreaseFontSize,
  };
};
