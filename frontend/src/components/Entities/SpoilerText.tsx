import React, { useState } from 'react';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';

interface SpoilerTextProps {
    text: string;
    chapterIndex: number;
    currentChapter: number;
    forceReveal?: boolean;
}

export const SpoilerText: React.FC<SpoilerTextProps> = ({
    text,
    chapterIndex,
    currentChapter,
    forceReveal = false
}) => {
    const isSpoiler = !forceReveal && chapterIndex > currentChapter;
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
            className="cursor-pointer select-none rounded bg-gray-800 text-transparent hover:bg-gray-700 transition-colors px-1"
            title="Spoiler! Click to reveal"
        >
            {/* Render redacted blocks roughly matching text length */}
            {Array(Math.ceil(text.length / 8)).fill('████').join(' ')}
        </span>
    );
};
