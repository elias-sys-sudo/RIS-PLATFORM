import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUGX } from '@/lib/format-ugx';
import { cn } from '@/lib/cn';
import { AGING_COLORS, GRID_CONFIG } from '@/components/charts/chart-theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgingBucket {
  label: string;
  count: number;
  amount: string;
}

interface AgingWaterfallProps {
  data: AgingBucket[];
  className?: string;
}

/** Bucket augmented with numeric amount + proportion for charting. */
interface ChartBucket extends AgingBucket {
  amountN: number;
  share: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function colorForIndex(index: number): string {
  return AGING_COLORS[index] ?? AGING_COLORS[AGING_COLORS.length - 1];
}

/** Shorten a UGX string: "UGX 38,600,000,000" -> "38.6B" */
function formatCompactUGX(raw: string | number): string {
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^0-9-]/g, ''));
  if (!Number.isFinite(n) || n === 0) return 'UGX 0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000_000) return `UGX ${sign}${(abs / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000)     return `UGX ${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000)         return `UGX ${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)             return `UGX ${sign}${(abs / 1_000).toFixed(0)}K`;
  return `UGX ${sign}${abs}`;
}

// ---------------------------------------------------------------------------
// Custom bar label — shows count above each bar for quick scan
// ---------------------------------------------------------------------------

function CountLabel(
  data: ChartBucket[],
  props: Record<string, unknown>,
): React.ReactElement | null {
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const w = Number(props.width ?? 0);
  const index = typeof props.index === 'number' ? props.index : -1;
  if (index < 0 || !data[index]) return null;
  const b = data[index];
  if (b.count === 0) return null;
  return (
    <text
      x={x + w / 2}
      y={y - 8}
      textAnchor="middle"
      className="fill-foreground text-xs font-semibold"
      aria-hidden="true"
    >
      {b.count} {b.count === 1 ? 'invoice' : 'invoices'}
    </text>
  );
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

interface TooltipPayloadEntry {
  payload: ChartBucket;
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}

function AgingTooltip({ active, payload }: CustomTooltipProps): React.ReactElement | null {
  if (!active || !payload?.[0]) return null;
  const b = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 shadow-md">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ backgroundColor: b.color }} />
        <p className="text-sm font-semibold">{b.label}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {b.count} invoice{b.count === 1 ? '' : 's'} &middot; {formatUGX(b.amount)}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {b.share.toFixed(1)}% of outstanding
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgingWaterfall({
  data,
  className,
}: AgingWaterfallProps): React.ReactElement {
  const total = data.reduce((s, b) => s + Number(b.amount || 0), 0);

  const chartData: ChartBucket[] = data.map((b, i) => {
    const amountN = Number(b.amount || 0);
    return {
      ...b,
      amountN,
      share: total > 0 ? (amountN / total) * 100 : 0,
      color: colorForIndex(i),
    };
  });

  const hasAny = chartData.some((b) => b.amountN > 0 || b.count > 0);

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Invoice Aging</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Outstanding exposure by days past due. Hover any bar for counts and share.
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-2 text-[11px] text-muted-foreground sm:flex">
            <span className="size-2 rounded-full bg-[#16A34A]" /> Current
            <span className="size-2 rounded-full bg-[#D97706] ml-1" /> Early
            <span className="size-2 rounded-full bg-[#EA580C] ml-1" /> Late
            <span className="size-2 rounded-full bg-[#E11D48] ml-1" /> Critical
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No outstanding invoices in any aging bucket.
          </p>
        ) : (
          <div role="figure" aria-label="Invoice aging distribution by amount outstanding">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={chartData}
                margin={{ top: 28, right: 12, left: 4, bottom: 0 }}
                barCategoryGap="20%"
              >
                <CartesianGrid {...GRID_CONFIG} />
                <XAxis
                  dataKey="label"
                  className="text-xs"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  className="text-xs"
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v: number) => formatCompactUGX(v)}
                />
                <Tooltip
                  content={<AgingTooltip />}
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                />
                <Bar
                  dataKey="amountN"
                  radius={[6, 6, 0, 0]}
                  minPointSize={2}
                  isAnimationActive={false}
                  fill="#16A34A"
                  shape={(shapeProps: unknown) => {
                    const props = shapeProps as { x?: number; y?: number; width?: number; height?: number; index?: number };
                    const x = Number(props.x ?? 0);
                    const y = Number(props.y ?? 0);
                    const w = Number(props.width ?? 0);
                    const h = Number(props.height ?? 0);
                    const index = typeof props.index === 'number' ? props.index : 0;
                    const bucket = chartData[index];
                    const fill = bucket?.color ?? '#16A34A';
                    const opacity = bucket && bucket.amountN === 0 ? 0.15 : 1;
                    const r = 6;
                    // Rounded top corners only
                    const d = `M ${x},${y + h}
                              L ${x},${y + r}
                              Q ${x},${y} ${x + r},${y}
                              L ${x + w - r},${y}
                              Q ${x + w},${y} ${x + w},${y + r}
                              L ${x + w},${y + h} Z`;
                    return <path d={d} fill={fill} fillOpacity={opacity} />;
                  }}
                >
                  <LabelList
                    dataKey="amountN"
                    position="top"
                    content={(props) => CountLabel(chartData, props as Record<string, unknown>)}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Share strip under chart — quick visual sense of portfolio concentration */}
            {total > 0 && (
              <div className="mt-4 overflow-hidden rounded-md border">
                <div className="flex h-6">
                  {chartData.map((b, i) => (
                    b.share > 0 && (
                      <div
                        key={`share-${String(i)}`}
                        title={`${b.label}: ${b.share.toFixed(1)}%`}
                        className="flex items-center justify-center text-[10px] font-semibold text-white"
                        style={{
                          width: `${b.share}%`,
                          backgroundColor: b.color,
                          minWidth: b.share < 5 ? '2.25rem' : undefined,
                        }}
                      >
                        {b.share >= 8 ? `${b.share.toFixed(0)}%` : ''}
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            {/* Accessible data table — visually hidden */}
            <table className="sr-only">
              <caption>Invoice aging distribution</caption>
              <thead>
                <tr>
                  <th scope="col">Bucket</th>
                  <th scope="col">Count</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td>{b.count}</td>
                    <td>{formatUGX(b.amount)}</td>
                    <td>{b.share.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
