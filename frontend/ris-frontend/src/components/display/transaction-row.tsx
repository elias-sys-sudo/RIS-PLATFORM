import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import { InvoiceStatusBadge } from '@/components/display/status-badge';
import type { InvoiceStatus } from '@/lib/constants';

interface TransactionRowProps {
  invoiceNumber: string;
  buyerName: string;
  amount: string;
  status: string;
  date: string;
  direction: 'credit' | 'debit';
  onClick?: () => void;
  className?: string;
}

/**
 * Compact invoice/payment row for lists and dashboards.
 * All key info visible without tapping (MTN MoMo UX pattern).
 * Minimum 48px height for touch targets.
 */
export function TransactionRow({
  invoiceNumber,
  buyerName,
  amount,
  status,
  date,
  direction,
  onClick,
  className,
}: TransactionRowProps): React.ReactElement {
  const isCredit = direction === 'credit';
  const DirectionIcon = isCredit ? ArrowDownLeft : ArrowUpRight;

  const formattedAmount = formatUGX(amount);
  const formattedDate = formatDate(date);

  const spoken = `${invoiceNumber}, ${buyerName}, ${formattedAmount}, ${status}, ${formattedDate}`;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={spoken}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'flex min-h-12 items-center gap-3 rounded-md border border-transparent px-3 py-2',
        'transition-colors duration-150',
        onClick && 'cursor-pointer hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {/* Direction indicator */}
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          isCredit ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600',
        )}
        aria-hidden="true"
      >
        <DirectionIcon className="size-4" />
      </div>

      {/* Invoice info */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">
          {invoiceNumber}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {buyerName}
        </span>
      </div>

      {/* Status badge */}
      <InvoiceStatusBadge
        status={status as InvoiceStatus}
        className="hidden shrink-0 sm:inline-flex"
      />

      {/* Amount and date — right aligned */}
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span
          className={cn(
            'font-mono text-sm font-medium tabular-nums',
            isCredit ? 'text-green-600' : 'text-foreground',
          )}
        >
          {isCredit ? '+' : '-'}{formattedAmount}
        </span>
        <span className="text-xs text-muted-foreground">
          {formattedDate}
        </span>
      </div>
    </div>
  );
}
