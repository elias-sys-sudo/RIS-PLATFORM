import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUGX } from '@/lib/format-ugx';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FacilityGaugeProps {
  utilized: string;
  total: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorten a UGX BigInt string for compact display: "38600000000" -> "38.6B" */
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

function calculatePercentage(utilized: string, total: string): number {
  const u = Number(utilized.replace(/[^0-9-]/g, ''));
  const t = Number(total.replace(/[^0-9-]/g, ''));
  if (t <= 0) return 0;
  return Math.min((u / t) * 100, 100);
}

function getArcColor(pct: number): string {
  if (pct > 85) return '#DC2626';  // red
  if (pct > 70) return '#D97706';  // amber
  return '#16A34A';                // green
}

// ---------------------------------------------------------------------------
// SVG constants
// ---------------------------------------------------------------------------

const SIZE = 160;
const STROKE_WIDTH = 12;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FacilityGauge({
  utilized,
  total,
  className,
}: FacilityGaugeProps): React.ReactElement {
  const totalNum = Number(total.replace(/[^0-9-]/g, ''));

  if (totalNum <= 0) {
    return (
      <Card className={cn(className)}>
        <CardHeader>
          <CardTitle className="text-base">Facility Utilisation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-12 text-center text-sm text-muted-foreground">
            No data
          </p>
        </CardContent>
      </Card>
    );
  }

  const pct = calculatePercentage(utilized, total);
  const arcColor = getArcColor(pct);
  const dashOffset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="text-base">Facility Utilisation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <div
          role="meter"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Facility utilization"
          className="relative"
        >
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="-rotate-90"
          >
            <title>Facility utilisation gauge</title>
            <desc>
              {`${Math.round(pct)}% utilised. ${formatUGX(utilized)} of ${formatUGX(total)}.`}
            </desc>

            {/* Background track */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke="hsl(var(--muted))"
              strokeWidth={STROKE_WIDTH}
            />

            {/* Progress arc */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={arcColor}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="transition-all duration-500 ease-out"
            />
          </svg>

          {/* Center text overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold font-display">
              {Math.round(pct)}%
            </span>
            <span className="text-xs font-mono text-muted-foreground">
              utilised
            </span>
          </div>
        </div>

        {/* Utilized / Total caption */}
        <p className="mt-3 text-xs font-mono text-muted-foreground text-center">
          {formatCompactUGX(utilized)} / {formatCompactUGX(total)}
        </p>
      </CardContent>
    </Card>
  );
}
