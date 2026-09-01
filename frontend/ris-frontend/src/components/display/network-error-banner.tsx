import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface NetworkErrorBannerProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Banner displayed when an API call fails due to network issues.
 * Shows an error message with an optional retry button.
 */
export function NetworkErrorBanner({
  message = 'Failed to load data. Please check your connection.',
  onRetry,
  className,
}: NetworkErrorBannerProps): React.ReactElement {
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4',
      className,
    )}>
      <AlertTriangle className="size-5 text-destructive shrink-0" />
      <p className="flex-1 text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
          <RefreshCw className="mr-2 size-3" /> Retry
        </Button>
      )}
    </div>
  );
}
