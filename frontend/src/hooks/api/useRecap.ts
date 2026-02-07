import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { getCurrentUserId, bookKeys } from './queryKeys';
import type { EntityEvent } from '@/types/entity';

export interface RecapEntity {
    id: string;
    name: string;
    avatar_url?: string | null;
    dynamic_role?: string | null;
    last_event?: EntityEvent | null;
}

interface RecapResponse {
    entities: RecapEntity[];
}

export const useRecap = (bookId: string, currentChapter: number) => {
    const userId = getCurrentUserId();

    return useQuery<RecapResponse>({
        queryKey: [...bookKeys.detail(userId, bookId), 'recap', currentChapter],
        queryFn: () =>
            apiClient.get<RecapResponse>(`/books/${bookId}/entities/recap`, {
                params: { current_chapter: currentChapter },
            }),
        enabled: currentChapter > 0,
        staleTime: 5 * 60 * 1000,
    });
};
