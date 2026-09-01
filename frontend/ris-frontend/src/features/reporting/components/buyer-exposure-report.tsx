import { useQuery } from '@tanstack/react-query';
import { Users, AlertTriangle, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { AmountDisplay } from '@/components/display/amount-display';
import { DataBar } from '@/components/charts/data-bar';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { fetchBuyerExposure } from '../api/reporting.api';
import { formatUGX } from '@/lib/format-ugx';
import type { BuyerExposureRow, ReportFilters } from '@/types/reporting.types';
import { cn } from '@/lib/cn';

interface Props {
  filters: ReportFilters;
}

function BuyerExposureReport({ filters }: Props): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'buyer-exposure', filters],
    queryFn: () => fetchBuyerExposure(filters) as Promise<BuyerExposureRow[]>,
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

  if (!data?.length) return <ChartEmpty message="No buyer exposure data available" />;

  const totalExposure = data.reduce((sum, b) => sum + Number(b.usedLimit), 0);
  const avgUtil = data.reduce((sum, b) => sum + b.utilisationPct, 0) / data.length;
  const highRiskCount = data.filter((b) => b.utilisationPct > 80).length;
  const sorted = [...data].sort((a, b) => b.utilisationPct - a.utilisationPct);

  return (
    <div className="space-y-8 pt-6">
      {/* KPI Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        <StatCard title="Total Exposure" value={formatUGX(totalExposure)} icon={Users} valueClassName="font-mono" />
        <StatCard title="Avg Utilisation" value={`${avgUtil.toFixed(1)}%`} icon={TrendingUp} />
        <StatCard
          title="High Risk (>80%)"
          value={String(highRiskCount)}
          icon={AlertTriangle}
          valueClassName={highRiskCount > 0 ? 'text-amber-600' : ''}
        />
      </div>

      {/* Detail table */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Buyer Exposure Detail</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Buyer</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead>Utilisation</TableHead>
                <TableHead className="text-right">Avg Days</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((b) => (
                <TableRow
                  key={b.buyerId}
                  className={cn(
                    'even:bg-secondary/30',
                    b.utilisationPct > 80 && 'border-l-2 border-l-amber-500',
                  )}
                >
                  <TableCell className="font-medium">{b.buyerName}</TableCell>
                  <TableCell className="text-right"><AmountDisplay value={b.usedLimit} /></TableCell>
                  <TableCell className="text-right"><AmountDisplay value={b.approvedLimit} /></TableCell>
                  <TableCell><DataBar value={b.utilisationPct} /></TableCell>
                  <TableCell className="text-right font-mono text-sm">{b.avgDaysToPay.toFixed(0)}d</TableCell>
                  <TableCell className="text-right font-mono text-sm">{b.overdueIncidentCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default BuyerExposureReport;
