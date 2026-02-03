import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Skeleton variants using class-variance-authority (cva)
 *
 * Design system requirements:
 * - Uses CSS custom property --color-bg-muted for background
 * - Animated pulse effect for loading indication
 * - Three shape variants: text, circular, rectangular
 */
const skeletonVariants = cva(
  // Base styles
  [
    "animate-pulse",
    "bg-[var(--color-bg-muted)]",
  ],
  {
    variants: {
      /**
       * Shape variant determines the visual style
       */
      variant: {
        /**
         * Text - For text placeholders, rounded corners
         */
        text: "rounded-md",
        /**
         * Circular - For avatars and icons
         */
        circular: "rounded-full",
        /**
         * Rectangular - For images and cards
         */
        rectangular: "rounded-lg",
      },
    },
    defaultVariants: {
      variant: "text",
    },
  }
)

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {
  /** Width of the skeleton (CSS value or Tailwind class) */
  width?: string | number
  /** Height of the skeleton (CSS value or Tailwind class) */
  height?: string | number
}

/**
 * Base Skeleton component for loading placeholders
 *
 * @example
 * // Text skeleton (default)
 * <Skeleton width="100%" height={16} />
 *
 * @example
 * // Circular skeleton for avatar
 * <Skeleton variant="circular" width={40} height={40} />
 *
 * @example
 * // Rectangular skeleton for image
 * <Skeleton variant="rectangular" width="100%" height={200} />
 */
const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant, width, height, style, ...props }, ref) => {
    const computedStyle: React.CSSProperties = {
      ...style,
      ...(width !== undefined && {
        width: typeof width === "number" ? `${width}px` : width,
      }),
      ...(height !== undefined && {
        height: typeof height === "number" ? `${height}px` : height,
      }),
    }

    return (
      <div
        ref={ref}
        className={cn(skeletonVariants({ variant, className }))}
        style={computedStyle}
        aria-hidden="true"
        {...props}
      />
    )
  }
)
Skeleton.displayName = "Skeleton"

// ============================================================================
// Specialized Skeleton Components
// ============================================================================

export interface BookCardSkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Show extended info (genre, progress bar) */
  showExtendedInfo?: boolean
}

/**
 * BookCardSkeleton - Skeleton for book card in library
 *
 * @example
 * <BookCardSkeleton />
 *
 * @example
 * // With extended info
 * <BookCardSkeleton showExtendedInfo />
 */
const BookCardSkeleton = React.forwardRef<HTMLDivElement, BookCardSkeletonProps>(
  ({ className, showExtendedInfo = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border border-[var(--color-border-default)] bg-card p-4",
          className
        )}
        aria-label="Loading book card"
        aria-busy="true"
        {...props}
      >
        {/* Book cover image */}
        <Skeleton
          variant="rectangular"
          className="mb-3 aspect-[2/3] w-full"
        />
        {/* Book title */}
        <Skeleton variant="text" className="mb-2 h-5 w-3/4" />
        {/* Author */}
        <Skeleton variant="text" className="mb-2 h-4 w-1/2" />
        {showExtendedInfo && (
          <>
            {/* Genre badge */}
            <Skeleton variant="text" className="mb-2 h-5 w-16" />
            {/* Progress bar */}
            <Skeleton variant="text" className="h-2 w-full" />
          </>
        )}
      </div>
    )
  }
)
BookCardSkeleton.displayName = "BookCardSkeleton"

export interface TableRowSkeletonProps
  extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Number of columns */
  columns?: number
  /** Show checkbox column */
  showCheckbox?: boolean
}

/**
 * TableRowSkeleton - Skeleton for table rows
 *
 * @example
 * <table>
 *   <tbody>
 *     <TableRowSkeleton columns={4} />
 *     <TableRowSkeleton columns={4} />
 *   </tbody>
 * </table>
 */
const TableRowSkeleton = React.forwardRef<
  HTMLTableRowElement,
  TableRowSkeletonProps
>(({ className, columns = 4, showCheckbox = false, ...props }, ref) => {
  const columnWidths = ["w-1/4", "w-1/3", "w-1/2", "w-2/3", "w-full"]

  return (
    <tr
      ref={ref}
      className={cn("border-b border-[var(--color-border-default)]", className)}
      aria-label="Loading table row"
      aria-busy="true"
      {...props}
    >
      {showCheckbox && (
        <td className="px-4 py-3">
          <Skeleton variant="rectangular" width={18} height={18} />
        </td>
      )}
      {Array.from({ length: columns }).map((_, index) => (
        <td key={index} className="px-4 py-3">
          <Skeleton
            variant="text"
            className={cn("h-4", columnWidths[index % columnWidths.length])}
          />
        </td>
      ))}
    </tr>
  )
})
TableRowSkeleton.displayName = "TableRowSkeleton"

export interface TextBlockSkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of lines to show */
  lines?: number
  /** Width of the last line (percentage) */
  lastLineWidth?: string
}

/**
 * TextBlockSkeleton - Skeleton for text paragraphs
 *
 * @example
 * // Simple paragraph
 * <TextBlockSkeleton lines={3} />
 *
 * @example
 * // With custom last line width
 * <TextBlockSkeleton lines={4} lastLineWidth="60%" />
 */
const TextBlockSkeleton = React.forwardRef<HTMLDivElement, TextBlockSkeletonProps>(
  ({ className, lines = 3, lastLineWidth = "75%", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("space-y-2", className)}
        aria-label="Loading text content"
        aria-busy="true"
        {...props}
      >
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton
            key={index}
            variant="text"
            className="h-4"
            width={index === lines - 1 ? lastLineWidth : "100%"}
          />
        ))}
      </div>
    )
  }
)
TextBlockSkeleton.displayName = "TextBlockSkeleton"

export interface AvatarSkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Size of the avatar */
  size?: "sm" | "md" | "lg" | "xl"
  /** Show name beside avatar */
  showName?: boolean
}

/**
 * AvatarSkeleton - Skeleton for user avatars
 *
 * @example
 * // Simple avatar
 * <AvatarSkeleton size="md" />
 *
 * @example
 * // Avatar with name
 * <AvatarSkeleton size="lg" showName />
 */
const AvatarSkeleton = React.forwardRef<HTMLDivElement, AvatarSkeletonProps>(
  ({ className, size = "md", showName = false, ...props }, ref) => {
    const sizeMap = {
      sm: 32,
      md: 40,
      lg: 48,
      xl: 64,
    }

    const avatarSize = sizeMap[size]

    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-3", className)}
        aria-label="Loading avatar"
        aria-busy="true"
        {...props}
      >
        <Skeleton
          variant="circular"
          width={avatarSize}
          height={avatarSize}
        />
        {showName && (
          <div className="flex flex-col gap-1">
            <Skeleton variant="text" width={100} height={16} />
            <Skeleton variant="text" width={60} height={12} />
          </div>
        )}
      </div>
    )
  }
)
AvatarSkeleton.displayName = "AvatarSkeleton"

// ============================================================================
// Additional Specialized Skeletons
// ============================================================================

export interface CardSkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Show header section */
  showHeader?: boolean
  /** Show footer section */
  showFooter?: boolean
  /** Number of content lines */
  contentLines?: number
}

/**
 * CardSkeleton - Skeleton for generic card content
 *
 * @example
 * <CardSkeleton showHeader showFooter contentLines={3} />
 */
const CardSkeleton = React.forwardRef<HTMLDivElement, CardSkeletonProps>(
  (
    { className, showHeader = true, showFooter = false, contentLines = 2, ...props },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border border-[var(--color-border-default)] bg-card p-4",
          className
        )}
        aria-label="Loading card"
        aria-busy="true"
        {...props}
      >
        {showHeader && (
          <div className="mb-4 space-y-2">
            <Skeleton variant="text" className="h-6 w-1/2" />
            <Skeleton variant="text" className="h-4 w-3/4" />
          </div>
        )}
        <TextBlockSkeleton lines={contentLines} />
        {showFooter && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <Skeleton variant="rectangular" width={80} height={36} />
            <Skeleton variant="rectangular" width={80} height={36} />
          </div>
        )}
      </div>
    )
  }
)
CardSkeleton.displayName = "CardSkeleton"

export interface ListItemSkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Show leading avatar */
  showAvatar?: boolean
  /** Show trailing action */
  showAction?: boolean
}

/**
 * ListItemSkeleton - Skeleton for list items
 *
 * @example
 * <ListItemSkeleton showAvatar showAction />
 */
const ListItemSkeleton = React.forwardRef<HTMLDivElement, ListItemSkeletonProps>(
  ({ className, showAvatar = false, showAction = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-3 border-b border-[var(--color-border-default)] py-3",
          className
        )}
        aria-label="Loading list item"
        aria-busy="true"
        {...props}
      >
        {showAvatar && (
          <Skeleton variant="circular" width={40} height={40} />
        )}
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" className="h-4 w-3/4" />
          <Skeleton variant="text" className="h-3 w-1/2" />
        </div>
        {showAction && (
          <Skeleton variant="rectangular" width={32} height={32} />
        )}
      </div>
    )
  }
)
ListItemSkeleton.displayName = "ListItemSkeleton"

export interface EntityCardSkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  showChevron?: boolean
}

const EntityCardSkeleton = React.forwardRef<HTMLDivElement, EntityCardSkeletonProps>(
  ({ className, showChevron = true, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center p-3 rounded-lg bg-white/5",
          className
        )}
        aria-label="Loading entity"
        aria-busy="true"
        {...props}
      >
        <Skeleton variant="circular" width={48} height={48} className="mr-4 border border-white/10" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton variant="text" className="h-4 w-2/3" />
          <Skeleton variant="text" className="h-3 w-1/3" />
        </div>
        {showChevron && (
          <Skeleton variant="rectangular" width={20} height={20} className="ml-2" />
        )}
      </div>
    )
  }
)
EntityCardSkeleton.displayName = "EntityCardSkeleton"

export interface EntityListSkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  count?: number
}

const EntityListSkeleton = React.forwardRef<HTMLDivElement, EntityListSkeletonProps>(
  ({ className, count = 5, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("space-y-2 px-2", className)}
        aria-label="Loading entities"
        aria-busy="true"
        {...props}
      >
        {Array.from({ length: count }).map((_, i) => (
          <EntityCardSkeleton key={i} />
        ))}
      </div>
    )
  }
)
EntityListSkeleton.displayName = "EntityListSkeleton"

export {
  Skeleton,
  BookCardSkeleton,
  TableRowSkeleton,
  TextBlockSkeleton,
  AvatarSkeleton,
  CardSkeleton,
  ListItemSkeleton,
  EntityCardSkeleton,
  EntityListSkeleton,
}
