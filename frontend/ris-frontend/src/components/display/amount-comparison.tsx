import { cn } from '@/lib/cn';
import { formatUGX } from '@/lib/format-ugx';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

type AmountType = 'neutral' | 'credit' | 'debit';

interface AmountItem {
  label: string;
  amount: string;
  type?: AmountType;
}

interface AmountComparisonProps {
  heroLabel: string;
  heroAmount: string;
  items: AmountItem[];
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildSpokenAmount(raw: string): string {
  const cleaned = raw.replace(/[^0-9-]/g, '');
  if (cleaned === '' || cleaned === '-') return 'no amount';
  const abs = cleaned.replace('-', '');
  const neg = cleaned.startsWith('-') ? ' negative' : '';
  return `${abs} Uganda shillings${neg}`;
}

const TYPE_ICON: Record<AmountType, typeof ArrowUp> = {
  credit: ArrowUp,
  debit:  ArrowDown,
  neutral: Minus,
};

const TYPE_COLOR: Record<AmountType, string> = {
  credit:  'text-[var(--color-credit)]',
  debit:   'text-[var(--color-debit)]',
  neutral: 'text-muted-foreground',
};

const TYPE_ICON_COLOR: Record<AmountType, string> = {
  credit:  'text-[var(--color-credit)]',
  debit:   'text-[var(--color-debit)]',
  neutral: 'text-muted-foreground',
};

// ── Line item ──────────────────────────────────────────────────────────────

function ComparisonItem({
  item,
}: {
  item: AmountItem;
}): React.ReactElement {
  const type: AmountType = item.type ?? 'neutral';
  const Icon = TYPE_ICON[type];

  return (
    <div className="flex items-center gap-2">
      <Icon
        className={cn('size-3.5 shrink-0', TYPE_ICON_COLOR[type])}
        aria-hidden="true"
      />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{item.label}</span>
        <span
          className={cn(
            'text-sm font-mono tabular-nums font-medium',
            TYPE_COLOR[type],
          )}
          aria-label={`${item.label}: ${buildSpokenAmount(item.amount)}`}
        >
          {formatUGX(item.amount)}
        </span>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Side-by-side financial amount comparison with a hero "You Receive" pattern.
 *
 * - Hero amount rendered in 30px Geist Mono bold (via `text-3xl font-bold font-mono`)
 * - Secondary items show directional arrows: green up for credit, red down for debit
 * - All amounts formatted with `formatUGX()` -- never raw integers
 * - Screen-reader-friendly `aria-label` on the hero value
 */
export function AmountComparison({
  heroLabel,
  heroAmount,
  items,
  className,
}: AmountComparisonProps): React.ReactElement {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Hero amount */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground">
          {heroLabel}
        </span>
        <span
          className="text-3xl font-bold font-mono tabular-nums text-foreground"
          aria-label={`${heroLabel}: ${buildSpokenAmount(heroAmount)}`}
        >
          {formatUGX(heroAmount)}
        </span>
      </div>

      {/* Secondary items */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {items.map((item) => (
            <ComparisonItem key={item.label} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
