import React from 'react';
import { useTranslation } from 'react-i18next';
import type { EntityDetail, EntityEvent } from '@/types/entity';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/UI/avatar';
import { getBaseRoleLabel } from './entityTypeLabels';

interface Props {
  entity: EntityDetail;
  currentChapter: number;
  relationCount?: number;
  onClick?: () => void;
}

export const EntityMiniCard: React.FC<Props> = ({
  entity,
  currentChapter,
  relationCount = 0,
  onClick,
}) => {
  const { t } = useTranslation();
  const roleLabel = getBaseRoleLabel(entity.dynamic_role || entity.base_role);
  const summary = entity.visual_summary_clean || entity.visual_summary;
  const truncatedSummary = summary && summary.length > 80 ? summary.slice(0, 80) + '...' : summary;

  const lastEvent: EntityEvent | undefined = (entity.events || [])
    .filter((e) => e.chapter_number <= currentChapter)
    .sort((a, b) => b.chapter_number - a.chapter_number)[0];

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 p-3 rounded-xl ring-1 ring-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] max-w-[280px] text-left transition-colors"
    >
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarImage src={entity.avatar_url || undefined} />
        <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
          {entity.name[0]}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-serif font-medium text-sm text-[var(--color-text-default)] truncate">
            {entity.name}
          </span>
          {roleLabel && (
            <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">{roleLabel}</span>
          )}
        </div>
        {truncatedSummary && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2 italic">
            {truncatedSummary}
          </p>
        )}
        {lastEvent && (
          <p className="text-[10px] text-[var(--color-text-subtle)] mt-1 truncate italic">
            {lastEvent.event_action}
          </p>
        )}
        {relationCount > 0 && (
          <span className="text-[10px] text-[var(--color-text-disabled)]">
            {t('entities.relation_count', { count: relationCount })}
          </span>
        )}
      </div>
    </button>
  );
};
