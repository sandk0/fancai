import React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonCardProps {
  className?: string;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({ className }) => (
  <div className={cn('animate-pulse rounded-xl bg-muted', className)} aria-busy="true" />
);

export const SkeletonBookCard: React.FC = () => (
  <div className="sm:flex-shrink-0 sm:w-32 md:w-40" aria-busy="true">
    <SkeletonCard className="aspect-[2/3] mb-1.5 sm:mb-2 rounded-lg sm:rounded-xl" />
    <SkeletonCard className="h-3 sm:h-4 w-3/4 mb-1" />
    <SkeletonCard className="h-2.5 sm:h-3 w-1/2" />
  </div>
);

export const SkeletonStatCard: React.FC = () => (
  <div className="p-2.5 sm:p-3 md:p-4 rounded-lg sm:rounded-xl border border-border bg-card animate-pulse min-w-0" aria-busy="true">
    <SkeletonCard className="h-5 w-5 sm:h-6 sm:w-6 md:h-8 md:w-8 rounded-md sm:rounded-lg mb-1.5 sm:mb-2 md:mb-3" />
    <SkeletonCard className="h-5 sm:h-6 md:h-8 w-10 sm:w-12 md:w-16 mb-1 sm:mb-1.5 md:mb-2" />
    <SkeletonCard className="h-3 w-14 sm:w-16 md:w-24" />
  </div>
);
