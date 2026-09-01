import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

interface LoadingSkeletonProps {
  /** Preset layout: 'page' for full page, 'table' for data table, 'card' for card grid, 'detail' for detail page */
  variant?: 'page' | 'table' | 'card' | 'detail';
  className?: string;
}

export function LoadingSkeleton({ variant = 'page', className }: LoadingSkeletonProps): React.ReactElement {
  if (variant === 'table') {
    return (
      <div className={cn('space-y-3', className)}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={cn('space-y-4', className)}>
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'detail') {
    return (
      <div className={cn('space-y-4', className)}>
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Default: page
  return (
    <div className={cn('space-y-4', className)}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
