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
        return { entity: entities[otherId], type: e.type, description: e.description, edge: e };
      })
      .filter((r) => r.entity);
  }, [selectedEntityId, edges, entities]);

  const handleRelationshipClick = (
    edge: NetworkEdge,
    sourceEntity: EntityDetail,
    targetEntity: EntityDetail
  ) => {
    setSelectedRelationship({ edge, sourceEntity, targetEntity });
  };

  const handleEntitySelect = (id: string) => {
    setSelectedEntityId(id);
  };

  const handleBreadcrumbNavigate = (level: ViewLevel) => {
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

  const selectedEntity = selectedEntityId ? entities[selectedEntityId] : null;

  const breadcrumb = (
    <nav className="flex items-center gap-1.5 text-sm min-w-0 flex-1" aria-label="Breadcrumb">
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

  // Simple fade transition — absolute positioning ensures consistent height
  const contentViews = (
    <div className="flex-1 relative min-h-0 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {selectedRelationship ? (
          <m.div
            key="relationship"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 overflow-auto px-5 pt-4 pb-8"
          >
            <RelationshipCard
              edge={selectedRelationship.edge}
              sourceEntity={selectedRelationship.sourceEntity}
              targetEntity={selectedRelationship.targetEntity}
              currentChapter={effectiveChapter}
              currentCFI={currentCFI}
              onEntityClick={(id) => {
                setSelectedRelationship(null);
                setSelectedEntityId(id);
              }}
            />
          </m.div>
        ) : selectedEntityId && entities[selectedEntityId] ? (
          <m.div
            key={`profile-${selectedEntityId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0"
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0"
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

  // Mobile: Vaul bottom drawer
  // handleOnly=true prevents false dismiss when scrolling content
  if (isMobile) {
    return (
      <MobilePanel
        isOpen={isOpen}
        onClose={onClose}
        title={t('entityDrawer.title')}
        snapPoints={[0.92]}
        defaultSnap={0.92}
        handleOnly
      >
        {currentView !== 'list' && <div className="px-5 pt-3 pb-3 flex-shrink-0">{breadcrumb}</div>}
        {contentViews}
      </MobilePanel>
    );
  }

  // Desktop: side panel
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
            <div className="flex items-center gap-2 px-5 pt-5 pb-3 flex-shrink-0">
              {breadcrumb}
              <button
                onClick={onClose}
                className="p-2 rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-default)] transition-colors shrink-0"
              >
                <X size={18} />
              </button>
            </div>
            {contentViews}
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
};
