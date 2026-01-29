import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, Search } from 'lucide-react';
import { Z_INDEX } from '@/lib/zIndex';
import type { NavItem } from 'epubjs';

interface TocSidebarProps {
  toc: NavItem[];
  currentHref: string | null;
  onChapterClick: (href: string) => void;
  isOpen: boolean;
  onClose: () => void;
  chapterProgress?: Map<string, number>;
  totalChapters?: number;
}

const normalizeHref = (href: string) => href.split('#')[0].split('?')[0];

const ChapterItem: React.FC<{ item: NavItem; currentHref: string | null; onChapterClick: (h: string) => void; level: number; index: number; progress?: number }> = ({
  item, currentHref, onChapterClick, level, index,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const hasSubitems = item.subitems && item.subitems.length > 0;
  const isActive = currentHref && normalizeHref(item.href) === normalizeHref(currentHref);

  return (
    <div className={level > 0 ? 'ml-4' : ''}>
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-muted'}`}
        onClick={() => onChapterClick(item.href)}
      >
        <span className="text-xs opacity-50 w-6">{index + 1}</span>
        <span className="flex-1 text-sm truncate">{item.label || t('reader.toc.untitled')}</span>
        {hasSubitems && (
          <button onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} className="p-1">
            <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      {hasSubitems && isExpanded && (
        <div className="space-y-1">
          {item.subitems!.map((sub, i) => <ChapterItem key={i} item={sub} currentHref={currentHref} onChapterClick={onChapterClick} level={level + 1} index={i} />)}
        </div>
      )}
    </div>
  );
};

export const TocSidebar: React.FC<TocSidebarProps> = ({ toc, currentHref, onChapterClick, isOpen, onClose }) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 100); }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search.trim()) return toc;
    const q = search.toLowerCase();
    return toc.filter(i => i.label.toLowerCase().includes(q));
  }, [toc, search]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm" style={{ zIndex: Z_INDEX.sidebar }} onClick={onClose} />
          <m.div role="navigation" aria-label={t('reader.toc.aria_label', 'Table of contents')} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="fixed top-0 right-0 h-full w-full md:w-96 bg-background shadow-xl flex flex-col" style={{ zIndex: Z_INDEX.modal }}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-bold">{t('reader.toc.title')}</h2>
              <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
                <input ref={inputRef} type="text" placeholder={t('reader.toc.search_placeholder')} value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-muted rounded-lg" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? <p className="text-center py-10 opacity-50">{t('reader.toc.no_results')}</p> : (
                <div className="space-y-1">
                  {filtered.map((item, i) => <ChapterItem key={i} item={item} currentHref={currentHref} onChapterClick={onChapterClick} level={0} index={i} />)}
                </div>
              )}
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
};
