import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck, FileText, AlertTriangle, BarChart3, ArrowRight, CheckCircle2,
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
import { useDashboardSummary, useApprovalQueue } from '../hooks/use-dashboard';
import { AmountDisplay } from '@/components/display/amount-display';
import { PERIOD_OPTIONS, type Period } from '@/types/dashboard.types';

export function CreditOfficerDashboard(): React.ReactElement {
  const [period, setPeriod] = useState<Period>('30d');
  const navigate = useNavigate();
  const { data, isLoading } = useDashboardSummary(period);
  const { data: queue } = useApprovalQueue();

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-300">
      {/* Header & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Credit Risk Cockpit</h1>
            <Badge variant="gold" className="text-[10px] font-bold uppercase tracking-wider">Tiered Matrix</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Approval queues, risk scoring distribution & exposure limits</p>
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
            <Link to="/approvals">
              <ShieldCheck className="mr-1.5 size-4" />
              Review Pending ({queue?.length ?? 0})
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
              title="Pending Approvals"
              value={String(queue?.length ?? 0)}
              icon={ShieldCheck}
              subtitle="In credit queue"
            />
            <StatCard
              title="Total Portfolio Invoices"
              value={String(data.stats.totalInvoices)}
              icon={FileText}
              change={data.trends.totalFaceValueChange}
              subtitle="Under management"
            />
            <StatCard
              title="Overdue Invoices"
              value={String(data.stats.overdueCount)}
              icon={AlertTriangle}
              subtitle="Monitoring escalation"
            />
            <StatCard
              title="Collection Recovery"
              value={`${data.stats.collectionRate.toFixed(1)}%`}
              icon={BarChart3}
              change={data.trends.collectionRateChange}
              sparklineData={data.trendData?.map((d) => d.collected).slice(-14)}
              subtitle="Repayment rate"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TrendChart data={data.trendData} />
            </div>

            {/* Approval Queue Widget */}
            <Card className="glass-card shadow-sm">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold font-display">Approval Queue</CardTitle>
                  <CardDescription className="text-xs">Awaiting credit sign-off</CardDescription>
                </div>
                <Button asChild variant="ghost" size="xs" className="text-xs text-primary font-bold">
                  <Link to="/approvals">All <ArrowRight className="ml-1 size-3" /></Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {queue && queue.length > 0 ? (
                  queue.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between cursor-pointer rounded-xl border border-border/60 p-2.5 hover:bg-muted/50 transition-colors"
                      onClick={() => navigate('/approvals')}
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-mono font-bold text-primary truncate">{item.invoiceRef}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.supplierName}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <AmountDisplay value={item.faceValue} className="text-xs font-mono font-bold" />
                        <Badge
                          variant={
                            item.riskLevel === 'low'
                              ? 'success'
                              : item.riskLevel === 'high'
                              ? 'destructive'
                              : 'warning'
                          }
                          className="text-[10px] font-semibold uppercase"
                        >
                          {item.riskLevel}
                        </Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
                    <CheckCircle2 className="size-8 text-emerald-500/60" />
                    <p className="text-xs text-muted-foreground">All approval queues are clear!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default CreditOfficerDashboard;

