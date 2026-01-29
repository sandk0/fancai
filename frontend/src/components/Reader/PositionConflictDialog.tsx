import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Z_INDEX } from '@/lib/zIndex';

interface PositionConflictDialogProps {
  serverPosition: {
    cfi: string;
    progress: number;
    lastReadAt: Date;
  };
  localPosition: {
    cfi: string;
    progress: number;
    savedAt: Date;
  };
  onUseServer: () => void;
  onUseLocal: () => void;
}

function useFormatDistanceToNow() {
  const { t } = useTranslation();
  
  return (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) return t('reader.conflict.just_now');
    if (diffMinutes < 60) return t('reader.conflict.minutes_short', { count: diffMinutes });
    if (diffHours < 24) return t('reader.conflict.hours_short', { count: diffHours });
    return t('reader.conflict.days_short', { count: diffDays });
  };
}

export const PositionConflictDialog: React.FC<PositionConflictDialogProps> = ({
  serverPosition,
  localPosition,
  onUseServer,
  onUseLocal,
}) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, dialogRef);
  const formatDistanceToNow = useFormatDistanceToNow();

  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: Z_INDEX.modal }}>
      <div className="absolute inset-0 bg-black/50 pointer-events-auto" style={{ zIndex: Z_INDEX.modalOverlay }} />
      <div ref={dialogRef} role="dialog" aria-modal="true" className="relative bg-popover rounded-xl p-6 max-w-md mx-4 shadow-xl pointer-events-auto" style={{ zIndex: Z_INDEX.modal }}>
        <h3 className="text-lg font-semibold text-popover-foreground mb-4">{t('reader.conflict.title')}</h3>
        <p className="text-muted-foreground text-sm mb-4">{t('reader.conflict.description')}</p>
        <div className="space-y-3 mb-6">
          <div className="p-3 bg-muted rounded">
            <div className="text-sm text-muted-foreground">{t('reader.conflict.server')}</div>
            <div className="text-popover-foreground text-lg font-medium">{Math.round(serverPosition.progress)}%</div>
            <div className="text-xs text-muted-foreground/70">{t('reader.conflict.time_ago', { time: formatDistanceToNow(serverPosition.lastReadAt) })}</div>
          </div>
          <div className="p-3 bg-muted rounded">
            <div className="text-sm text-muted-foreground">{t('reader.conflict.local')}</div>
            <div className="text-popover-foreground text-lg font-medium">{Math.round(localPosition.progress)}%</div>
            <div className="text-xs text-muted-foreground/70">{t('reader.conflict.time_ago', { time: formatDistanceToNow(localPosition.savedAt) })}</div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onUseServer} className="flex-1 px-4 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg">{t('reader.conflict.use_server')} ({Math.round(serverPosition.progress)}%)</button>
          <button onClick={onUseLocal} className="flex-1 px-4 py-2.5 bg-muted text-popover-foreground font-medium rounded-lg">{t('reader.conflict.use_local')} ({Math.round(localPosition.progress)}%)</button>
        </div>
      </div>
    </div>
  );
};
