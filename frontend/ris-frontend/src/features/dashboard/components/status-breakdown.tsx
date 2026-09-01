import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_COLORS, type InvoiceStatus } from '@/lib/constants';
import { ChartTooltip } from '@/components/charts/chart-tooltip';
import type { InvoiceStatusBreakdownItem } from '@/types/dashboard.types';

interface StatusBreakdownProps {
  data: InvoiceStatusBreakdownItem[];
}

export function StatusBreakdown({ data }: StatusBreakdownProps): React.ReactElement {
  const chartData = data.map((d) => ({
    name: INVOICE_STATUS_LABELS[d.status] ?? d.status,
    value: d.count,
    amount: d.amount,
    color: INVOICE_STATUS_COLORS[d.status as InvoiceStatus] ?? '#94a3b8',
  }));

  const totalCount = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Invoice Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={65}
                outerRadius={100}
                paddingAngle={3}
                cornerRadius={4}
                dataKey="value"
                isAnimationActive={true}
                animationDuration={600}
                animationEasing="ease-out"
              >
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v} invoices`} />} />
            </PieChart>
          </ResponsiveContainer>
          {/* Center metric overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold font-display">{totalCount}</span>
            <span className="text-xs text-muted-foreground">invoices</span>
          </div>
        </div>
        {/* Custom legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 justify-center">
          {chartData.filter(d => d.value > 0).map((d) => (
            <span key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
              {d.name} ({d.value})
            </span>
          ))}
        </div>
        {/* Accessible table */}
        <table className="sr-only">
          <caption>Invoice status distribution</caption>
          <thead><tr><th>Status</th><th>Count</th></tr></thead>
          <tbody>
            {chartData.map((d) => (
              <tr key={d.name}><td>{d.name}</td><td>{d.value}</td></tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
