import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, m } from 'motion/react';
import { EntityDetail, NetworkEdge } from '../../types/entity';
import { EntityProfile } from './EntityProfile';
import { EntityList } from './EntityList';
import { RelationshipCard } from './RelationshipCard';
import { MobilePanel } from '../UI/MobilePanel';
import { useIsMobile } from '@/hooks/shared/useIsMobile';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Z_INDEX } from '@/lib/zIndex';
import { X, ChevronRight } from 'lucide-react';

interface SelectedRelationship {
  edge: NetworkEdge;
  sourceEntity: EntityDetail;
  targetEntity: EntityDetail;
}

type ViewLevel = 'list' | 'profile' | 'relationship';

interface EntityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  entities: Record<string, EntityDetail>;
  edges: NetworkEdge[];
  currentChapter: number;
  maxChapterReached: number;
  currentCFI?: string | null;
  initialEntityId?: string | null;
  isLoading?: boolean;
}

export const EntityDrawer: React.FC<EntityDrawerProps> = ({
  isOpen,
  onClose,
  entities,
  edges,
  currentChapter,
  currentCFI,
  initialEntityId,
  isLoading = false,
  maxChapterReached,
}) => {
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(initialEntityId || null);
  const [selectedRelationship, setSelectedRelationship] = useState<SelectedRelationship | null>(
    null
  );
  const [navigationDirection, setNavigationDirection] = useState<'forward' | 'backward'>('forward');
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(isOpen && !isMobile, panelRef);

  const effectiveChapter = Math.max(currentChapter, maxChapterReached || 0);

  const [prevOpen, setPrevOpen] = useState(isOpen);
  const [prevEntityId, setPrevEntityId] = useState(initialEntityId);
  if (prevOpen !== isOpen || prevEntityId !== initialEntityId) {
    setPrevOpen(isOpen);
    setPrevEntityId(initialEntityId);
    if (isOpen && initialEntityId) {
      setSelectedEntityId(initialEntityId);
      setSelectedRelationship(null);
    } else if (isOpen && !initialEntityId) {
      setSelectedEntityId(null);
      setSelectedRelationship(null);
    }
  }

  const relationships = React.useMemo(() => {
    if (!selectedEntityId || !edges) return [];
    return edges
      .filter((e) => e.source === selectedEntityId || e.target === selectedEntityId)
      .map((e) => {
        const otherId = e.source === selectedEntityId ? e.target : e.source;
        return {
          entity: entities[otherId],
          type: e.type,
          description: e.description,
          edge: e,
        };
      })
      .filter((r) => r.entity);
  }, [selectedEntityId, edges, entities]);

  const handleRelationshipClick = (
    edge: NetworkEdge,
    sourceEntity: EntityDetail,
    targetEntity: EntityDetail
  ) => {
    setNavigationDirection('forward');
    setSelectedRelationship({ edge, sourceEntity, targetEntity });
  };

  const handleEntitySelect = (id: string) => {
    setNavigationDirection('forward');
    setSelectedEntityId(id);
  };

  const handleBreadcrumbNavigate = (level: ViewLevel) => {
    setNavigationDirection('backward');
    if (level === 'list') {
      setSelectedEntityId(null);
      setSelectedRelationship(null);
    } else if (level === 'profile') {
      setSelectedRelationship(null);
    }
  };

  const currentView: ViewLevel = selectedRelationship
    ? 'relationship'
    : selectedEntityId
      ? 'profile'
      : 'list';

  const slideVariants = {
    enter: (direction: 'forward' | 'backward') => ({
      x: direction === 'forward' ? 60 : -60,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: 'forward' | 'backward') => ({
      x: direction === 'forward' ? -60 : 60,
      opacity: 0,
    }),
  };

  const selectedEntity = selectedEntityId ? entities[selectedEntityId] : null;

  // Breadcrumb — shown only on desktop (mobile uses MobilePanel title)
  const breadcrumb = (
    <nav className="flex items-center gap-1 text-sm min-w-0 flex-1" aria-label="Breadcrumb">
      <button
        onClick={() => handleBreadcrumbNavigate('list')}
        className={`shrink-0 transition-colors ${
          currentView === 'list'
            ? 'font-medium text-[var(--color-text-default)]'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-default)]'
        }`}
      >
        {t('entityDrawer.title')}
      </button>
      {selectedEntity && (
        <>
          <ChevronRight className="w-3 h-3 text-[var(--color-text-disabled)] shrink-0" />
          <button
            onClick={() => handleBreadcrumbNavigate('profile')}
            className={`font-serif truncate transition-colors ${
              currentView === 'profile'
                ? 'font-medium text-[var(--color-text-default)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-default)]'
            }`}
          >
            {selectedEntity.name}
          </button>
        </>
      )}
      {selectedRelationship && (
        <>
          <ChevronRight className="w-3 h-3 text-[var(--color-text-disabled)] shrink-0" />
          <span className="font-serif text-[var(--color-text-default)] font-medium truncate">
            {selectedRelationship.targetEntity.name}
          </span>
        </>
      )}
    </nav>
  );

  // Animated content views — shared between mobile and desktop
  const animatedViews = (
    <div className="flex-1 overflow-hidden relative min-h-0">
      <AnimatePresence mode="wait" custom={navigationDirection} initial={false}>
        {selectedRelationship ? (
          <m.div
            key="relationship"
            custom={navigationDirection}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="h-full overflow-auto px-4 pt-3 pb-20"
          >
            <RelationshipCard
              edge={selectedRelationship.edge}
              sourceEntity={selectedRelationship.sourceEntity}
              targetEntity={selectedRelationship.targetEntity}
              currentChapter={effectiveChapter}
              currentCFI={currentCFI}
              onEntityClick={(id) => {
                setNavigationDirection('forward');
                setSelectedRelationship(null);
                setSelectedEntityId(id);
              }}
            />
          </m.div>
        ) : selectedEntityId && entities[selectedEntityId] ? (
          <m.div
            key={`profile-${selectedEntityId}`}
            custom={navigationDirection}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="h-full"
          >
            <EntityProfile
              entity={entities[selectedEntityId]}
              relatedEntities={relationships}
              onEntityClick={handleEntitySelect}
              onRelationshipClick={handleRelationshipClick}
              currentChapter={effectiveChapter}
              currentCFI={currentCFI}
            />
          </m.div>
        ) : (
          <m.div
            key="list"
            custom={navigationDirection}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="h-full"
          >
            <EntityList
              entities={entities}
              currentChapter={effectiveChapter}
              currentCFI={currentCFI}
              onEntitySelect={handleEntitySelect}
              isLoading={isLoading}
            />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );

  // Mobile: Vaul bottom drawer via MobilePanel
  // Single snap point to prevent false swipe-to-collapse
  if (isMobile) {
    return (
      <MobilePanel
        isOpen={isOpen}
        onClose={onClose}
        title={t('entityDrawer.title')}
        snapPoints={[0.92]}
        defaultSnap={0.92}
      >
        {/* Mobile breadcrumb — only when not on list view */}
        {currentView !== 'list' && <div className="px-4 pb-2 flex-shrink-0">{breadcrumb}</div>}
        {animatedViews}
      </MobilePanel>
    );
  }

  // Desktop: side panel from right
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
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('entityDrawer.title')}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 h-full w-[420px] bg-[var(--color-bg-base)] shadow-xl flex flex-col pt-safe pb-safe border-l border-[var(--color-border-default)]"
            style={{ zIndex: Z_INDEX.modal }}
          >
            {/* Desktop header */}
            <div className="flex items-center gap-2 px-5 pt-5 pb-3 flex-shrink-0">
              {breadcrumb}
              <button
                onClick={onClose}
                className="p-2 rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-default)] transition-colors shrink-0"
              >
                <X size={18} />
              </button>
            </div>
            {animatedViews}
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
};
