import { Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';
import { useEffect, useState } from 'react';

/**
 * Network status banners:
 * - Online: no indicator
 * - Offline: persistent red banner
 * - Reconnected: green toast-like banner for 3 seconds
 */
export function OfflineIndicator(): React.ReactElement | null {
  const online = useOnlineStatus();
  const [showReconnected, setShowReconnected] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
    } else if (wasOffline) {
      setShowReconnected(true);
      const timer = setTimeout(() => {
        setShowReconnected(false);
        setWasOffline(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [online, wasOffline]);

  if (!online) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
        <WifiOff className="size-4" />
        You're offline — viewing cached data
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div className={cn(
        'fixed top-0 left-0 right-0 z-50 bg-green-600 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2',
        'animate-in slide-in-from-top duration-300',
      )}>
        <Wifi className="size-4" />
        Back online
      </div>
    );
  }

  return null;
}
