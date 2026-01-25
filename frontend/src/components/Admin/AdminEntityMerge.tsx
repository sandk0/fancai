import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Check, AlertCircle, ChevronDown, ChevronUp, Users2 } from 'lucide-react';
import { adminAPI } from '@/api/admin';
import { notify } from '@/stores/ui';
import LoadingSpinner from '@/components/UI/LoadingSpinner';

interface AdminEntityMergeProps {
  t: (key: string) => string;
}

export const AdminEntityMerge: React.FC<AdminEntityMergeProps> = ({ t }) => {
  const queryClient = useQueryClient();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedMaster, setSelectedMaster] = useState<Record<string, string>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'entity-duplicates'],
    queryFn: () => adminAPI.getEntityDuplicates(),
  });

  const mergeMutation = useMutation({
    mutationFn: ({ masterId, duplicateIds }: { masterId: string; duplicateIds: string[] }) =>
      adminAPI.mergeEntities(masterId, duplicateIds),
    onSuccess: (result) => {
      notify.success(t('admin.mergeSuccess'), result.message);
      queryClient.invalidateQueries({ queryKey: ['admin', 'entity-duplicates'] });
    },
    onError: (error: Error) => {
      notify.error(t('admin.mergeFailed'), error.message);
    },
  });

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const handleMerge = (groupKey: string, entities: Array<{ id: string }>) => {
    const masterId = selectedMaster[groupKey] || entities[0].id;
    const duplicateIds = entities.filter((e) => e.id !== masterId).map((e) => e.id);

    if (duplicateIds.length === 0) {
      notify.error(t('admin.mergeError'), t('admin.selectEntitiesToMerge'));
      return;
    }

    mergeMutation.mutate({ masterId, duplicateIds });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner size="lg" text={t('admin.loadingDuplicates')} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
        <p className="text-destructive">{t('admin.failedToLoadDuplicates')}</p>
        <button
          onClick={() => refetch()}
          className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const groups = data?.groups || [];

  if (groups.length === 0) {
    return (
      <div className="text-center py-8">
        <Check className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <p className="text-muted-foreground">{t('admin.noDuplicatesFound')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users2 className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {t('admin.duplicateGroups')}: {groups.length} ({data?.total_duplicates || 0}{' '}
            {t('admin.extraEntities')})
          </span>
        </div>
        <button
          onClick={() => refetch()}
          className="text-sm text-primary hover:underline"
        >
          {t('common.refresh')}
        </button>
      </div>

      {groups.map((group) => {
        const groupKey = `${group.book_id}-${group.normalized_name}`;
        const isExpanded = expandedGroups.has(groupKey);
        const master = selectedMaster[groupKey] || group.entities[0]?.id;

        return (
          <div
            key={groupKey}
            className="border border-border rounded-lg overflow-hidden bg-card"
          >
            <button
              onClick={() => toggleGroup(groupKey)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <GitMerge className="w-4 h-4 text-orange-500" />
                <div className="text-left">
                  <span className="font-medium">{group.normalized_name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({group.entities.length} entities)
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {group.book_title}
                </span>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t border-border">
                <p className="text-xs text-muted-foreground py-2">
                  {t('admin.selectMasterEntity')}
                </p>
                <div className="space-y-2">
                  {group.entities.map((entity) => (
                    <label
                      key={entity.id}
                      className={`flex items-start gap-3 p-3 rounded-md cursor-pointer transition-colors ${
                        master === entity.id
                          ? 'bg-primary/10 border border-primary'
                          : 'bg-muted/30 border border-transparent hover:bg-muted/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`master-${groupKey}`}
                        checked={master === entity.id}
                        onChange={() =>
                          setSelectedMaster((prev) => ({ ...prev, [groupKey]: entity.id }))
                        }
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{entity.name}</span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              entity.type === 'character'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                : entity.type === 'location'
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                            }`}
                          >
                            {entity.type}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            importance: {entity.importance}
                          </span>
                        </div>
                        {entity.visual_summary && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {entity.visual_summary}
                          </p>
                        )}
                      </div>
                      {master === entity.id && (
                        <span className="text-xs text-primary font-medium">MASTER</span>
                      )}
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => handleMerge(groupKey, group.entities)}
                    disabled={mergeMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-md disabled:opacity-50 transition-colors"
                  >
                    {mergeMutation.isPending ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <GitMerge className="w-4 h-4" />
                    )}
                    {t('admin.mergeEntities')}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
