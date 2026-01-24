import { apiClient } from '../api/client';
import { EntityNetworkResponse } from '../types/entity';

export class EntityService {
    /**
     * Fetches the entity network graph for a specific book.
     * @param bookId The ID of the book.
     */
    static async getNetwork(bookId: string): Promise<EntityNetworkResponse> {
        // Use apiClient which handles auth tokens automatically
        return apiClient.get<EntityNetworkResponse>(
            `/books/${bookId}/entities/network`
        );
    }
}
