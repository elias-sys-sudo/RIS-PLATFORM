import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/cn';

// ── Types ──────────────────────────────────────────────────

interface RiskFactor {
  name: string;
  score: number;
  weight: number;
}

interface RiskScoreRadarProps {
  factors: RiskFactor[];
  compositeScore: number;
  className?: string;
}

// ── Score color helpers ────────────────────────────────────

function getScoreColor(score: number): string {
  if (score < 40) return 'text-green-600';
  if (score <= 70) return 'text-amber-600';
  return 'text-red-600';
}

function getScoreLabel(score: number): string {
  if (score < 40) return 'Low Risk';
  if (score <= 70) return 'Medium Risk';
  return 'High Risk';
}

// ── Custom center label ────────────────────────────────────

function CenterLabel({
  cx,
  cy,
  score,
}: {
  cx: number;
  cy: number;
  score: number;
}): React.ReactElement {
  const fill = score < 40 ? '#16A34A' : score <= 70 ? '#D97706' : '#DC2626';
  return (
    <g>
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-current font-mono text-2xl font-bold"
        fill={fill}
      >
        {score}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-muted-foreground text-xs"
      >
        {getScoreLabel(score)}
      </text>
    </g>
  );
}

// ── Accessible data table (visually hidden) ────────────────

function AccessibleTable({
  factors,
  compositeScore,
}: {
  factors: RiskFactor[];
  compositeScore: number;
}): React.ReactElement {
  return (
    <table className="sr-only" aria-label="Risk factor scores">
      <caption>Risk Score Breakdown</caption>
      <thead>
        <tr>
          <th scope="col">Factor</th>
          <th scope="col">Score (0-100)</th>
          <th scope="col">Weight</th>
        </tr>
      </thead>
      <tbody>
        {factors.map((f) => (
          <tr key={f.name}>
            <td>{f.name}</td>
            <td>{f.score}</td>
            <td>{(f.weight * 100).toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Composite Score</td>
          <td>{compositeScore}</td>
          <td>100%</td>
        </tr>
      </tfoot>
    </table>
  );
}

// ── Risk Score Radar ───────────────────────────────────────

/**
 * Recharts RadarChart for 5-factor risk breakdown.
 * Color-blind safe: blue fill with alpha, amber dotted threshold line.
 * Includes SVG title/desc and a visually hidden data table for screen readers.
 */
export function RiskScoreRadar({
  factors,
  compositeScore,
  className,
}: RiskScoreRadarProps): React.ReactElement {
  // Prepare chart data with a fixed 70-point threshold line
  const chartData = factors.map((f) => ({
    name: f.name,
    score: f.score,
    threshold: 70,
    label: `${f.name} (${(f.weight * 100).toFixed(0)}%)`,
  }));

  const descText = factors
    .map((f) => `${f.name}: ${f.score}/100 (${(f.weight * 100).toFixed(0)}%)`)
    .join(', ');

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative h-72 w-full max-w-sm" role="img" aria-label="Risk Score Breakdown">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
            {/* SVG accessibility */}
            <title>Risk Score Breakdown</title>
            <desc>
              Radar chart showing risk scores. {descText}. Composite score: {compositeScore}.
            </desc>

            <PolarGrid stroke="#E7E5E4" />
            <PolarAngleAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#78716C' }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: '#78716C' }}
              tickCount={6}
            />

            {/* Threshold line (amber, dotted) */}
            <Radar
              name="Threshold"
              dataKey="threshold"
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="none"
              dot={false}
            />

            {/* Score fill (blue, semi-transparent) */}
            <Radar
              name="Score"
              dataKey="score"
              stroke="#2563EB"
              strokeWidth={2}
              fill="#2563EB"
              fillOpacity={0.15}
              dot={{ r: 3, fill: '#2563EB' }}
            />

            {/* Center composite score label */}
            <CenterLabel cx={0} cy={0} score={compositeScore} />
          </RadarChart>
        </ResponsiveContainer>

        {/* Overlay composite score on the center of the chart */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <span className={cn('font-mono text-2xl font-bold', getScoreColor(compositeScore))}>
              {compositeScore}
            </span>
            <span className="text-xs text-muted-foreground">
              {getScoreLabel(compositeScore)}
            </span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-[#2563EB]" />
          Score
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0 w-4 border-t border-dashed border-[#F59E0B]" />
          Threshold (70)
        </span>
      </div>

      {/* Accessible alternative */}
      <AccessibleTable factors={factors} compositeScore={compositeScore} />
    </div>
  );
}
