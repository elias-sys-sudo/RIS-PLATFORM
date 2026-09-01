import { useState } from 'react';
import { FileText, BarChart3, TrendingUp, AlertTriangle } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { StatCard } from '../components/stat-card';
import { TrendChart } from '../components/trend-chart';
import { StatusBreakdown } from '../components/status-breakdown';
import { useDashboardSummary } from '../hooks/use-dashboard';
import { formatUGX } from '@/lib/format-ugx';
import { PERIOD_OPTIONS, type Period } from '@/types/dashboard.types';
import { useNavigate } from 'react-router-dom';

export function AuditorDashboard(): React.ReactElement {
  const [period, setPeriod] = useState<Period>('30d');
  const navigate = useNavigate();
  const { data, isLoading } = useDashboardSummary(period);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Auditor Dashboard</h1>
          <p className="text-sm text-muted-foreground">Portfolio overview & audit access</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/reporting/audit-export')}>Audit Export</Button>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : data ? (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Total Invoices" value={String(data.stats.totalInvoices)} icon={FileText} />
            <StatCard title="Total Funded" value={formatUGX(data.stats.totalFunded)} icon={BarChart3} sparklineData={data.trendData?.map(d => d.funded).slice(-14)} />
            <StatCard title="Collection Rate" value={`${data.stats.collectionRate.toFixed(1)}%`} icon={TrendingUp} />
            <StatCard title="Overdue" value={String(data.stats.overdueCount)} icon={AlertTriangle} />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2"><TrendChart data={data.trendData} /></div>
            <StatusBreakdown data={data.invoiceStatusBreakdown} />
          </div>
        </>
      ) : null}
    </div>
  );
}
