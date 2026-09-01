import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, TrendingDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { AgingWaterfall } from '@/features/dashboard/components/aging-waterfall';
import { DataBar } from '@/components/charts/data-bar';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { fetchAgingReport } from '../api/reporting.api';
import { formatUGX } from '@/lib/format-ugx';
import type { AgingReport as AgingReportType, ReportFilters } from '@/types/reporting.types';

interface Props {
  filters: ReportFilters;
}

function AgingReport({ filters }: Props): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'aging', filters],
    queryFn: () => fetchAgingReport(filters) as Promise<AgingReportType>,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pt-6">
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!data?.buckets?.length) return <ChartEmpty message="No aging data available" />;

  const totalOutstanding = data.buckets.reduce((sum, b) => sum + Number(b.totalAmount), 0);
  const totalCount = data.buckets.reduce((sum, b) => sum + b.count, 0);
  const lastBucket = data.buckets[data.buckets.length - 1];
  const has90Plus = lastBucket && Number(lastBucket.totalAmount) > 0;

  return (
    <div className="space-y-8 pt-6">
      {/* Warning banner for 90+ bucket */}
      {has90Plus && (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertTriangle className="size-4 text-amber-600" />
          <AlertDescription className="text-amber-700">
            {lastBucket.count} invoice{lastBucket.count > 1 ? 's' : ''} overdue by 90+ days
            {' \u2014 '}total exposure {formatUGX(lastBucket.totalAmount)}
          </AlertDescription>
        </Alert>
      )}

      {/* KPI Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        <StatCard title="Total Outstanding" value={formatUGX(totalOutstanding)} icon={TrendingDown} valueClassName="font-mono" />
        <StatCard title="Total Invoices" value={String(totalCount)} icon={Clock} />
        <StatCard title="90+ Days Amount" value={formatUGX(lastBucket?.totalAmount ?? '0')} icon={AlertTriangle} valueClassName="text-red-600 font-mono" />
      </div>

      {/* Chart */}
      <AgingWaterfall data={data.buckets.map((b) => ({ label: b.bucket, count: b.count, amount: String(b.totalAmount) }))} />

      {/* Detail table */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Bucket Detail</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>% of Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.buckets.map((b) => {
                const pct = totalOutstanding > 0
                  ? (Number(b.totalAmount) / totalOutstanding) * 100
                  : 0;
                return (
                  <TableRow key={b.bucket} className="even:bg-secondary/30">
                    <TableCell className="font-medium">{b.bucket}</TableCell>
                    <TableCell className="text-right font-mono">{b.count}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm">{formatUGX(b.totalAmount)}</span>
                    </TableCell>
                    <TableCell><DataBar value={pct} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default AgingReport;
