export type EntityType = 'character' | 'location' | 'object' | 'action' | 'atmosphere';

export interface EntityNote {
    text: string;
    chapter_index: number;
    cfi?: string | null;
    is_spoiler: boolean;
    type: string;
}

export interface EntityDetail {
    id: string;
    name: string;
    type: EntityType | string;
    avatar_url?: string | null;
    visual_summary?: string | null;
    importance: number;

    mentions: number[];
    first_mention_cfi?: string | null;
    first_mention_offset?: number | null;
    notes: EntityNote[];
}

export interface NetworkEdge {
    source: string;
    target: string;
    type: string;
    weight: number;
    description?: string | null;
    first_interaction_cfi?: string | null;
    first_interaction_chapter?: number | null;
}

export interface EntityNetworkResponse {
    entities: Record<string, EntityDetail>; // Key = UUID
    edges: NetworkEdge[];
}
