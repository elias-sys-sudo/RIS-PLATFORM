import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/cn';

interface SlaCountdownProps {
  /** ISO timestamp when the SLA period started */
  startedAt: string;
  /** SLA duration in hours (72 for payments, 24 for approvals) */
  slaHours: number;
  className?: string;
}

function getRemaining(startedAt: string, slaHours: number): number {
  const deadline = new Date(startedAt).getTime() + slaHours * 60 * 60 * 1000;
  return Math.max(0, deadline - Date.now());
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'BREACHED';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getVariant(ms: number, slaHours: number): string {
  if (ms <= 0) return 'bg-red-100 text-red-800 border-red-300';
  const ratio = ms / (slaHours * 60 * 60 * 1000);
  if (ratio > 0.67) return 'bg-green-50 text-green-700 border-green-200';
  if (ratio > 0.33) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

/**
 * Live countdown timer for SLA deadlines.
 * Green (>67% remaining) → Amber (33-67%) → Red (<33%) → BREACHED (0)
 */
export function SlaCountdown({ startedAt, slaHours, className }: SlaCountdownProps): React.ReactElement {
  const [remaining, setRemaining] = useState(() => getRemaining(startedAt, slaHours));

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(getRemaining(startedAt, slaHours));
    }, 60_000);
    return () => clearInterval(id);
  }, [startedAt, slaHours]);

  const display = formatCountdown(remaining);
  const variant = getVariant(remaining, slaHours);

  return (
    <Badge variant="outline" className={cn('text-[11px] font-mono font-medium gap-1', variant, className)}>
      <Clock className="size-3" />
      {display}
    </Badge>
  );
}
