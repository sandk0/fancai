import React from 'react';
import { EntityDetail, NetworkEdge } from '../../types/entity';
import { isEntityMetCFI } from '../../utils/entityUtils';
import { isValidCFI, isCFIBefore } from '../../utils/cfiUtils';
import { Avatar, AvatarImage, AvatarFallback } from '../UI/avatar';
import { Badge } from '../UI/badge';
import { Card } from '../UI/Card';
import { ArrowLeftRight, Lock, Heart, Swords, Users, HelpCircle } from 'lucide-react';

const RELATIONSHIP_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    KINSHIP: { label: 'Родство', icon: <Users className="w-4 h-4" />, color: 'text-[var(--color-relationship-kinship)]' },
    ALLY: { label: 'Союзник', icon: <Heart className="w-4 h-4" />, color: 'text-[var(--color-relationship-ally)]' },
    ENEMY: { label: 'Враг', icon: <Swords className="w-4 h-4" />, color: 'text-[var(--color-relationship-enemy)]' },
    FRIEND: { label: 'Друг', icon: <Heart className="w-4 h-4" />, color: 'text-[var(--color-relationship-friend)]' },
    MENTOR: { label: 'Наставник', icon: <Users className="w-4 h-4" />, color: 'text-[var(--color-relationship-mentor)]' },
    STUDENT: { label: 'Ученик', icon: <Users className="w-4 h-4" />, color: 'text-[var(--color-relationship-student)]' },
};

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
    const isVisible = isRelationshipVisible(edge, sourceEntity, targetEntity, currentCFI ?? null, currentChapter);
    const typeConfig = RELATIONSHIP_TYPE_CONFIG[edge.type] || { 
        label: edge.type, 
        icon: <HelpCircle className="w-4 h-4" />, 
        color: 'text-[var(--color-text-muted)]' 
    };

    const renderEntityAvatar = (entity: EntityDetail, isClickable: boolean) => (
        <div 
            className={`flex flex-col items-center gap-2 ${isClickable ? 'cursor-pointer' : ''}`}
            onClick={() => isClickable && onEntityClick?.(entity.id)}
        >
            <Avatar className="h-16 w-16 border border-[var(--color-border-default)]">
                <AvatarImage src={entity.avatar_url || undefined} />
                <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-muted)] text-xl">
                    {entity.name[0]}
                </AvatarFallback>
            </Avatar>
            <span className={`text-sm font-medium text-center ${isClickable ? 'text-[var(--color-text-default)]' : 'text-[var(--color-text-muted)]'}`}>
                {entity.name}
            </span>
        </div>
    );

    if (!isVisible) {
        return (
            <Card padding="lg">
                <div className="flex items-center justify-center gap-4 mb-4">
                    <div className="flex flex-col items-center gap-2 opacity-50">
                        <Avatar className="h-16 w-16 border border-[var(--color-border-subtle)] grayscale">
                            <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-disabled)]">?</AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-[var(--color-text-disabled)]">???</span>
                    </div>
                    <ArrowLeftRight className="w-6 h-6 text-[var(--color-text-disabled)]" />
                    <div className="flex flex-col items-center gap-2 opacity-50">
                        <Avatar className="h-16 w-16 border border-[var(--color-border-subtle)] grayscale">
                            <AvatarFallback className="bg-[var(--color-bg-muted)] text-[var(--color-text-disabled)]">?</AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-[var(--color-text-disabled)]">???</span>
                    </div>
                </div>
                
                <div className="text-center space-y-3">
                    <Lock className="w-8 h-8 text-[var(--color-text-disabled)] mx-auto" />
                    <h4 className="text-[var(--color-text-default)] font-medium">Связь скрыта</h4>
                    <p className="text-[var(--color-text-muted)] text-sm">
                        Продолжайте читать, чтобы узнать об этих отношениях.
                    </p>
                </div>
            </Card>
        );
    }

    return (
        <Card padding="lg">
            <div className="flex items-center justify-center gap-6 mb-6">
                {renderEntityAvatar(sourceEntity, true)}
                
                <div className="flex flex-col items-center gap-1">
                    <div className={`p-2 rounded-full bg-[var(--color-bg-elevated)] ${typeConfig.color}`}>
                        {typeConfig.icon}
                    </div>
                    <ArrowLeftRight className="w-5 h-5 text-[var(--color-text-muted)]" />
                </div>
                
                {renderEntityAvatar(targetEntity, true)}
            </div>

            <div className="text-center mb-4">
                <Badge 
                    variant="outline" 
                    className={`${typeConfig.color} border-current`}
                >
                    {typeConfig.label}
                </Badge>
                {edge.weight !== 0 && (
                    <span className="ml-2 text-xs text-[var(--color-text-subtle)]">
                        ({edge.weight > 0 ? '+' : ''}{edge.weight})
                    </span>
                )}
            </div>

            {edge.description && (
                <Card variant="subtle" padding="md">
                    <p className="text-[var(--color-text-muted)] text-sm italic text-center">
                        "{edge.description}"
                    </p>
                </Card>
            )}

            {edge.first_interaction_chapter != null && (
                <div className="mt-4 text-center text-xs text-[var(--color-text-disabled)]">
                    Первое взаимодействие: Глава {edge.first_interaction_chapter}
                </div>
            )}
        </Card>
    );
};
