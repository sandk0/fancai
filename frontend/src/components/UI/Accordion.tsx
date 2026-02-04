/**
 * Accordion - Collapsible sections component for mobile navigation
 *
 * Features:
 * - Single or multiple sections can be open
 * - Smooth animations with Framer Motion
 * - Full accessibility support (ARIA)
 * - Theme-aware styling
 */

import React, { useState, useCallback } from 'react';
import { m, AnimatePresence } from 'motion/react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AccordionItem {
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  content: React.ReactNode;
}

interface AccordionProps {
  items: AccordionItem[];
  defaultOpen?: string;
  allowMultiple?: boolean;
  className?: string;
}

export const Accordion: React.FC<AccordionProps> = ({
  items,
  defaultOpen,
  allowMultiple = false,
  className,
}) => {
  const [openItems, setOpenItems] = useState<string[]>(
    defaultOpen ? [defaultOpen] : []
  );

  const toggleItem = useCallback((id: string) => {
    setOpenItems(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      }
      if (allowMultiple) {
        return [...prev, id];
      }
      return [id];
    });
  }, [allowMultiple]);

  const isOpen = (id: string) => openItems.includes(id);

  return (
    <div className={cn('space-y-2', className)}>
      {items.map((item) => {
        const Icon = item.icon;
        const open = isOpen(item.id);
        const headerId = `accordion-header-${item.id}`;
        const contentId = `accordion-content-${item.id}`;

        return (
          <div
            key={item.id}
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            {/* Header */}
            <button
              id={headerId}
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => toggleItem(item.id)}
              className={cn(
                'w-full flex items-center justify-between gap-3 p-4 text-left',
                'min-h-[56px] transition-colors',
                'hover:bg-muted/50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                open && 'bg-muted/30'
              )}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {Icon && (
                  <Icon
                    className={cn(
                      'w-5 h-5 flex-shrink-0 transition-colors',
                      open ? 'text-primary' : 'text-muted-foreground'
                    )}
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'font-semibold truncate transition-colors',
                    open ? 'text-primary' : 'text-foreground'
                  )}>
                    {item.title}
                  </p>
                  {item.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {item.description}
                    </p>
                  )}
                </div>
              </div>
              <m.div
                animate={{ rotate: open ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown
                  className={cn(
                    'w-5 h-5 flex-shrink-0 transition-colors',
                    open ? 'text-primary' : 'text-muted-foreground'
                  )}
                  aria-hidden="true"
                />
              </m.div>
            </button>

            {/* Content */}
            <AnimatePresence initial={false}>
              {open && (
                <m.div
                  id={contentId}
                  role="region"
                  aria-labelledby={headerId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="px-4 py-4 border-t border-border">
                    {item.content}
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};

export default Accordion;
