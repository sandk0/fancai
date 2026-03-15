import React from 'react';
import { useTranslation } from 'react-i18next';
import { EntityDetail, NetworkEdge } from '../../types/entity';
import { isEntityMetCFI } from '../../utils/entityUtils';
import { entityTypeLabels, getBaseRoleLabel } from './entityTypeLabels';
import { EntityEventTimeline } from './EntityEventTimeline';
import { ScrollArea } from '../UI/scroll-area';
import { Avatar, AvatarImage, AvatarFallback } from '../UI/avatar';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';

interface RelationItem {
  entity: EntityDetail;
  type: string;
  description?: string | null;
  edge?: NetworkEdge;
}

interface EntityProfileProps {
  entity: EntityDetail;
  currentChapter: number;
  currentCFI?: string | null;
  relatedEntities?: RelationItem[];
  onEntityClick?: (id: string) => void;
  onRelationshipClick?: (
    edge: NetworkEdge,
    sourceEntity: EntityDetail,
    targetEntity: EntityDetail
  ) => void;
}

const getEntityTypeColor = (type: string): string => {
  switch (type) {
    case 'character':
      return 'border-[var(--color-entity-character)]';
    case 'location':
      return 'border-[var(--color-entity-location)]';
    case 'object':
      return 'border-[var(--color-entity-object)]';
    default:
      return 'border-[var(--color-accent-500)]';
  }
};

export const EntityProfile: React.FC<EntityProfileProps> = ({
  entity,
  currentChapter,
  currentCFI,
  relatedEntities = [],
  onEntityClick,
  onRelationshipClick,
}) => {
  const { t } = useTranslation();
  const isUnknown = !isEntityMetCFI(entity, currentCFI ?? null, currentChapter);
  const roleLabel = getBaseRoleLabel(entity.dynamic_role || entity.base_role);
  const biography = entity.biography;
  const appearance = entity.visual_summary_clean || entity.visual_summary;
  const events = entity.events || [];

  return (
    <div className="bg-[var(--color-bg-base)] text-[var(--color-text-default)] h-full flex flex-col">
      {/* Hero section */}
      <div className={cn('relative w-full flex-shrink-0', entity.avatar_url ? 'h-48' : '')}>
        {entity.avatar_url ? (
          <>
            <img
              src={entity.avatar_url}
              alt={entity.name}
              className={cn(
                'w-full h-full object-cover transition-all duration-700',
                isUnknown && 'blur-[3px] brightness-75'
              )}
            />
            {/* Gradient overlay — bottom 30% */}
            <div
              className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-base)] via-transparent to-transparent"
              style={{ top: '70%' }}
            />
            <div className="absolute bottom-0 left-0 p-5 w-full">
              <h1 className="text-2xl font-serif font-bold text-[var(--color-text-default)] drop-shadow-md flex items-center gap-3">
                {entity.name}
                {isUnknown && (
                  <span className="font-serif italic text-lg text-[var(--color-text-disabled)]">
                    ?
                  </span>
                )}
              </h1>
            </div>
          </>
        ) : (
          <div className="px-5 pt-4 pb-3">
            <h1 className="text-2xl font-serif font-bold text-[var(--color-text-default)] flex items-center gap-3">
              {entity.name}
              {isUnknown && (
                <span className="font-serif italic text-lg text-[var(--color-text-disabled)]">
                  ?
                </span>
              )}
            </h1>
            <div className="mt-3 border-t border-[var(--color-border-subtle)]" />
          </div>
        )}
      </div>

      {/* Metadata line */}
      <div className="flex items-center gap-2 flex-wrap px-5 py-2">
        <span
          className={cn(
            'text-xs uppercase tracking-widest font-medium border-l-2 pl-2',
            getEntityTypeColor(entity.type)
          )}
        >
          {entityTypeLabels[entity.type] || entity.type}
        </span>
        {roleLabel && !isUnknown && (
          <span className="text-xs text-[var(--color-text-muted)]">· {roleLabel}</span>
        )}
        {entity.first_mention_chapter != null && !isUnknown && (
          <span className="text-xs text-[var(--color-text-subtle)]">
            · {t('entities.first_appearance', { chapter: entity.first_mention_chapter })}
          </span>
        )}
        {isUnknown && (
          <span className="text-xs text-[var(--color-text-muted)]">· {t('entities.not_met')}</span>
        )}
      </div>

      <ScrollArea className="flex-1 px-5">
        <div className="space-y-5 pb-8">
          {/* Biography */}
          {!isUnknown && biography && (
            <section>
              <h3 className="font-serif text-sm uppercase tracking-widest text-[var(--color-text-disabled)] mb-2">
                {t('entities.about')}
              </h3>
              <div className="mb-3 border-t border-[var(--color-border-subtle)]" />
              <p className="text-sm text-[var(--color-text-default)] leading-relaxed">
                {biography}
              </p>
            </section>
          )}

          {/* Appearance — blockquote style */}
          {appearance && (
            <section>
              <h3 className="font-serif text-sm uppercase tracking-widest text-[var(--color-text-disabled)] mb-2">
                {t('entities.appearance')}
              </h3>
              <div className="mb-3 border-t border-[var(--color-border-subtle)]" />
              <p className="border-l-2 border-[var(--color-accent-500)]/30 pl-4 font-serif italic text-sm text-[var(--color-text-muted)]">
                {appearance}
              </p>
            </section>
          )}

          {/* Aliases — comma-separated serif italic */}
          {entity.aliases && entity.aliases.length > 0 && !isUnknown && (
            <section>
              <h3 className="font-serif text-sm uppercase tracking-widest text-[var(--color-text-disabled)] mb-2">
                {t('entities.aliases_section')}
              </h3>
              <div className="mb-3 border-t border-[var(--color-border-subtle)]" />
              <p className="font-serif italic text-sm text-[var(--color-text-muted)]">
                {entity.aliases.join(', ')}
              </p>
            </section>
          )}

          {/* Relations — editorial rows */}
          {!isUnknown && relatedEntities.length > 0 && (
            <section aria-labelledby="relations-heading">
              <h3
                id="relations-heading"
                className="font-serif text-sm uppercase tracking-widest text-[var(--color-text-disabled)] mb-2"
              >
                {t('entities.relations')}
              </h3>
              <div className="mb-3 border-t border-[var(--color-border-subtle)]" />
              <div className="space-y-0" role="list">
                {relatedEntities.map((rel, idx) => {
                  const isRelMet = isEntityMetCFI(rel.entity, currentCFI ?? null, currentChapter);
                  const hasEdge = rel.edge && onRelationshipClick;

                  const handleClick = () => {
                    if (!isRelMet) return;
                    if (hasEdge && rel.edge) {
                      onRelationshipClick(rel.edge, entity, rel.entity);
                    } else {
                      onEntityClick?.(rel.entity.id);
                    }
                  };

                  return (
                    <React.Fragment key={rel.entity.id + idx}>
                      <button
                        type="button"
                        role="listitem"
                        onClick={handleClick}
                        aria-label={`${rel.entity.name} — ${rel.type}`}
                        className={cn(
                          'w-full flex items-center text-left py-3 transition-colors rounded-lg',
                          isRelMet ? 'hover:bg-[var(--color-bg-hover)]' : 'opacity-60'
                        )}
                      >
                        <Avatar className={cn('h-8 w-8 mr-3', !isRelMet && 'blur-[2px]')}>
                          {rel.entity.avatar_url && <AvatarImage src={rel.entity.avatar_url} />}
                          <AvatarFallback className="text-xs bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
                            {rel.entity.name[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'font-serif text-sm font-medium truncate',
                                isRelMet
                                  ? 'text-[var(--color-text-default)]'
                                  : 'text-[var(--color-text-muted)]'
                              )}
                            >
                              {rel.entity.name}
                            </span>
                            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                              {rel.type}
                            </span>
                          </div>
                          {rel.description && (
                            <p className="text-xs text-[var(--color-text-subtle)] truncate mt-0.5">
                              {rel.description}
                            </p>
                          )}
                        </div>
                        {isRelMet && (
                          <ChevronRight
                            className="w-4 h-4 text-[var(--color-text-disabled)] ml-2 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                      {idx < relatedEntities.length - 1 && (
                        <div className="mx-2 border-t border-[var(--color-border-subtle)]" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </section>
          )}

          {/* Events timeline */}
          {!isUnknown && events.length > 0 && (
            <section aria-labelledby="events-heading">
              <h3
                id="events-heading"
                className="font-serif text-sm uppercase tracking-widest text-[var(--color-text-disabled)] mb-2"
              >
                {t('entities.by_chapters')}
              </h3>
              <div className="mb-4 border-t border-[var(--color-border-subtle)]" />
              <EntityEventTimeline events={entity.events || []} currentChapter={currentChapter} />
            </section>
          )}

          {/* Spoiler state — soft with ? */}
          {isUnknown && (
            <div className="text-center space-y-4 py-8">
              <div className="w-16 h-16 rounded-full bg-[var(--color-spoiler-overlay)] flex items-center justify-center mx-auto">
                <span className="font-serif italic text-3xl text-[var(--color-text-disabled)]">
                  ?
                </span>
              </div>
              <h4 className="font-serif text-[var(--color-text-default)] font-medium">
                {t('entities.info_hidden')}
              </h4>
              <p className="text-[var(--color-text-muted)] text-sm max-w-[280px] mx-auto">
                {t('entities.info_hidden_desc')}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
