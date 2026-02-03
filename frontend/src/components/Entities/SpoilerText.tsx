import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    const { t } = useTranslation();
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
                className="text-[var(--color-text-default)]"
            >
                {text}
            </motion.span>
        );
    }

    return (
        <span
            onClick={() => setIsRevealed(true)}
            className="cursor-pointer select-none rounded bg-[var(--color-bg-elevated)] text-transparent hover:bg-[var(--color-bg-hover)] transition-colors px-1 backdrop-blur-sm"
            title={t('entities.spoiler_click_to_reveal')}
        >
            {/* Render redacted blocks roughly matching text length */}
            {Array(Math.ceil(text.length / 8)).fill('████').join(' ')}
        </span>
    );
};
