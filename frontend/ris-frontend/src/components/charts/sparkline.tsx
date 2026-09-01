import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { cn } from '@/lib/cn';
import { CHART_COLORS } from './chart-theme';

interface SparklineProps {
  data: number[];
  color?: string;
  trend?: 'up' | 'down' | 'flat';
  className?: string;
  label: string;
}

export function Sparkline({
  data,
  color,
  trend = 'flat',
  className,
  label,
}: SparklineProps): React.ReactElement | null {
  if (!data.length || data.length < 2) return null;

  const resolvedColor = color ?? (
    trend === 'up' ? CHART_COLORS.success :
    trend === 'down' ? CHART_COLORS.danger :
    CHART_COLORS.muted
  );

  const chartData = data.map((value, index) => ({ index, value }));
  const gradientId = `sparkline-${label.replace(/\s/g, '-')}`;

  return (
    <div
      className={cn('w-16 h-6', className)}
      role="img"
      aria-label={`Trend for ${label}: ${trend === 'up' ? 'increasing' : trend === 'down' ? 'decreasing' : 'stable'}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={resolvedColor} stopOpacity={0.15} />
              <stop offset="100%" stopColor={resolvedColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={resolvedColor}
            fill={`url(#${gradientId})`}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
