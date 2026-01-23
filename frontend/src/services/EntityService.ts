import axios from 'axios';
import { EntityNetworkResponse } from '../types/entity';

// Base URL handling (using Vite env var or default proxy)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export class EntityService {
    /**
     * Fetches the entity network graph for a specific book.
     * @param bookId The ID of the book.
     */
    static async getNetwork(bookId: string): Promise<EntityNetworkResponse> {
        const response = await axios.get<EntityNetworkResponse>(
            `${API_BASE_URL}/books/${bookId}/entities/network`
        );
        return response.data;
    }
}
