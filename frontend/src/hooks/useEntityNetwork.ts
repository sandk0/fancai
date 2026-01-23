import { useQuery } from '@tanstack/react-query';
import { EntityService } from '../services/EntityService';
import { EntityNetworkResponse } from '../types/entity';

export const useEntityNetwork = (bookId: string | undefined) => {
    return useQuery<EntityNetworkResponse, Error>({
        queryKey: ['book', bookId, 'entities'],
        queryFn: () => {
            if (!bookId) throw new Error('Book ID is required');
            return EntityService.getNetwork(bookId);
        },
        enabled: !!bookId,
        staleTime: 1000 * 60 * 60, // 1 hour (same as backend cache)
        refetchOnWindowFocus: false,
    });
};
