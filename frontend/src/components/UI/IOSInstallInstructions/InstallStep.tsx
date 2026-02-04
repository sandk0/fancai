import React from 'react';
import { m } from 'motion/react';
import { cn } from '@/lib/utils';
import { stepVariants } from './animations';

interface InstallStepProps {
  stepNumber: number;
  text: string;
  icon?: React.ReactNode;
}

export function InstallStep({ stepNumber, text, icon }: InstallStepProps) {
  return (
    <m.div
      className="flex items-start gap-3 py-2"
      variants={stepVariants}
      custom={stepNumber - 1}
      initial="hidden"
      animate="visible"
    >
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          'bg-[var(--color-accent-100)] text-[var(--color-accent-700)]',
          'dark:bg-[var(--color-accent-900)] dark:text-[var(--color-accent-300)]',
          'text-sm font-semibold'
        )}
      >
        {stepNumber}
      </div>

      <div className="flex flex-1 items-center gap-2 pt-0.5">
        <span className="text-[var(--color-text-default)]">{text}</span>
        {icon && (
          <span className="inline-flex text-[var(--color-accent-600)] dark:text-[var(--color-accent-400)]">
            {icon}
          </span>
        )}
      </div>
    </m.div>
  );
}
