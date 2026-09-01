import { formatRelative, formatAbsolute, formatDate } from '@/lib/format-date';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DateDisplayProps {
  value: string | null | undefined;
  /** 'relative' shows "2 hours ago", 'absolute' shows full datetime, 'date' shows date only */
  variant?: 'relative' | 'absolute' | 'date';
  className?: string;
}

/**
 * Renders a date with a tooltip showing the alternate format.
 * Relative dates show absolute on hover; absolute/date show relative on hover.
 */
export function DateDisplay({ value, variant = 'relative', className }: DateDisplayProps): React.ReactElement {
  if (!value) return <span className={className}>—</span>;

  const primary = variant === 'relative'
    ? formatRelative(value)
    : variant === 'date'
      ? formatDate(value)
      : formatAbsolute(value);

  const tooltip = variant === 'relative' ? formatAbsolute(value) : formatRelative(value);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{primary}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
