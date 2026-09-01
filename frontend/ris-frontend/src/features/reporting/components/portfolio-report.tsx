import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { StatusBreakdown } from '@/features/dashboard/components/status-breakdown';
import { AmountDisplay } from '@/components/display/amount-display';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, AlertTriangle, Banknote } from 'lucide-react';
import { fetchPortfolioReport } from '../api/reporting.api';
import { formatUGX } from '@/lib/format-ugx';
import type { PortfolioReport as PortfolioReportType, ReportFilters } from '@/types/reporting.types';
import type { InvoiceStatus } from '@/lib/constants';

interface Props {
  filters: ReportFilters;
}

function PortfolioReport({ filters }: Props): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'portfolio', filters],
    queryFn: () => fetchPortfolioReport(filters) as Promise<PortfolioReportType>,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pt-6">
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!data) return <ChartEmpty message="No portfolio data available" />;

  return (
    <div className="space-y-8 pt-6">
      {/* KPI Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Funded" value={formatUGX(data.totalFunded)} icon={Banknote} />
        <StatCard title="Total Collected" value={formatUGX(data.totalCollected)} icon={TrendingUp} />
        <StatCard title="Outstanding" value={formatUGX(data.totalOutstanding)} icon={DollarSign} />
        <StatCard title="Overdue" value={formatUGX(data.totalOverdue)} icon={AlertTriangle} valueClassName="text-red-600" />
      </div>

      {/* Insight text */}
      <p className="text-sm text-muted-foreground">
        Annualised yield is <strong className="text-foreground">{data.annualisedYield?.toFixed(1) ?? '\u2014'}%</strong>
      </p>

      {/* Status breakdown */}
      {data.invoiceCountsByStatus && data.invoiceCountsByStatus.length > 0 && (
        <StatusBreakdown
          data={data.invoiceCountsByStatus.map((s) => ({
            status: s.status as InvoiceStatus,
            count: s.count,
            amount: 0,
          }))}
        />
      )}

      {/* Top Buyers */}
      {data.topBuyers && data.topBuyers.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Top Buyers by Exposure</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead className="text-right">Exposure</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topBuyers.map((b) => (
                  <TableRow key={b.buyerId} className="even:bg-secondary/30">
                    <TableCell className="font-medium">{b.buyerName}</TableCell>
                    <TableCell className="text-right"><AmountDisplay value={b.totalExposure} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default PortfolioReport;
