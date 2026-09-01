import { cn } from '@/lib/cn';
import { formatUGX } from '@/lib/format-ugx';

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
  payload: Record<string, unknown>;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  /** Format the value. Defaults to formatUGX */
  valueFormatter?: (value: number) => string;
  /** Format the tooltip header label */
  labelFormatter?: (label: string) => string;
  className?: string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter = (v) => formatUGX(v),
  labelFormatter,
  className,
}: ChartTooltipProps): React.ReactElement | null {
  if (!active || !payload?.length) return null;

  const formattedLabel = labelFormatter ? labelFormatter(String(label)) : String(label ?? '');

  return (
    <div className={cn(
      'bg-card border border-border rounded-lg shadow-lg p-3 min-w-[180px] max-w-[280px]',
      'animate-in fade-in-0 zoom-in-95 duration-150',
      className,
    )}>
      {formattedLabel && (
        <p className="text-xs font-medium text-muted-foreground mb-2">{formattedLabel}</p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-sm text-foreground">
              <span
                className="size-2 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="text-sm font-mono tabular-nums font-semibold text-foreground">
              {valueFormatter(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
