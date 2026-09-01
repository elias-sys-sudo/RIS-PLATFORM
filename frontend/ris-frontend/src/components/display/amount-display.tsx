import { formatUGX } from '@/lib/format-ugx';
import { cn } from '@/lib/cn';

function humanReadableUGX(raw: string): string {
  const num = Math.abs(Number(raw));
  if (isNaN(num) || num === 0) return '0 Uganda Shillings';
  let readable: string;
  if (num >= 1_000_000_000) readable = `${(num / 1_000_000_000).toFixed(1)} billion`;
  else if (num >= 1_000_000) readable = `${(num / 1_000_000).toFixed(1)} million`;
  else if (num >= 1_000) readable = `${(num / 1_000).toFixed(1)} thousand`;
  else readable = String(num);
  return `${readable} Uganda Shillings`;
}

interface AmountDisplayProps {
  value: string | number | null | undefined;
  className?: string;
  /** Show in green for positive, red for negative */
  colorCoded?: boolean;
}

/**
 * Renders a UGX amount from a BIGINT string in monospace font.
 * Includes a screen-reader-friendly aria-label.
 */
export function AmountDisplay({ value, className, colorCoded }: AmountDisplayProps): React.ReactElement {
  const display = formatUGX(value);
  const numericStr = value != null ? String(value).replace(/[^0-9-]/g, '') : '';
  const isNeg = numericStr.startsWith('-');

  // Build spoken form for screen readers (human-readable)
  const spoken = value != null && numericStr !== ''
    ? `${humanReadableUGX(numericStr)}${isNeg ? ' negative' : ''}`
    : 'no amount';

  return (
    <span
      className={cn(
        'font-mono text-sm tabular-nums',
        colorCoded && isNeg && 'text-destructive',
        colorCoded && !isNeg && numericStr !== '' && numericStr !== '0' && 'text-green-600',
        className,
      )}
      aria-label={spoken}
    >
      {display}
    </span>
  );
}
