import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { m } from 'motion/react';
import { Upload, Library } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { getGreeting, scaleOnHover } from '@/components/Home/constants';

interface UserGreetingProps {
  userName?: string;
}

export const UserGreeting: React.FC<UserGreetingProps> = ({ userName }) => {
  const { t } = useTranslation();
  const setShowUploadModal = useUIStore((state) => state.setShowUploadModal);

  return (
    <m.section
      className="mb-8 sm:mb-10"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="fluid-h2 font-bold text-foreground">
            {getGreeting(t)}, {userName || t('home.default_reader')}!
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('home.what_to_read')}
          </p>
        </div>

        <div className="flex gap-3">
          <Link
            to="/library"
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl',
              'bg-secondary text-secondary-foreground font-medium',
              'hover:bg-secondary/80 transition-colors'
            )}
          >
            <Library className="w-4 h-4" />
            <span className="hidden sm:inline">{t('home.library_button')}</span>
          </Link>

          <m.button
            onClick={() => setShowUploadModal(true)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl',
              'bg-primary text-primary-foreground font-medium',
              'hover:bg-primary/90 transition-colors'
            )}
            {...scaleOnHover}
          >
            <Upload className="w-4 h-4" />
            <span>{t('home.upload_button')}</span>
          </m.button>
        </div>
      </div>
    </m.section>
  );
};
