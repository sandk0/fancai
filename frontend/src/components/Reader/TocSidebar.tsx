import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'motion/react';
import {
  X,
  ChevronRight,
  Search,
  User,
  Calendar,
  Globe,
  Copyright,
  Book as BookIcon,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Z_INDEX } from '@/lib/zIndex';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useIsMobile } from '@/hooks/shared/useIsMobile';
import { MobilePanel } from '@/components/UI/MobilePanel';
import { BookmarksList } from './BookmarksList';
import type { BookmarkResponse } from '@/hooks/api/useSync';
import type { BookDetail, BookMetadata as ApiBookMetadata } from '@/types/api';
import type { NavItem } from 'epubjs';

export type SidebarTab = 'toc' | 'notes' | 'info';

type MetadataUnion = BookDetail | ApiBookMetadata;

interface TocSidebarProps {
  toc: NavItem[];
  currentHref: string | null;
  onChapterClick: (href: string) => void;
  isOpen: boolean;
  onClose: () => void;
  chapterProgress?: Map<string, number>;
  totalChapters?: number;
  bookId?: string;
  bookmarks?: BookmarkResponse[];
  onNavigateToCfi?: (cfi: string, bookmarkId?: string) => void;
  onDeleteBookmark?: (bookmarkId: string, cfiRange: string) => void;
  onUpdateBookmarkNote?: (bookmarkId: string, note: string) => void;
  /** Book metadata for the Info tab */
  metadata?: MetadataUnion | null;
  /** Controlled active tab (overrides internal state) */
  activeTab?: SidebarTab;
  /** Callback when tab changes */
  onTabChange?: (tab: SidebarTab) => void;
}

const normalizeHref = (href: string) => href.split('#')[0].split('?')[0];

const ChapterItem: React.FC<{
  item: NavItem;
  currentHref: string | null;
  onChapterClick: (h: string) => void;
  level: number;
  index: number;
  progress?: number;
}> = ({ item, currentHref, onChapterClick, level, index }) => {
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
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }
            }}
            className="p-1"
            aria-label={isExpanded ? t('reader.toc.collapse') : t('reader.toc.expand')}
            aria-expanded={isExpanded}
          >
            <ChevronRight
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
          </span>
        )}
      </button>
      {hasSubitems && isExpanded && (
        <div className="space-y-1">
          {item.subitems!.map((sub, i) => (
            <ChapterItem
              key={i}
              item={sub}
              currentHref={currentHref}
              onChapterClick={onChapterClick}
              level={level + 1}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const VIRTUALIZATION_THRESHOLD = 20;
const ESTIMATED_TOC_ITEM_HEIGHT = 48;

/** BookInfo content for the info tab (no modal wrapper) */
const BookInfoContent: React.FC<{ metadata: MetadataUnion }> = ({ metadata }) => {
  const { t, i18n } = useTranslation();

  const author = metadata.author || '';
  const pubdate =
    'pubdate' in metadata
      ? metadata.pubdate
      : 'publish_date' in metadata
        ? metadata.publish_date
        : undefined;

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    try {
      return new Date(dateString).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const formattedDate = formatDate(pubdate);

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-foreground">{metadata.title}</h3>
        <div className="flex items-center gap-2 text-muted-foreground">
          <User className="h-4 w-4" aria-hidden="true" />
          <span className="text-base">{author}</span>
        </div>
      </div>

      {metadata.description && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            {t('reader.info.description')}
          </h4>
          <p className="text-foreground text-sm leading-relaxed">{metadata.description}</p>
        </div>
      )}

      <div className="space-y-3">
        {metadata.publisher && (
          <div className="flex items-start gap-3">
            <BookIcon className="h-5 w-5 mt-0.5 text-muted-foreground" aria-hidden="true" />
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">
                {t('reader.info.publisher')}
              </div>
              <div className="text-foreground text-sm">{metadata.publisher}</div>
            </div>
          </div>
        )}

        {formattedDate && (
          <div className="flex items-start gap-3">
            <Calendar className="h-5 w-5 mt-0.5 text-muted-foreground" aria-hidden="true" />
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">
                {t('reader.info.pubdate')}
              </div>
              <div className="text-foreground text-sm">{formattedDate}</div>
            </div>
          </div>
        )}

        {metadata.language && (
          <div className="flex items-start gap-3">
            <Globe className="h-5 w-5 mt-0.5 text-muted-foreground" aria-hidden="true" />
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">
                {t('reader.info.language')}
              </div>
              <div className="text-foreground text-sm">{metadata.language.toUpperCase()}</div>
            </div>
          </div>
        )}

        {'rights' in metadata && metadata.rights && (
          <div className="flex items-start gap-3">
            <Copyright className="h-5 w-5 mt-0.5 text-muted-foreground" aria-hidden="true" />
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">
                {t('reader.info.rights')}
              </div>
              <div className="text-foreground text-sm">{metadata.rights}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const TocSidebar: React.FC<TocSidebarProps> = React.memo(function TocSidebar({
  toc,
  currentHref,
  onChapterClick,
  isOpen,
  onClose,
  bookmarks = [],
  onNavigateToCfi,
  onDeleteBookmark,
  onUpdateBookmarkNote,
  metadata,
  activeTab: controlledTab,
  onTabChange,
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [internalTab, setInternalTab] = useState<SidebarTab>('toc');
  const currentTab = controlledTab ?? internalTab;
  const handleTabChange = useCallback(
    (tab: SidebarTab) => {
      setInternalTab(tab);
      onTabChange?.(tab);
    },
    [onTabChange]
  );

  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useFocusTrap(isOpen && !isMobile, sidebarRef);

  // Auto-focus search only on desktop
  useEffect(() => {
    if (isOpen && currentTab === 'toc' && !isMobile) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, currentTab, isMobile]);

  const filtered = useMemo(() => {
    if (!search.trim()) return toc;
    const q = search.toLowerCase();
    return toc.filter((i) => i.label.toLowerCase().includes(q));
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
    if (isOpen && currentTab === 'toc') setTimeout(scrollToActive, 200);
  }, [isOpen, scrollToActive, currentTab]);

  const handleNavigateToCfi = useCallback(
    (cfi: string, bookmarkId?: string) => {
      if (onNavigateToCfi) {
        onNavigateToCfi(cfi, bookmarkId);
        onClose();
      }
    },
    [onNavigateToCfi, onClose]
  );

  const handleChapterClick = useCallback(
    (href: string) => {
      onChapterClick(href);
      onClose();
    },
    [onChapterClick, onClose]
  );

  const tabs: { key: SidebarTab; label: string; count?: number }[] = [
    { key: 'toc', label: t('reader.sidebar.toc', 'Contents') },
    {
      key: 'notes',
      label: t('reader.sidebar.notes', 'Notes'),
      count: bookmarks.length,
    },
    { key: 'info', label: t('reader.sidebar.info', 'Info') },
  ];

  // Shared inner content: tabs, search, chapter list, bookmarks, info
  const sidebarContent = (
    <>
      {/* Tabs */}
      <div className="flex border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleTabChange(tab.key)}
            className={`flex-1 px-3 py-2.5 min-h-[44px] text-sm font-medium transition-colors relative ${
              currentTab === tab.key
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1 text-xs opacity-60">({tab.count})</span>
            )}
            {currentTab === tab.key && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Search (only for TOC tab) */}
      {currentTab === 'toc' && (
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
            <input
              ref={inputRef}
              type="text"
              placeholder={t('reader.toc.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 min-h-[44px] bg-muted rounded-lg"
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
        {currentTab === 'toc' && (
          <>
            {filtered.length === 0 ? (
              <p className="text-center py-10 opacity-50">{t('reader.toc.no_results')}</p>
            ) : useVirtual ? (
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
                    <ChapterItem
                      item={filtered[virtualItem.index]}
                      currentHref={currentHref}
                      onChapterClick={handleChapterClick}
                      level={0}
                      index={virtualItem.index}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map((item, i) => (
                  <ChapterItem
                    key={i}
                    item={item}
                    currentHref={currentHref}
                    onChapterClick={handleChapterClick}
                    level={0}
                    index={i}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {currentTab === 'notes' && (
          <BookmarksList
            bookmarks={bookmarks}
            onNavigate={handleNavigateToCfi}
            onDelete={onDeleteBookmark || (() => {})}
            onUpdateNote={onUpdateBookmarkNote || (() => {})}
          />
        )}

        {currentTab === 'info' && metadata && <BookInfoContent metadata={metadata} />}
      </div>
    </>
  );

  // Mobile: vaul bottom-sheet via MobilePanel
  if (isMobile) {
    return (
      <MobilePanel
        isOpen={isOpen}
        onClose={onClose}
        title={tabs.find((t) => t.key === currentTab)?.label || t('reader.sidebar.toc', 'Contents')}
        snapPoints={[0.5, 0.9]}
      >
        {sidebarContent}
      </MobilePanel>
    );
  }

  // Desktop: slide-in side panel (original behavior)
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            style={{ zIndex: Z_INDEX.sidebar }}
            onClick={onClose}
          />
          <m.div
            ref={sidebarRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('reader.toc.aria_label', 'Table of contents')}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            className="fixed top-0 right-0 h-full w-96 bg-background shadow-xl flex flex-col pt-safe pb-safe"
            style={{ zIndex: Z_INDEX.modal }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-bold">{tabs.find((t) => t.key === currentTab)?.label}</h2>
              <button
                onClick={onClose}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-muted rounded-lg"
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {sidebarContent}
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
});
