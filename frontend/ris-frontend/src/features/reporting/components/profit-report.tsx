import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, Landmark, AlertTriangle } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AmountDisplay } from '@/components/display/amount-display';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { formatUGX } from '@/lib/format-ugx';
import { cn } from '@/lib/cn';
import { fetchProfitReport } from '../api/reporting.api';
import type { ProfitReport, InvoiceProfitRow } from '@/types/reporting.types';

// ── Props ───────────────────────────────────────────────────────────────────

interface ProfitReportProps {
  filters: { period?: string; startDate?: string; endDate?: string };
}

// ── Loading skeleton ────────────────────────────────────────────────────────

function ProfitSkeleton(): React.ReactElement {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

function ProfitReportView({ filters }: ProfitReportProps): React.ReactElement {
  const { data, isLoading } = useQuery<ProfitReport>({
    queryKey: ['reports', 'profit', filters],
    queryFn: () => fetchProfitReport(filters) as Promise<ProfitReport>,
    staleTime: 5 * 60 * 1000,
  });

  const sortedInvoices = useMemo(() => {
    if (!data?.invoices) return [];
    return [...data.invoices].sort(
      (a, b) => Number(b.netMmsProfit) - Number(a.netMmsProfit),
    );
  }, [data?.invoices]);

  if (isLoading) return <ProfitSkeleton />;

  if (!data || sortedInvoices.length === 0) {
    return (
      <ChartEmpty
        message="No profit data for this period"
        hint="Try adjusting the date range or check that invoices have been settled"
      />
    );
  }

  const { summary } = data;
  const marginPct = summary.avgProfitMarginPct;

  return (
    <div className="space-y-6">
      {/* Hero metric */}
      <Card>
        <CardContent className="p-8">
          <p className="text-sm font-medium text-muted-foreground mb-1">
            Net Profit
          </p>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-mono font-bold text-green-600">
              {formatUGX(summary.totalNetProfit)}
            </span>
            <Badge
              variant="outline"
              className="bg-green-50 text-green-700 border-green-200"
            >
              {marginPct.toFixed(1)}% margin
            </Badge>
          </div>
          {/* Clarify revenue recognition — profit lands at Book Profit, not at Close. */}
          <p className="text-xs text-muted-foreground mt-3">
            Recognised when finance books the profit on a settlement
            (<span className="font-medium">Book Profit</span> step). Closing a settlement
            afterwards is administrative and does not change this figure.
          </p>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value={formatUGX(summary.totalRevenue)}
          icon={DollarSign}
          subtitle={`Discount ${formatUGX(summary.totalDiscount)} + penalty ${formatUGX(summary.totalPenaltyIncome)}`}
        />
        <StatCard
          title="Bank Interest Cost"
          value={formatUGX(summary.totalBankInterest)}
          icon={Landmark}
          subtitle="Cost of funds"
        />
        <StatCard
          title="Write-offs"
          value={formatUGX(summary.totalWriteOffs)}
          icon={AlertTriangle}
          subtitle="Advance lost + bank debt still owed on defaults"
        />
        <StatCard
          title="Average Margin"
          value={`${marginPct.toFixed(1)}%`}
          icon={TrendingUp}
          subtitle="Net profit / face value"
        />
      </div>

      {/* Per-invoice profit table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-Invoice Profitability</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead className="text-right">Face Value</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Penalty</TableHead>
                  <TableHead className="text-right">Bank Interest</TableHead>
                  <TableHead className="text-right">Net Profit</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedInvoices.map((inv: InvoiceProfitRow, idx: number) => (
                  <TableRow
                    key={inv.invoiceId}
                    className={cn(idx % 2 === 1 && 'bg-secondary/30')}
                  >
                    <TableCell className="font-medium font-mono text-xs">
                      {inv.invoiceNumber ?? inv.invoiceId.slice(0, 12)}
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay value={inv.faceValue} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay value={inv.discountAmount} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay value={inv.penaltyIncome} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay value={inv.bankInterestCost} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay value={inv.netMmsProfit} colorCoded />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono text-sm tabular-nums',
                        inv.profitMarginPct >= 0 ? 'text-green-600' : 'text-red-600',
                      )}
                    >
                      {inv.profitMarginPct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ProfitReportView;
