import { useState, useEffect } from 'react';

/**
 * Returns the number of columns based on window width
 * Matches Tailwind breakpoints used in BookGrid
 * grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6
 */
export const useColumns = () => {
  const [columns, setColumns] = useState(2);

  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      if (width >= 1280) setColumns(6);      // xl
      else if (width >= 1024) setColumns(5); // lg
      else if (width >= 768) setColumns(4);  // md
      else if (width >= 640) setColumns(3);  // sm
      else setColumns(2);                    // default
    };

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  return columns;
};
