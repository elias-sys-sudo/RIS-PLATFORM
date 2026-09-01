import { cn } from '@/lib/cn';

interface DataBarProps {
  value: number;
  max?: number;
  showLabel?: boolean;
  className?: string;
}

function getBarColor(pct: number): string {
  if (pct > 85) return 'bg-red-500';
  if (pct > 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function DataBar({
  value,
  max = 100,
  showLabel = true,
  className,
}: DataBarProps): React.ReactElement {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-2 w-20 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', getBarColor(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-mono tabular-nums text-muted-foreground w-10 text-right">
          {pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
