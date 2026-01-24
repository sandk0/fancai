import { EntityDetail, EntityNote } from '../types/entity';

/**
 * Utility to determine if an entity should be considered "met" by the user.
 * 
 * Logic:
 * 1. If mentions are empty => Defaults to 9999 (Hidden), BUT if importance > 7 we might want to show it?
 *    For now, stick to standard logic: Hidden.
 * 2. If currentChapter >= firstMention => Met.
 * 3. Fail-safe: If currentChapter is undefined/null, treat as 0.
 * 
 * @param entity The entity object
 * @param currentChapter The current chapter number (1-based usually)
 * @returns boolean
 */
export const isEntityMet = (entity: EntityDetail, currentChapter?: number): boolean => {
    if (!entity) return false;

    const mentions = entity.mentions || [];
    // If no mentions, effectively never met (unless we change policy)
    // Note: Backend might send empty mentions if parsing failed. 
    // The UI handles "Met" vs "Unknown" display.
    if (mentions.length === 0) {
        // Fail-Open Strategy: If backend didn't parse mentions (or legacy data),
        // we assume the character is VISIBLE rather than hiding them.
        // Better to show a spoiler than an empty screen.
        return true;
    }

    const firstMeeting = Math.min(...mentions);
    const safeChapter = currentChapter ?? 0;

    return safeChapter >= firstMeeting;
};

/**
 * Utility to determine if a specific note (lore) is a spoiler.
 * 
 * @param note The note object
 * @param currentChapter The current chapter number
 * @returns boolean
 */
export const isNoteSpoiler = (note: EntityNote, currentChapter?: number): boolean => {
    const safeChapter = currentChapter ?? 0;
    return note.chapter_index > safeChapter;
};

/**
 * Helper to get the first meeting chapter number safely.
 */
export const getFirstMeetingChapter = (entity: EntityDetail): number => {
    if (!entity.mentions || entity.mentions.length === 0) return 9999;
    return Math.min(...entity.mentions);
};
