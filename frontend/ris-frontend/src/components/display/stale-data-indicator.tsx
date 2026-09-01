import { Clock } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';

interface StaleDataIndicatorProps {
  /** Timestamp (ms) of the last successful data fetch — from useQuery().dataUpdatedAt */
  dataUpdatedAt: number;
  className?: string;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Shows "Data from X minutes ago" when offline and data is older than 5 minutes.
 */
export function StaleDataIndicator({
  dataUpdatedAt,
  className,
}: StaleDataIndicatorProps): React.ReactElement | null {
  const isOnline = useOnlineStatus();

  if (isOnline || dataUpdatedAt === 0) return null;

  const ageMs = Date.now() - dataUpdatedAt;
  if (ageMs < STALE_THRESHOLD_MS) return null;

  const ageMinutes = Math.round(ageMs / 60_000);
  const label = ageMinutes < 60
    ? `Data from ${ageMinutes}m ago`
    : `Data from ${Math.round(ageMinutes / 60)}h ago`;

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
      <Clock className="size-3" />
      {label}
    </span>
  );
}
