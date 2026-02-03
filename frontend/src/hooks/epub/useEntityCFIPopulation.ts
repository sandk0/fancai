import { useCallback, useRef } from 'react';
import type { Rendition, Book } from '@/types/epub';
import type { EntityDetail } from '@/types/entity';
import { adminAPI } from '@/api/admin';
import { useCFIGenerator } from './useCFIGenerator';
import { logger } from '@/lib/logger';

interface UseEntityCFIPopulationOptions {
  rendition: Rendition | null;
  book: Book | null;
  entities: Record<string, EntityDetail>;
  isAdmin?: boolean;
  enabled?: boolean;
}

interface UseEntityCFIPopulationReturn {
  populateMissingCFIs: () => Promise<number>;
}

export const useEntityCFIPopulation = ({
  rendition,
  book,
  entities,
  isAdmin = false,
  enabled = true,
}: UseEntityCFIPopulationOptions): UseEntityCFIPopulationReturn => {
  const { findTextCFI } = useCFIGenerator({ rendition, book });
  const populatedRef = useRef<Set<string>>(new Set());

  const populateMissingCFIs = useCallback(async (): Promise<number> => {
    if (!enabled || !isAdmin || !rendition || !entities) {
      return 0;
    }

    const entitiesWithoutCFI = Object.values(entities).filter(
      entity => !entity.first_mention_cfi && !populatedRef.current.has(entity.id)
    );

    if (entitiesWithoutCFI.length === 0) {
      return 0;
    }

    let updatedCount = 0;

    for (const entity of entitiesWithoutCFI) {
      try {
        const cfi = findTextCFI(entity.name);
        
        if (cfi) {
          await adminAPI.updateEntityCFI(entity.id, cfi);
          populatedRef.current.add(entity.id);
          updatedCount++;
        }
      } catch (error) {
        logger.error(`[useEntityCFIPopulation] Failed to update CFI for ${entity.name}:`, error);
      }
    }

    return updatedCount;
  }, [enabled, isAdmin, rendition, entities, findTextCFI]);

  return { populateMissingCFIs };
};
