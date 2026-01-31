import { apiClient } from '../api/client';
import { EntityNetworkResponse } from '../types/entity';

export class EntityService {
    static async getNetwork(bookId: string, currentChapter?: number): Promise<EntityNetworkResponse> {
        const params = currentChapter != null ? { current_chapter: currentChapter } : {};
        return apiClient.get<EntityNetworkResponse>(
            `/books/${bookId}/entities/network`,
            { params }
        );
    }
}
