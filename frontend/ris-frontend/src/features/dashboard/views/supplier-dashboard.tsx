import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  FileText, CreditCard, Clock, AlertTriangle, ShieldAlert, ArrowRight, Plus, Sparkles,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatCard } from '../components/stat-card';
import { StatusBreakdown } from '../components/status-breakdown';
import { useSupplierDashboard } from '../hooks/use-dashboard';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { AmountDisplay } from '@/components/display/amount-display';
import { useAuthStore } from '@/store/auth.store';
import { PERIOD_OPTIONS, type Period } from '@/types/dashboard.types';

export function SupplierDashboard(): React.ReactElement {
  const [period, setPeriod] = useState<Period>('30d');
  const navigate = useNavigate();
  const { data, isLoading } = useSupplierDashboard(period);
  const user = useAuthStore((s) => s.user);
  const kycStatus = user?.kycStatus;
  const kycPending = kycStatus === 'pending' || kycStatus === 'in_progress';
  const kycRejected = kycStatus === 'rejected';
  const isMobile = useIsMobile();
  const statGrid = isMobile ? 'grid gap-4 grid-cols-1' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-5';

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-300">
      {/* KYC Alert Banner */}
      {kycPending && (
        <Alert className="border-amber-500/30 bg-amber-500/10 backdrop-blur-md shadow-sm">
          <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="text-amber-900 dark:text-amber-300 font-bold">
            KYC Document Verification Required
          </AlertTitle>
          <AlertDescription className="mt-1 text-amber-800 dark:text-amber-400 text-xs">
            <p>
              Your account is active. To unlock automatic invoice discounting, please upload your business registration and tax documents.
            </p>
            <Button asChild size="sm" variant="gradient" className="mt-3 font-semibold shadow-xs">
              <Link to="/kyc">
                Upload KYC Documents <ArrowRight className="ml-1.5 size-3.5" />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {kycRejected && (
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/10 backdrop-blur-md">
          <ShieldAlert className="size-5" />
          <AlertTitle className="font-bold">KYC Documents Rejected</AlertTitle>
          <AlertDescription className="mt-1 text-xs">
            <p>One or more documents require correction. Please review feedback and re-upload.</p>
            <Button asChild variant="destructive" size="sm" className="mt-3 font-semibold">
              <Link to="/kyc">
                Review &amp; Re-upload <ArrowRight className="ml-1.5 size-3.5" />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Top Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Supplier Portal</h1>
            <Badge variant="success" className="text-[10px] font-bold uppercase tracking-wider">Active</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time invoice financing portfolio and cashflow overview</p>
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
            <Link to="/invoices/new">
              <Plus className="mr-1 size-4" />
              Submit Invoice
            </Link>
          </Button>
        </div>
      </div>

      {/* Stat Cards Grid */}
      {isLoading ? (
        <div className={statGrid}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className={statGrid}>
            <StatCard title="Submitted Invoices" value={String(data.stats.totalSubmitted)} icon={FileText} subtitle="Total volume" />
            <StatCard title="Funded Invoices" value={String(data.stats.totalFunded)} icon={CreditCard} subtitle="Successfully advanced" />
            <StatCard title="Outstanding Balance" value={formatUGX(data.stats.outstandingAmount)} icon={AlertTriangle} subtitle="Active advances" />
            <StatCard title="Overdue Invoices" value={String(data.stats.overdueCount)} icon={AlertTriangle} subtitle="Awaiting buyer settlement" />
            <StatCard title="Avg Turnaround" value={`${data.stats.avgPaymentDays} Days`} icon={Clock} subtitle="Submission to payout" />
          </div>

          {/* Detailed Views: Breakdown & Recent Payments */}
          <div className="grid gap-6 lg:grid-cols-2">
            <StatusBreakdown data={data.invoiceStatusBreakdown} />

            <Card className="glass-card shadow-sm">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold font-display">Recent Disbursements</CardTitle>
                  <CardDescription className="text-xs">Direct bank payouts to your accounts</CardDescription>
                </div>
                <Button asChild variant="ghost" size="xs" className="text-xs text-primary font-bold">
                  <Link to="/invoices">View All <ArrowRight className="ml-1 size-3" /></Link>
                </Button>
              </CardHeader>
              <CardContent>
                {data.recentPayments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                    <Sparkles className="size-8 text-muted-foreground/50" />
                    <p className="text-sm font-medium text-muted-foreground">No recent disbursements yet</p>
                    <p className="text-xs text-muted-foreground">Submit an approved invoice to receive advance funds</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border/60">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="text-xs font-bold uppercase tracking-wider">Invoice Ref</TableHead>
                          <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Payout Amount</TableHead>
                          <TableHead className="text-xs font-bold uppercase tracking-wider">Method</TableHead>
                          <TableHead className="text-xs font-bold uppercase tracking-wider">Disbursed Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.recentPayments.slice(0, 5).map((p) => (
                          <TableRow
                            key={p.id}
                            className="cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => navigate(`/invoices/${p.invoiceId}`)}
                          >
                            <TableCell className="font-mono text-xs font-semibold text-primary">{p.invoiceRef}</TableCell>
                            <TableCell className="text-right font-mono font-bold"><AmountDisplay value={p.amount} /></TableCell>
                            <TableCell><Badge variant="outline" className="text-[11px] font-medium">{p.method}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">{formatDate(p.paidAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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

export default SupplierDashboard;

