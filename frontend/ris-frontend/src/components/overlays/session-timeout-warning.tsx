import { Clock } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface SessionTimeoutWarningProps {
  open: boolean;
  secondsRemaining: number;
  onExtend: () => void;
  onLogout: () => void;
}

function getCountdownColor(seconds: number): string {
  if (seconds > 30) return 'text-green-600';
  if (seconds >= 10) return 'text-amber-500';
  return 'text-red-600';
}

export function SessionTimeoutWarning({
  open,
  secondsRemaining,
  onExtend,
  onLogout,
}: SessionTimeoutWarningProps): React.ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Only allow closing via the explicit buttons — ignore overlay click / Escape
        if (!isOpen) return;
      }}
    >
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        aria-label="Session timeout warning"
      >
        <DialogHeader className="items-center sm:items-center sm:text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
            <Clock
              className="size-6 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
          </div>
          <DialogTitle className="text-center">Session Expiring</DialogTitle>
          <DialogDescription className="text-center text-base">
            Your session will expire in{' '}
            <span
              className={cn(
                'text-3xl font-mono font-bold tabular-nums inline-block min-w-[3ch]',
                getCountdownColor(secondsRemaining),
              )}
              aria-live="assertive"
              aria-atomic="true"
            >
              {secondsRemaining}
            </span>{' '}
            seconds due to inactivity.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="sm:justify-center gap-3 pt-2">
          <Button
            variant="outline"
            onClick={onLogout}
          >
            Log Out
          </Button>
          <Button
            onClick={onExtend}
            className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
          >
            Extend Session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
