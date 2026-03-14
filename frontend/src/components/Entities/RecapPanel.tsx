import React from 'react';
import { useTranslation } from 'react-i18next';
import { useRecap } from '@/hooks/api/useRecap';
import { Avatar, AvatarImage, AvatarFallback } from '../UI/avatar';

interface Props {
  bookId: string;
  currentChapter: number;
  onEntityClick?: (entityId: string) => void;
}

export const RecapPanel: React.FC<Props> = ({ bookId, currentChapter, onEntityClick }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useRecap(bookId, currentChapter);

  if (isLoading || !data?.entities?.length) return null;

  return (
    <section className="space-y-3">
      <h3 className="font-serif text-sm uppercase tracking-widest text-[var(--color-text-disabled)]">
        {t('entities.recap_title')}
      </h3>
      <div className="border-t border-[var(--color-border-subtle)]" />
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
        {data.entities.map((entity) => (
          <button
            key={entity.id}
            type="button"
            onClick={() => onEntityClick?.(entity.id)}
            className="min-w-[140px] max-w-[160px] shrink-0 flex flex-col items-center text-center p-3 rounded-xl ring-1 ring-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Avatar className="h-12 w-12 mb-2">
              {entity.avatar_url && <AvatarImage src={entity.avatar_url} />}
              <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]">
                {entity.name[0]}
              </AvatarFallback>
            </Avatar>
            <span className="font-serif text-xs font-medium text-[var(--color-text-default)] truncate w-full">
              {entity.name}
            </span>
            {entity.dynamic_role && (
              <span className="text-[9px] text-[var(--color-text-muted)] mt-1">
                {entity.dynamic_role}
              </span>
            )}
            {entity.last_event && (
              <p className="text-[10px] text-[var(--color-text-subtle)] mt-1 line-clamp-2 italic">
                {entity.last_event.event_action}
              </p>
            )}
          </button>
        ))}
      </div>
    </section>
  );
};
