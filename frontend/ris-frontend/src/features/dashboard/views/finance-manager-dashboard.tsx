import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  CreditCard, Landmark, TrendingUp, Clock, ShieldCheck, ArrowRight,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
    <div className="space-y-8 animate-in fade-in-50 duration-300">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Finance Cockpit</h1>
            <Badge variant="gold" className="text-[10px] font-bold uppercase tracking-wider">Dual Auth Enabled</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Disbursement pipeline, payment execution & banking SLAs</p>
        </div>

        <div className="flex items-center gap-3">
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

          <Button asChild variant="gradient" className="font-bold text-xs shadow-md">
            <Link to="/payments">
              <ShieldCheck className="mr-1.5 size-4" />
              Authorize Payments
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Funded Volume"
              value={formatUGX(data.stats.totalFunded)}
              icon={CreditCard}
              change={data.trends.totalFundedChange}
              sparklineData={data.trendData?.map((d) => d.funded).slice(-14)}
              subtitle="All-time portfolio"
            />
            <StatCard
              title="Active Credit Facilities"
              value={String(data.stats.activeFacilities)}
              icon={Landmark}
              subtitle="Partner bank limits"
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
              title="Average Invoice Tenor"
              value={`${data.stats.avgTenorDays} Days`}
              icon={Clock}
              subtitle="Maturity horizon"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TrendChart data={data.trendData} />
            </div>

            {/* Funding Pipeline Widget */}
            <Card className="glass-card shadow-sm">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold font-display">Funding Pipeline</CardTitle>
                  <CardDescription className="text-xs">Invoices pending payment signature</CardDescription>
                </div>
                <Button asChild variant="ghost" size="xs" className="text-xs text-primary font-bold">
                  <Link to="/payments">Cockpit <ArrowRight className="ml-1 size-3" /></Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {pipeline && pipeline.length > 0 ? (
                  pipeline.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between cursor-pointer rounded-xl border border-border/60 p-2.5 hover:bg-muted/50 transition-colors"
                      onClick={() => navigate('/payments')}
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-mono font-bold text-primary truncate">{item.invoiceRef}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.supplierName}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <AmountDisplay value={item.advanceAmount} className="text-xs font-mono font-bold" />
                        <div className="mt-0.5">
                          <Badge variant="gold" className="text-[10px] font-semibold">{item.paymentMethod}</Badge>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground py-6 text-center">No invoices currently awaiting signature.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default FinanceManagerDashboard;

