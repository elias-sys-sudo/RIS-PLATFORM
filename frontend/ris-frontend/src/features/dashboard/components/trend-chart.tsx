import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { CHART_COLORS, GRID_CONFIG, AXIS_LABEL_CONFIG, AXIS_VALUE_CONFIG, formatCompactValue } from '@/components/charts/chart-theme';
import { ChartTooltip } from '@/components/charts/chart-tooltip';
import type { TrendDataPoint } from '@/types/dashboard.types';

interface TrendChartProps {
  data: TrendDataPoint[];
}

export function TrendChart({ data }: TrendChartProps): React.ReactElement {
  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="text-base">Funding & Collection Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="fundedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.12} />
                  <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="collectedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.12} />
                  <stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_CONFIG} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) =>
                  new Date(d).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })
                }
                {...AXIS_LABEL_CONFIG}
              />
              <YAxis tickFormatter={formatCompactValue} {...AXIS_VALUE_CONFIG} width={50} />
              <Tooltip
                content={<ChartTooltip labelFormatter={(d) => new Date(String(d)).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })} />}
                cursor={{ stroke: '#E7E5E4', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Area
                type="monotone"
                dataKey="funded"
                stroke={CHART_COLORS.primary}
                fill="url(#fundedGrad)"
                name="Funded"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
              />
              <Area
                type="monotone"
                dataKey="collected"
                stroke={CHART_COLORS.secondary}
                fill="url(#collectedGrad)"
                name="Collected"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
