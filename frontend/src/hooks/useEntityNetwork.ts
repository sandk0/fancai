import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { EntityService } from '@/services/EntityService';
import { EntityNetworkResponse } from '@/types/entity';
import { entityKeys } from '@/hooks/api/queryKeys';
import { useAuthStore } from '@/stores/auth';

const ENTITY_NETWORK_STALE_TIME = 1000 * 60 * 5; // 5 minutes — entity data changes when processing completes

/**
 * Граф сущностей книги со спойлер-фильтрацией по прочитанной главе.
 *
 * userId читается из стора реактивно, а не через `getCurrentUserId()`: после
 * пробуждения PWA стор ещё не восстановлен, и бросок исключения из ключа
 * уронил бы читалку на первом же рендере.
 */
export const useEntityNetwork = (bookId: string | undefined, currentChapter?: number) => {
    const userId = useAuthStore((state) => state.user?.id) ?? '';

    return useQuery<EntityNetworkResponse, Error>({
        queryKey: entityKeys.network(userId, bookId || '', currentChapter),
        queryFn: () => {
            if (!bookId) throw new Error('Book ID is required');
            return EntityService.getNetwork(bookId, currentChapter);
        },
        enabled: !!bookId && !!userId,
        staleTime: ENTITY_NETWORK_STALE_TIME,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });
};
