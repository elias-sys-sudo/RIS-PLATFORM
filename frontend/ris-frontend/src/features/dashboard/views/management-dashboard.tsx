import { useState } from 'react';
import {
  FileText, CreditCard, TrendingUp, AlertTriangle,
  Clock, Building2, BarChart3, Landmark, Shield,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip,
} from 'recharts';
import { StatCard } from '../components/stat-card';
import { TrendChart } from '../components/trend-chart';
import { StatusBreakdown } from '../components/status-breakdown';
import { RecentActivity } from '../components/recent-activity';
import { useDashboardSummary, useRiskDistribution } from '../hooks/use-dashboard';
import { formatUGX } from '@/lib/format-ugx';
import { PERIOD_OPTIONS, type Period } from '@/types/dashboard.types';
import { RISK_COLORS } from '@/components/charts/chart-theme';
import { ChartTooltip } from '@/components/charts/chart-tooltip';

export function ManagementDashboard(): React.ReactElement {
  const [period, setPeriod] = useState<Period>('30d');
  const { data, isLoading } = useDashboardSummary(period);
  const { data: riskDist } = useRiskDistribution(period);

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-300">
      {/* Executive Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Executive Cockpit</h1>
            <Badge variant="gold" className="text-[10px] font-bold uppercase tracking-wider">
              <Shield className="size-3 mr-1" />
              Executive Suite
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Macro liquidity, portfolio performance & compliance oversight</p>
        </div>

        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-32 rounded-lg bg-background/60 border-border/80 text-xs font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-border/80">
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Portfolio Invoices"
              value={String(data.stats.totalInvoices)}
              icon={FileText}
              change={data.trends.totalFaceValueChange}
              subtitle="vs previous period"
            />
            <StatCard
              title="Total Face Value"
              value={formatUGX(data.stats.totalFaceValue)}
              icon={Landmark}
              change={data.trends.totalFaceValueChange}
              subtitle="Discounting pipeline"
            />
            <StatCard
              title="Total Funded Volume"
              value={formatUGX(data.stats.totalFunded)}
              icon={CreditCard}
              change={data.trends.totalFundedChange}
              sparklineData={data.trendData?.map((d) => d.funded).slice(-14)}
              subtitle="Capital deployed"
            />
            <StatCard
              title="Collection Recovery"
              value={`${data.stats.collectionRate.toFixed(1)}%`}
              icon={TrendingUp}
              change={data.trends.collectionRateChange}
              sparklineData={data.trendData?.map((d) => d.collected).slice(-14)}
              subtitle="Repayment rate"
            />
            <StatCard
              title="Overdue Count"
              value={String(data.stats.overdueCount)}
              icon={AlertTriangle}
              subtitle={formatUGX(data.stats.overdueAmount)}
            />
            <StatCard
              title="Average Tenor"
              value={`${data.stats.avgTenorDays} Days`}
              icon={Clock}
              subtitle="Turnaround cycle"
            />
            <StatCard
              title="Bank Credit Lines"
              value={String(data.stats.activeFacilities)}
              icon={Building2}
              subtitle="Institutional facilities"
            />
            <StatCard
              title="Overdue Exposure"
              value={formatUGX(data.stats.overdueAmount)}
              icon={BarChart3}
              change={data.trends.overdueAmountChange}
              subtitle="Default risk monitor"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TrendChart data={data.trendData} />
            </div>
            {riskDist && riskDist.length > 0 ? (
              <Card className="glass-card shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-bold font-display">Risk Rating Distribution</CardTitle>
                  <CardDescription className="text-xs">Portfolio allocation by credit rating</CardDescription>
                </CardHeader>
                <CardContent className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={riskDist}
                        dataKey="count"
                        nameKey="riskLevel"
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                      >
                        {riskDist.map((r) => (
                          <Cell key={r.riskLevel} fill={RISK_COLORS[r.riskLevel] ?? '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v} invoices`} />} />
                      <Legend formatter={(v: string) => <span className="text-xs capitalize font-medium">{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : (
              <StatusBreakdown data={data.invoiceStatusBreakdown} />
            )}
          </div>

          <RecentActivity items={data.recentActivity} />
        </>
      ) : null}
    </div>
  );
}

export default ManagementDashboard;

