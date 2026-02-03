import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, Search } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Z_INDEX } from '@/lib/zIndex';
import { useFocusTrap } from '@/hooks/useFocusTrap';
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
      <button
        type="button"
        className={`flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-xl cursor-pointer w-full text-left ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-muted'}`}
        onClick={() => onChapterClick(item.href)}
      >
        <span className="text-xs opacity-50 w-6">{index + 1}</span>
        <span className="flex-1 text-sm truncate">{item.label || t('reader.toc.untitled')}</span>
        {hasSubitems && (
          <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setIsExpanded(!isExpanded); }}} className="p-1" aria-label={isExpanded ? t('reader.toc.collapse') : t('reader.toc.expand')} aria-expanded={isExpanded}>
            <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} aria-hidden="true" />
          </span>
        )}
      </button>
      {hasSubitems && isExpanded && (
        <div className="space-y-1">
          {item.subitems!.map((sub, i) => <ChapterItem key={i} item={sub} currentHref={currentHref} onChapterClick={onChapterClick} level={level + 1} index={i} />)}
        </div>
      )}
    </div>
  );
};

const VIRTUALIZATION_THRESHOLD = 20;
const ESTIMATED_TOC_ITEM_HEIGHT = 48;

export const TocSidebar: React.FC<TocSidebarProps> = React.memo(function TocSidebar({ toc, currentHref, onChapterClick, isOpen, onClose }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useFocusTrap(isOpen, sidebarRef);

  useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 100); }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search.trim()) return toc;
    const q = search.toLowerCase();
    return toc.filter(i => i.label.toLowerCase().includes(q));
  }, [toc, search]);

  const useVirtual = filtered.length > VIRTUALIZATION_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_TOC_ITEM_HEIGHT,
    overscan: 5,
    enabled: useVirtual,
  });

  const scrollToActive = useCallback(() => {
    if (!currentHref || !useVirtual) return;
    const activeIndex = filtered.findIndex(
      (item) => normalizeHref(item.href) === normalizeHref(currentHref)
    );
    if (activeIndex >= 0) {
      rowVirtualizer.scrollToIndex(activeIndex, { align: 'center' });
    }
  }, [currentHref, filtered, rowVirtualizer, useVirtual]);

  useEffect(() => {
    if (isOpen) setTimeout(scrollToActive, 200);
  }, [isOpen, scrollToActive]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm" style={{ zIndex: Z_INDEX.sidebar }} onClick={onClose} />
          <m.div ref={sidebarRef} role="dialog" aria-modal="true" aria-label={t('reader.toc.aria_label', 'Table of contents')} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="fixed top-0 right-0 h-full w-full md:w-96 bg-background shadow-xl flex flex-col pt-safe pb-safe" style={{ zIndex: Z_INDEX.modal }}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-bold">{t('reader.toc.title')}</h2>
              <button onClick={onClose} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-muted rounded-lg" aria-label={t('common.close')}><X className="w-5 h-5" aria-hidden="true" /></button>
            </div>
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
                <input ref={inputRef} type="text" placeholder={t('reader.toc.search_placeholder')} value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 min-h-[44px] bg-muted rounded-lg" />
              </div>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? <p className="text-center py-10 opacity-50">{t('reader.toc.no_results')}</p> : useVirtual ? (
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => (
                    <div
                      key={virtualItem.key}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <ChapterItem item={filtered[virtualItem.index]} currentHref={currentHref} onChapterClick={onChapterClick} level={0} index={virtualItem.index} />
                    </div>
                  ))}
                </div>
              ) : (
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
});
