import { useState, useCallback } from 'react';
import { Bell, Smartphone, Zap, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { m, LazyMotion, domAnimation } from 'motion/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/UI/button';
import {
  isIOSSafari,
  isStandalone,
  IOS_MIN_PUSH_VERSION,
  getIOSVersion,
} from '@/utils/iosSupport';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/UI/Card';
import { IOSInstallInstructions } from './IOSInstallInstructions';

export interface IOSPushGuidanceProps {
  onInstallClick?: () => void;
  className?: string;
  expanded?: boolean;
}

export function IOSPushGuidance({
  onInstallClick,
  className,
  expanded = false,
}: IOSPushGuidanceProps) {
  const { t } = useTranslation();

  const benefits = [
    {
      icon: Bell,
      title: t('ui.iosPush.push_notifications'),
      description: t('ui.iosPush.push_desc'),
    },
    {
      icon: Smartphone,
      title: t('ui.iosPush.fullscreen'),
      description: t('ui.iosPush.fullscreen_desc'),
    },
    {
      icon: Zap,
      title: t('ui.iosPush.quick_access'),
      description: t('ui.iosPush.quick_access_desc'),
    },
  ];
  const [shouldShow] = useState(() => {
    return isIOSSafari() && !isStandalone();
  });
  const [showInstructions, setShowInstructions] = useState(false);
  const [iosVersionInfo] = useState<{
    version: number | null;
    supportsWebPush: boolean;
  }>(() => {
    const version = getIOSVersion();
    const supportsWebPush = version !== null && version >= IOS_MIN_PUSH_VERSION;
    return { version, supportsWebPush };
  });

  const handleInstallClick = useCallback(() => {
    if (onInstallClick) {
      onInstallClick();
    } else {
      setShowInstructions(true);
    }
  }, [onInstallClick]);

  if (!shouldShow) {
    return null;
  }

  if (!expanded) {
    return (
      <LazyMotion features={domAnimation}>
        <m.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={className}
        >
          <Card variant="outlined" padding="md" className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 p-2 rounded-lg bg-amber-100 dark:bg-amber-900/50">
                <Bell className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('ui.iosPush.not_available')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {iosVersionInfo.supportsWebPush
                    ? t('ui.iosPush.install_hint')
                    : t('ui.iosPush.ios_required', { version: IOS_MIN_PUSH_VERSION })}
                </p>
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className={cn(
                    'mt-2 inline-flex items-center gap-1 text-sm font-medium',
                    'text-amber-700 dark:text-amber-400',
                    'hover:text-amber-800 dark:hover:text-amber-300',
                    'focus:outline-hidden focus:underline',
                    'transition-colors'
                  )}
                >
                  {t('ui.iosPush.how_to_install')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </Card>

          {showInstructions && (
            <IOSInstallInstructions
              mode="modal"
              onDismiss={() => setShowInstructions(false)}
              forceShow
            />
          )}
        </m.div>
      </LazyMotion>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={className}
      >
        <Card variant="default" padding="lg">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 p-2.5 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/50 dark:to-orange-900/50">
                <Smartphone className="h-6 w-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-base">
                  {t('ui.iosPush.install_title')}
                </CardTitle>
                <CardDescription className="mt-0.5">
                  {t('ui.iosPush.install_subtitle')}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {!iosVersionInfo.supportsWebPush && iosVersionInfo.version !== null && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-700 dark:text-red-400">
                  {t('ui.iosPush.ios_version_warning', { version: iosVersionInfo.version, required: IOS_MIN_PUSH_VERSION })}
                </p>
              </div>
            )}

            <div className="space-y-4">
              <p className="text-sm font-medium text-foreground">
                {t('ui.iosPush.benefits_title')}
              </p>

              <div className="space-y-3">
                {benefits.map((benefit, index) => {
                  const IconComponent = benefit.icon;
                  return (
                    <m.div
                      key={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1, duration: 0.2 }}
                      className="flex items-start gap-3"
                    >
                      <div className="flex-shrink-0 p-1.5 rounded-lg bg-[var(--color-bg-subtle)]">
                        <IconComponent
                          className="h-4 w-4 text-[var(--color-accent-600)] dark:text-[var(--color-accent-400)]"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {benefit.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {benefit.description}
                        </p>
                      </div>
                    </m.div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <Button
                variant="primary"
                size="md"
                onClick={handleInstallClick}
                className="w-full sm:w-auto"
              >
                <Smartphone className="h-4 w-4 mr-2" aria-hidden="true" />
                {t('ui.iosPush.install_button')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {showInstructions && (
          <IOSInstallInstructions
            mode="modal"
            onDismiss={() => setShowInstructions(false)}
            forceShow
          />
        )}
      </m.div>
    </LazyMotion>
  );
}
