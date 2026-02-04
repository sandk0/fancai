import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  lastSaved: number | null;
  isSaving: boolean;
}

export function ProgressSaveIndicator({ lastSaved, isSaving }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (lastSaved) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [lastSaved]);

  if (!visible && !isSaving) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[800] animate-fade-in"
    >
      <div className="bg-popover/95 text-popover-foreground px-3 py-2 rounded-lg text-sm flex items-center gap-2 shadow-lg border border-border">
        {isSaving ? (
          <>
            <span className="animate-spin">⏳</span>
            {t('reader.progress.saving')}
          </>
        ) : (
          <>
            <span className="text-success">✓</span>
            {t('reader.progress.saved')}
          </>
        )}
      </div>
    </div>
  );
}
