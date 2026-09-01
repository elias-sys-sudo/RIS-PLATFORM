import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CreditCard, Landmark, TrendingUp, Clock,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '../components/stat-card';
import { TrendChart } from '../components/trend-chart';
import { useDashboardSummary, useFundingPipeline } from '../hooks/use-dashboard';
import { formatUGX } from '@/lib/format-ugx';
import { AmountDisplay } from '@/components/display/amount-display';
import { PERIOD_OPTIONS, type Period } from '@/types/dashboard.types';

export function FinanceManagerDashboard(): React.ReactElement {
  const [period, setPeriod] = useState<Period>('30d');
  const navigate = useNavigate();
  const { data, isLoading } = useDashboardSummary(period);
  const { data: pipeline } = useFundingPipeline();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Finance Dashboard</h1>
          <p className="text-sm text-muted-foreground">Funding pipeline & payment SLAs</p>
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
            <StatCard title="Total Funded" value={formatUGX(data.stats.totalFunded)} icon={CreditCard} change={data.trends.totalFundedChange} sparklineData={data.trendData?.map(d => d.funded).slice(-14)} />
            <StatCard title="Active Facilities" value={String(data.stats.activeFacilities)} icon={Landmark} />
            <StatCard title="Collection Rate" value={`${data.stats.collectionRate.toFixed(1)}%`} icon={TrendingUp} change={data.trends.collectionRateChange} sparklineData={data.trendData?.map(d => d.collected).slice(-14)} />
            <StatCard title="Avg Tenor" value={`${data.stats.avgTenorDays}d`} icon={Clock} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TrendChart data={data.trendData} />
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">Funding Pipeline</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {pipeline?.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center justify-between cursor-pointer rounded-md p-2 -mx-2 hover:bg-muted/50" onClick={() => navigate('/payments')}>
                    <div className="min-w-0">
                      <p className="text-sm font-mono truncate">{item.invoiceRef}</p>
                      <p className="text-xs text-muted-foreground">{item.supplierName}</p>
                    </div>
                    <div className="text-right">
                      <AmountDisplay value={item.advanceAmount} className="text-xs" />
                      <Badge variant="outline" className="text-[10px] ml-1">{item.paymentMethod}</Badge>
                    </div>
                  </div>
                )) ?? <p className="text-sm text-muted-foreground">No invoices in pipeline.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
