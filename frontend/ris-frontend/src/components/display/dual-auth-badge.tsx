import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format-date';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { Check, Clock } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface AuthEntry {
  role: string;
  authorizedAt: string;
}

interface DualAuthBadgeProps {
  firstAuth?: AuthEntry;
  secondAuth?: AuthEntry;
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildTooltipText(auth: AuthEntry | undefined): string {
  if (!auth) return 'Pending authorization';
  return `${auth.role} \u2014 ${formatRelative(auth.authorizedAt)}`;
}

// ── Slot ───────────────────────────────────────────────────────────────────

function AuthSlot({
  auth,
  label,
}: {
  auth: AuthEntry | undefined;
  label: string;
}): React.ReactElement {
  const isDone = auth !== undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col items-center gap-1">
          <Avatar size="default">
            <AvatarFallback
              className={cn(
                isDone
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {isDone ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Clock className="size-4" aria-hidden="true" />
              )}
            </AvatarFallback>
          </Avatar>
          <span className="text-[11px] leading-tight text-muted-foreground">
            {label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {buildTooltipText(auth)}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function DualAuthBadge({
  firstAuth,
  secondAuth,
  className,
}: DualAuthBadgeProps): React.ReactElement {
  const awaitingSecond = firstAuth !== undefined && secondAuth === undefined;

  return (
    <div
      className={cn('flex flex-col items-center gap-2', className)}
      role="group"
      aria-label="Dual authorization status"
    >
      <div className="flex items-start gap-3">
        <AuthSlot
          auth={firstAuth}
          label={firstAuth?.role ?? 'First Auth'}
        />
        <AuthSlot
          auth={secondAuth}
          label={secondAuth?.role ?? 'Second Auth'}
        />
      </div>

      {awaitingSecond && (
        <span className="text-xs font-medium text-amber-600">
          Awaiting second authorization
        </span>
      )}
    </div>
  );
}
