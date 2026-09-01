import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck, FileText, AlertTriangle, BarChart3,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '../components/stat-card';
import { TrendChart } from '../components/trend-chart';
import { useDashboardSummary, useApprovalQueue } from '../hooks/use-dashboard';
import { AmountDisplay } from '@/components/display/amount-display';
import { PERIOD_OPTIONS, type Period } from '@/types/dashboard.types';

export function CreditOfficerDashboard(): React.ReactElement {
  const [period, setPeriod] = useState<Period>('30d');
  const navigate = useNavigate();
  const { data, isLoading } = useDashboardSummary(period);
  const { data: queue } = useApprovalQueue();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Credit Officer Dashboard</h1>
          <p className="text-sm text-muted-foreground">Approval queue & portfolio risk</p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : data ? (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Pending Approvals" value={String(queue?.length ?? 0)} icon={ShieldCheck} />
            <StatCard title="Total Invoices" value={String(data.stats.totalInvoices)} icon={FileText} change={data.trends.totalFaceValueChange} />
            <StatCard title="Overdue" value={String(data.stats.overdueCount)} icon={AlertTriangle} />
            <StatCard title="Collection Rate" value={`${data.stats.collectionRate.toFixed(1)}%`} icon={BarChart3} change={data.trends.collectionRateChange} sparklineData={data.trendData?.map(d => d.collected).slice(-14)} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TrendChart data={data.trendData} />
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">Approval Queue</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {queue?.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center justify-between cursor-pointer rounded-md p-2 -mx-2 hover:bg-muted/50" onClick={() => navigate('/approvals')}>
                    <div className="min-w-0">
                      <p className="text-sm font-mono truncate">{item.invoiceRef}</p>
                      <p className="text-xs text-muted-foreground">{item.supplierName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <AmountDisplay value={item.faceValue} className="text-xs" />
                      <Badge variant="outline" className="text-[10px] capitalize">{item.riskLevel}</Badge>
                    </div>
                  </div>
                )) ?? <p className="text-sm text-muted-foreground">No pending approvals.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
