import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUGX } from '@/lib/format-ugx';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FunnelStage {
  label: string;
  count: number;
  amount: string;
}

interface CollectionFunnelProps {
  stages: FunnelStage[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_COLORS: string[] = [
  'bg-green-600',  // Total Collectible
  'bg-teal-500',   // Contacted
  'bg-amber-500',  // Partial Payment
  'bg-emerald-600', // Fully Collected
];

function colorForIndex(index: number): string {
  return STAGE_COLORS[index % STAGE_COLORS.length];
}

/** Shorten a UGX BigInt string for compact display */
function formatCompactUGX(raw: string): string {
  const cleaned = raw.replace(/[^0-9-]/g, '');
  if (cleaned === '' || cleaned === '-') return 'UGX 0';

  const abs = Math.abs(Number(cleaned));
  const sign = cleaned.startsWith('-') ? '-' : '';

  let compact: string;
  if (abs >= 1_000_000_000_000) {
    compact = `${sign}${(abs / 1_000_000_000_000).toFixed(1)}T`;
  } else if (abs >= 1_000_000_000) {
    compact = `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  } else if (abs >= 1_000_000) {
    compact = `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  } else if (abs >= 1_000) {
    compact = `${sign}${(abs / 1_000).toFixed(0)}K`;
  } else {
    compact = `${sign}${abs}`;
  }

  return `UGX ${compact}`;
}

function conversionRate(from: number, to: number): string {
  if (from <= 0) return '0%';
  return `${Math.round((to / from) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CollectionFunnel({
  stages,
  className,
}: CollectionFunnelProps): React.ReactElement {
  if (stages.length === 0) {
    return (
      <Card className={cn(className)}>
        <CardHeader>
          <CardTitle className="text-base">Collection Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-12 text-center text-sm text-muted-foreground">
            No data
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="text-base">Collection Funnel</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          role="figure"
          aria-label="Collection conversion funnel"
        >
          <div className="flex flex-col gap-2">
            {stages.map((stage, index) => {
              const widthPct = Math.max(
                (stage.count / maxCount) * 100,
                8, // minimum 8% width so tiny bars are still visible
              );
              const prevStage = index > 0 ? stages[index - 1] : null;

              return (
                <div key={stage.label}>
                  {/* Conversion arrow between stages */}
                  {prevStage && (
                    <div className="flex items-center justify-center py-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {conversionRate(prevStage.count, stage.count)} &darr;
                      </span>
                    </div>
                  )}

                  {/* Stage row */}
                  <div className="flex items-center gap-3">
                    {/* Label — fixed width */}
                    <span className="w-36 shrink-0 truncate text-sm text-foreground">
                      {stage.label}
                    </span>

                    {/* Bar */}
                    <div className="relative flex-1">
                      <div
                        className={cn(
                          'h-8 rounded transition-all duration-300',
                          colorForIndex(index),
                        )}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>

                    {/* Count + amount */}
                    <div className="w-40 shrink-0 text-right">
                      <span className="text-sm font-medium tabular-nums">
                        {stage.count}
                      </span>
                      <span className="ml-2 text-xs font-mono text-muted-foreground">
                        {formatCompactUGX(stage.amount)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Accessible data table — visually hidden */}
          <table className="sr-only">
            <caption>Collection conversion funnel</caption>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Count</th>
                <th scope="col">Amount</th>
                <th scope="col">Conversion from previous</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage, index) => {
                const prev = index > 0 ? stages[index - 1] : null;
                return (
                  <tr key={stage.label}>
                    <td>{stage.label}</td>
                    <td>{stage.count}</td>
                    <td>{formatUGX(stage.amount)}</td>
                    <td>
                      {prev
                        ? conversionRate(prev.count, stage.count)
                        : 'N/A'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
