import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { m } from 'motion/react';
import { BookOpen, ArrowRight, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { scaleOnHover } from '@/components/Home/constants';

export const GuestHero: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <m.section
      className="relative overflow-hidden rounded-xl mb-8 sm:mb-12"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/10 to-secondary" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(251,191,36,0.15),transparent_50%)]" />

      <div className="relative px-4 sm:px-6 md:px-10 py-8 sm:py-12 md:py-16 lg:py-24">
        <div className="max-w-3xl mx-auto text-center">
          <m.div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">{t('home.guest.badge')}</span>
          </m.div>

          <m.h1
            className="fluid-h1 font-bold mb-4 sm:mb-6 text-foreground"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {t('home.guest.title_prefix')}
            <span className="bg-gradient-to-r from-primary via-amber-500 to-orange-500 bg-clip-text text-transparent">
              {t('home.guest.title_highlight')}
            </span>
          </m.h1>

          <m.p
            className="text-base sm:text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            {t('home.guest.description')}
          </m.p>

          <m.div
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <m.button
              onClick={() => navigate('/register')}
              className={cn(
                'group inline-flex items-center justify-center gap-2 w-full sm:w-auto',
                'px-6 py-3.5 rounded-xl font-semibold text-base',
                'bg-primary text-primary-foreground',
                'shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40',
                'transition-all duration-200'
              )}
              {...scaleOnHover}
            >
              <BookOpen className="w-5 h-5" />
              <span>{t('home.guest.start_free')}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </m.button>

            <m.button
              onClick={() => navigate('/login')}
              className={cn(
                'inline-flex items-center justify-center gap-2 w-full sm:w-auto',
                'px-6 py-3.5 rounded-xl font-semibold text-base',
                'border-2 border-border bg-background text-foreground',
                'hover:border-primary hover:bg-accent',
                'transition-all duration-200'
              )}
              {...scaleOnHover}
            >
              <span>{t('home.guest.sign_in')}</span>
            </m.button>
          </m.div>
        </div>
      </div>
    </m.section>
  );
};

export const GuestFeatures: React.FC = () => {
  const { t } = useTranslation();

  const features = [
    {
      icon: BookOpen,
      title: t('home.guest.feature_upload_title'),
      description: t('home.guest.feature_upload_desc'),
    },
    {
      icon: Sparkles,
      title: t('home.guest.feature_ai_title'),
      description: t('home.guest.feature_ai_desc'),
    },
    {
      icon: Wand2,
      title: t('home.guest.feature_images_title'),
      description: t('home.guest.feature_images_desc'),
    },
  ];

  return (
    <m.section
      className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3 }}
    >
      {features.map((feature, index) => (
        <m.div
          key={feature.title}
          className={cn(
            'p-6 rounded-xl border border-border bg-card',
            'text-center'
          )}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
        >
          <div className="inline-flex p-3 rounded-xl bg-primary/10 mb-4">
            <feature.icon className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {feature.title}
          </h3>
          <p className="text-sm text-muted-foreground">{feature.description}</p>
        </m.div>
      ))}
    </m.section>
  );
};
