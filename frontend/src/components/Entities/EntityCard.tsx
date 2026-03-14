import React from 'react';
import { useTranslation } from 'react-i18next';
import { EntityDetail } from '../../types/entity';
import { isEntityMetCFI } from '../../utils/entityUtils';
import { ChevronRight, User, MapPin, Box } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../UI/avatar';
import { cn } from '@/lib/utils';
import { entityTypeLabels, getBaseRoleLabel } from './entityTypeLabels';

interface EntityCardProps {
  entity: EntityDetail;
  currentChapter: number;
  currentCFI?: string | null;
  onClick?: () => void;
}

const TypeIcon: React.FC<{ type: string; className?: string }> = ({ type, className }) => {
  switch (type) {
    case 'location':
      return <MapPin className={className} />;
    case 'object':
      return <Box className={className} />;
    default:
      return <User className={className} />;
  }
};

const getEntityTypeColor = (type: string): string => {
  switch (type) {
    case 'character':
      return 'border-[var(--color-entity-character)]';
    case 'location':
      return 'border-[var(--color-entity-location)]';
    case 'object':
      return 'border-[var(--color-entity-object)]';
    default:
      return 'border-[var(--color-border-default)]';
  }
};

export const EntityCard: React.FC<EntityCardProps> = ({
  entity,
  currentChapter,
  currentCFI,
  onClick,
}) => {
  const { t } = useTranslation();
  const isMet = isEntityMetCFI(entity, currentCFI ?? null, currentChapter);
  const typeLabel = entityTypeLabels[entity.type] || entity.type;
  const roleLabel = getBaseRoleLabel(entity.dynamic_role || entity.base_role);
  const summary = entity.visual_summary_clean || entity.visual_summary;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isMet ? entity.name : `${entity.name} — ${t('entities.not_met')}`}
      className={cn(
        'w-full flex items-center text-left py-3.5 px-1 transition-colors rounded-lg',
        isMet ? 'hover:bg-[var(--color-bg-hover)]' : 'opacity-70 hover:opacity-90'
      )}
    >
      <Avatar
        className={cn(
          'h-12 w-12 mr-4 border-l-2',
          getEntityTypeColor(entity.type),
          !isMet && 'blur-[3px] brightness-75'
        )}
      >
        <AvatarImage src={entity.avatar_url || undefined} />
        <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
          {entity.avatar_url ? (
            entity.name ? (
              entity.name[0]
            ) : (
              '?'
            )
          ) : (
            <TypeIcon type={entity.type} className="w-5 h-5" />
          )}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3
            className={cn(
              'font-serif text-base font-medium truncate',
              isMet ? 'text-[var(--color-text-default)]' : 'text-[var(--color-text-muted)]'
            )}
          >
            {entity.name}
          </h3>
          {!isMet && (
            <span className="font-serif italic text-[var(--color-text-disabled)] text-sm">?</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            {typeLabel}
          </span>
          {roleLabel && isMet && (
            <span className="text-xs text-[var(--color-text-muted)]">· {roleLabel}</span>
          )}
        </div>

        {isMet && summary && (
          <p className="text-sm text-[var(--color-text-muted)] truncate mt-0.5 italic">
            {summary.length > 50 ? `${summary.slice(0, 50)}...` : summary}
          </p>
        )}
      </div>

      <ChevronRight
        className="text-[var(--color-text-disabled)] w-5 h-5 ml-2 shrink-0"
        aria-hidden="true"
      />
    </button>
  );
};
