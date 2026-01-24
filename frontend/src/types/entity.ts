export type EntityType = 'character' | 'location' | 'object' | 'action' | 'atmosphere';

export interface EntityNote {
    text: string;
    chapter_index: number;
    is_spoiler: boolean;
    type: string;
}

export interface EntityDetail {
    id: string; // UUID
    name: string;
    type: EntityType | string;
    avatar_url?: string | null;
    visual_summary?: string | null;
    importance: number; // 1-10

    mentions: number[];
    notes: EntityNote[];
}

export interface NetworkEdge {
    source: string; // UUID
    target: string; // UUID
    type: string;
    weight: number;
    description?: string | null;
}

export interface EntityNetworkResponse {
    entities: Record<string, EntityDetail>; // Key = UUID
    edges: NetworkEdge[];
}
