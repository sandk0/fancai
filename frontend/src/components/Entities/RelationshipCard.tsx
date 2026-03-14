import React from 'react';
import { useTranslation } from 'react-i18next';
import { EntityDetail, NetworkEdge } from '../../types/entity';
import { isEntityMetCFI } from '../../utils/entityUtils';
import { isValidCFI, isCFIBefore } from '../../utils/cfiUtils';
import { Avatar, AvatarImage, AvatarFallback } from '../UI/avatar';
import { Badge } from '../UI/badge';
import { Heart, Swords, Users, HelpCircle } from 'lucide-react';

interface RelationshipCardProps {
  edge: NetworkEdge;
  sourceEntity: EntityDetail;
  targetEntity: EntityDetail;
  currentChapter: number;
  currentCFI?: string | null;
  onEntityClick?: (id: string) => void;
}

const isRelationshipVisible = (
  edge: NetworkEdge,
  sourceEntity: EntityDetail,
  targetEntity: EntityDetail,
  currentCFI: string | null,
  currentChapter: number
): boolean => {
  const sourceVisible = isEntityMetCFI(sourceEntity, currentCFI, currentChapter);
  const targetVisible = isEntityMetCFI(targetEntity, currentCFI, currentChapter);

  if (!sourceVisible || !targetVisible) {
    return false;
  }

  if (isValidCFI(currentCFI) && isValidCFI(edge.first_interaction_cfi)) {
    return isCFIBefore(edge.first_interaction_cfi!, currentCFI!);
  }

  if (edge.first_interaction_chapter != null) {
    return currentChapter >= edge.first_interaction_chapter;
  }

  return true;
};

export const RelationshipCard: React.FC<RelationshipCardProps> = ({
  edge,
  sourceEntity,
  targetEntity,
  currentChapter,
  currentCFI,
  onEntityClick,
}) => {
  const { t } = useTranslation();
  const RELATIONSHIP_TYPE_CONFIG: Record<
    string,
    { label: string; icon: React.ReactNode; color: string }
  > = {
    KINSHIP: {
      label: t('entities.rel_kinship'),
      icon: <Users className="w-4 h-4" />,
      color: 'text-[var(--color-relationship-kinship)]',
    },
    ALLY: {
      label: t('entities.rel_ally'),
      icon: <Heart className="w-4 h-4" />,
      color: 'text-[var(--color-relationship-ally)]',
    },
    ENEMY: {
      label: t('entities.rel_enemy'),
      icon: <Swords className="w-4 h-4" />,
      color: 'text-[var(--color-relationship-enemy)]',
    },
    FRIEND: {
      label: t('entities.rel_friend'),
      icon: <Heart className="w-4 h-4" />,
      color: 'text-[var(--color-relationship-friend)]',
    },
    MENTOR: {
      label: t('entities.rel_mentor'),
      icon: <Users className="w-4 h-4" />,
      color: 'text-[var(--color-relationship-mentor)]',
    },
    STUDENT: {
      label: t('entities.rel_student'),
      icon: <Users className="w-4 h-4" />,
      color: 'text-[var(--color-relationship-student)]',
    },
    ROMANCE: {
      label: t('entities.rel_romance'),
      icon: <Heart className="w-4 h-4" />,
      color: 'text-[var(--color-relationship-romance)]',
    },
    RIVAL: {
      label: t('entities.rel_rival'),
      icon: <Swords className="w-4 h-4" />,
      color: 'text-[var(--color-relationship-rival)]',
    },
  };

  const isVisible = isRelationshipVisible(
    edge,
    sourceEntity,
    targetEntity,
    currentCFI ?? null,
    currentChapter
  );
  const typeConfig = RELATIONSHIP_TYPE_CONFIG[edge.type] || {
    label: edge.type,
    icon: <HelpCircle className="w-4 h-4" />,
    color: 'text-[var(--color-text-muted)]',
  };

  const renderEntityAvatar = (entity: EntityDetail, isClickable: boolean) => (
    <div
      className={`flex flex-col items-center gap-2 ${isClickable ? 'cursor-pointer' : ''}`}
      onClick={() => isClickable && onEntityClick?.(entity.id)}
    >
      <Avatar className="h-14 w-14 border border-[var(--color-border-default)]">
        {entity.avatar_url && <AvatarImage src={entity.avatar_url} />}
        <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)] text-lg">
          {entity.name[0]}
        </AvatarFallback>
      </Avatar>
      <span
        className={`font-serif text-sm text-center ${isClickable ? 'text-[var(--color-text-default)]' : 'text-[var(--color-text-muted)]'}`}
      >
        {entity.name}
      </span>
    </div>
  );

  if (!isVisible) {
    return (
      <div className="py-6">
        <div className="flex items-center justify-center gap-6 mb-6">
          <div className="flex flex-col items-center gap-2 opacity-50">
            <Avatar className="h-14 w-14 border border-[var(--color-border-subtle)]">
              <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-disabled)] blur-[3px]">
                ?
              </AvatarFallback>
            </Avatar>
            <span className="font-serif italic text-sm text-[var(--color-text-disabled)]">?</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="ring-1 ring-[var(--color-border-default)] p-2 rounded-full text-[var(--color-text-disabled)]">
              <HelpCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 opacity-50">
            <Avatar className="h-14 w-14 border border-[var(--color-border-subtle)]">
              <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-disabled)] blur-[3px]">
                ?
              </AvatarFallback>
            </Avatar>
            <span className="font-serif italic text-sm text-[var(--color-text-disabled)]">?</span>
          </div>
        </div>

        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[var(--color-spoiler-overlay)] flex items-center justify-center mx-auto">
            <span className="font-serif italic text-2xl text-[var(--color-text-disabled)]">?</span>
          </div>
          <h4 className="font-serif text-[var(--color-text-default)] font-medium">
            {t('entities.relationship_hidden')}
          </h4>
          <p className="text-[var(--color-text-muted)] text-sm">
            {t('entities.relationship_hidden_desc')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-4">
      <div className="flex items-center justify-center gap-6 mb-6">
        {renderEntityAvatar(sourceEntity, true)}

        <div className="flex flex-col items-center gap-1">
          <div
            className={`ring-1 ring-[var(--color-border-default)] p-2 rounded-full ${typeConfig.color}`}
          >
            {typeConfig.icon}
          </div>
        </div>

        {renderEntityAvatar(targetEntity, true)}
      </div>

      <div className="text-center mb-4">
        <Badge variant="outline" className={`${typeConfig.color} border-current`}>
          {typeConfig.label}
        </Badge>
        {edge.weight !== 0 && (
          <span className="ml-2 text-xs text-[var(--color-text-subtle)]">
            ({edge.weight > 0 ? '+' : ''}
            {edge.weight})
          </span>
        )}
      </div>

      {edge.description && (
        <div className="border-t border-b border-[var(--color-border-subtle)] py-4 my-4">
          <p className="font-serif italic text-[var(--color-text-muted)] text-sm text-center">
            "{edge.description}"
          </p>
        </div>
      )}

      {edge.first_interaction_chapter != null && (
        <div className="text-center text-xs text-[var(--color-text-disabled)]">
          {t('entities.first_interaction', { chapter: edge.first_interaction_chapter })}
        </div>
      )}
    </div>
  );
};
