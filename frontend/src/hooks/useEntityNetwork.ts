import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { EntityService } from '../services/EntityService';
import { EntityNetworkResponse } from '../types/entity';

const ENTITY_NETWORK_STALE_TIME = 1000 * 60 * 60;

export const entityNetworkQueryKey = (bookId: string, currentChapter?: number) => 
    currentChapter != null 
        ? ['book', bookId, 'entities', currentChapter] 
        : ['book', bookId, 'entities'];

export const useEntityNetwork = (bookId: string | undefined, currentChapter?: number) => {
    return useQuery<EntityNetworkResponse, Error>({
        queryKey: entityNetworkQueryKey(bookId || '', currentChapter),
        queryFn: () => {
            if (!bookId) throw new Error('Book ID is required');
            return EntityService.getNetwork(bookId, currentChapter);
        },
        enabled: !!bookId,
        staleTime: ENTITY_NETWORK_STALE_TIME,
        refetchOnWindowFocus: false,
    });
};

export const usePrefetchEntityNetwork = () => {
    const queryClient = useQueryClient();
    
    return useCallback((bookId: string) => {
        queryClient.prefetchQuery({
            queryKey: entityNetworkQueryKey(bookId),
            queryFn: () => EntityService.getNetwork(bookId),
            staleTime: ENTITY_NETWORK_STALE_TIME,
        });
    }, [queryClient]);
};

export const useInvalidateEntityNetworkOnUpdate = (bookId: string | undefined) => {
    const queryClient = useQueryClient();
    
    useEffect(() => {
        if (!bookId) return;
        
        const handleEntitiesUpdated = (event: CustomEvent<{ book_id: string }>) => {
            if (event.detail.book_id === bookId) {
                queryClient.invalidateQueries({ queryKey: entityNetworkQueryKey(bookId) });
            }
        };
        
        window.addEventListener('entities_updated', handleEntitiesUpdated as EventListener);
        return () => {
            window.removeEventListener('entities_updated', handleEntitiesUpdated as EventListener);
        };
    }, [bookId, queryClient]);
};
