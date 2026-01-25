import { EntityDetail, EntityNote } from '../types/entity';
import { isValidCFI, isCFIBefore } from './cfiUtils';

export const isEntityMet = (entity: EntityDetail, currentChapter?: number): boolean => {
    if (!entity) return false;

    const mentions = entity.mentions || [];
    
    if (mentions.length === 0) {
        return true;
    }

    const firstMeeting = Math.min(...mentions);
    const safeChapter = currentChapter ?? 0;

    return safeChapter >= firstMeeting;
};

export const isEntityMetCFI = (
    entity: EntityDetail,
    currentCFI: string | null,
    currentChapter?: number
): boolean => {
    if (!entity) return false;

    if (isValidCFI(currentCFI) && isValidCFI(entity.first_mention_cfi)) {
        return isCFIBefore(entity.first_mention_cfi!, currentCFI!);
    }

    return isEntityMet(entity, currentChapter);
};

export const isNoteSpoiler = (note: EntityNote, currentChapter?: number): boolean => {
    const safeChapter = currentChapter ?? 0;
    return note.chapter_index > safeChapter;
};

export const isNoteSpoilerCFI = (
    note: EntityNote,
    currentCFI: string | null,
    currentChapter?: number
): boolean => {
    if (isValidCFI(currentCFI) && isValidCFI(note.cfi)) {
        return !isCFIBefore(note.cfi!, currentCFI!);
    }
    
    return isNoteSpoiler(note, currentChapter);
};

export const getFirstMeetingChapter = (entity: EntityDetail): number => {
    if (!entity.mentions || entity.mentions.length === 0) return 9999;
    return Math.min(...entity.mentions);
};
