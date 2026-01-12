import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * ScrollToTop - Component that scrolls to top on route changes
 *
 * Automatically scrolls the page to the top when navigating between routes.
 * Uses 'instant' behavior for immediate scroll without animation.
 *
 * Note: Pages that manage their own scroll restoration (like LibraryPage)
 * handle scroll position independently using sessionStorage.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Scroll to top instantly on route change
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}

export default ScrollToTop;
