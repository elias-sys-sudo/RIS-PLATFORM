import { useEffect, useRef } from 'react';
import { WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';

/**
 * Global offline/online connectivity banner.
 * Shows a persistent amber warning when the browser goes offline.
 * On reconnection: shows a "Back online" toast and refreshes stale queries.
 */
export function OfflineBanner(): React.ReactElement | null {
  const isOnline = useOnlineStatus();
  const prevOnline = useRef(isOnline);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!prevOnline.current && isOnline) {
      toast.success('Back online', { duration: 3000 });
      void queryClient.invalidateQueries();
    }
    prevOnline.current = isOnline;
  }, [isOnline, queryClient]);

  if (isOnline) return null;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5',
      )}
    >
      <WifiOff className="size-4 text-amber-700 shrink-0" />
      <p className="flex-1 text-sm text-amber-700">
        You are offline. Some features may be unavailable.
      </p>
    </div>
  );
}
