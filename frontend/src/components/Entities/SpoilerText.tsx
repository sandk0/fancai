import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { isNoteSpoilerCFI } from '../../utils/entityUtils';

interface SpoilerTextProps {
    text: string;
    chapterIndex: number;
    currentChapter: number;
    noteCfi?: string | null;
    currentCfi?: string | null;
    forceReveal?: boolean;
}

export const SpoilerText: React.FC<SpoilerTextProps> = ({
    text,
    chapterIndex,
    currentChapter,
    noteCfi,
    currentCfi,
    forceReveal = false
}) => {
    const isSpoiler = !forceReveal && isNoteSpoilerCFI(
        { text, chapter_index: chapterIndex, cfi: noteCfi, is_spoiler: false, type: '' },
        currentCfi ?? null,
        currentChapter
    );
    const [isRevealed, setIsRevealed] = useState(false);

    if (!isSpoiler || isRevealed) {
        return (
            <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-gray-100"
            >
                {text}
            </motion.span>
        );
    }

    return (
        <span
            onClick={() => setIsRevealed(true)}
            className="cursor-pointer select-none rounded bg-white/10 text-transparent hover:bg-white/20 transition-colors px-1 backdrop-blur-sm"
            title="Spoiler! Click to reveal"
        >
            {/* Render redacted blocks roughly matching text length */}
            {Array(Math.ceil(text.length / 8)).fill('████').join(' ')}
        </span>
    );
};
