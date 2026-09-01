import { useState } from 'react';
import {
  FileText, CreditCard, TrendingUp, AlertTriangle,
  Clock, Building2, BarChart3, Landmark,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Management Dashboard</h1>
          <p className="text-sm text-muted-foreground">Executive portfolio overview</p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : data ? (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Total Invoices" value={String(data.stats.totalInvoices)} icon={FileText} change={data.trends.totalFaceValueChange} subtitle="vs prev" />
            <StatCard title="Total Face Value" value={formatUGX(data.stats.totalFaceValue)} icon={Landmark} change={data.trends.totalFaceValueChange} />
            <StatCard title="Total Funded" value={formatUGX(data.stats.totalFunded)} icon={CreditCard} change={data.trends.totalFundedChange} sparklineData={data.trendData?.map(d => d.funded).slice(-14)} />
            <StatCard title="Collection Rate" value={`${data.stats.collectionRate.toFixed(1)}%`} icon={TrendingUp} change={data.trends.collectionRateChange} sparklineData={data.trendData?.map(d => d.collected).slice(-14)} />
            <StatCard title="Overdue" value={String(data.stats.overdueCount)} icon={AlertTriangle} subtitle={formatUGX(data.stats.overdueAmount)} />
            <StatCard title="Avg Tenor" value={`${data.stats.avgTenorDays}d`} icon={Clock} />
            <StatCard title="Facilities" value={String(data.stats.activeFacilities)} icon={Building2} />
            <StatCard title="Overdue Amount" value={formatUGX(data.stats.overdueAmount)} icon={BarChart3} change={data.trends.overdueAmountChange} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2"><TrendChart data={data.trendData} /></div>
            {riskDist && riskDist.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="text-base">Risk Distribution</CardTitle></CardHeader>
                <CardContent className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={riskDist} dataKey="count" nameKey="riskLevel" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                        {riskDist.map((r) => <Cell key={r.riskLevel} fill={RISK_COLORS[r.riskLevel] ?? '#94a3b8'} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v} invoices`} />} />
                      <Legend formatter={(v: string) => <span className="text-xs capitalize">{v}</span>} />
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
