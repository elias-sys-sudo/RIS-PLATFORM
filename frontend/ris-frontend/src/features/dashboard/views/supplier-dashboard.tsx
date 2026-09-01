import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  FileText, CreditCard, Clock, AlertTriangle, ShieldAlert, ArrowRight,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  const kycStatus = useAuthStore((s) => s.user?.kycStatus);
  const kycPending = kycStatus === 'pending' || kycStatus === 'in_progress';
  const kycRejected = kycStatus === 'rejected';
  const isMobile = useIsMobile();
  const statGrid = isMobile ? 'grid gap-6 grid-cols-1' : 'grid gap-6 md:grid-cols-2 lg:grid-cols-5';

  return (
    <div className="space-y-8">
      {/* KYC Banner — shown when supplier hasn't completed KYC */}
      {kycPending && (
        <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <ShieldAlert className="size-5 text-amber-600" />
          <AlertTitle className="text-amber-800 dark:text-amber-400">
            Complete Your KYC Documents
          </AlertTitle>
          <AlertDescription className="mt-1 text-amber-700 dark:text-amber-300">
            <p>
              Your account is active but you must submit KYC documents before
              you can submit invoices for financing. This typically takes 1–2
              business days to review.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/kyc">
                Upload Documents <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {kycRejected && (
        <Alert variant="destructive">
          <ShieldAlert className="size-5" />
          <AlertTitle>KYC Review Failed</AlertTitle>
          <AlertDescription className="mt-1">
            <p>
              One or more of your documents were rejected. Please review the
              feedback and re-upload the required documents.
            </p>
            <Button asChild variant="destructive" size="sm" className="mt-3">
              <Link to="/kyc">
                Review &amp; Re-upload <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">My Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your invoice funding overview</p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className={statGrid}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : data ? (
        <>
          <div className={statGrid}>
            <StatCard title="Submitted" value={String(data.stats.totalSubmitted)} icon={FileText} />
            <StatCard title="Funded" value={String(data.stats.totalFunded)} icon={CreditCard} />
            <StatCard title="Outstanding" value={formatUGX(data.stats.outstandingAmount)} icon={AlertTriangle} />
            <StatCard title="Overdue" value={String(data.stats.overdueCount)} icon={AlertTriangle} />
            <StatCard title="Avg Payment" value={`${data.stats.avgPaymentDays}d`} icon={Clock} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <StatusBreakdown data={data.invoiceStatusBreakdown} />
            <Card>
              <CardHeader><CardTitle className="text-base">Recent Payments</CardTitle></CardHeader>
              <CardContent>
                {data.recentPayments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Method</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.recentPayments.slice(0, 5).map((p) => (
                        <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/invoices/${p.invoiceId}`)}>
                          <TableCell className="font-mono text-xs">{p.invoiceRef}</TableCell>
                          <TableCell className="text-right"><AmountDisplay value={p.amount} /></TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{p.method}</Badge></TableCell>
                          <TableCell className="text-xs">{formatDate(p.paidAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
