/**
 * Checkers §6e — Disbursed Funds.
 * Every invoice that has been funded, with its advance amount and current status.
 */
import { useQuery } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { AmountDisplay } from '@/components/display/amount-display';
import { fetchDisbursedFunds } from '../api/reporting.api';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import type {
  DisbursedFundsReport as Report,
  ReportFilters,
} from '@/types/reporting.types';

interface Props { filters: ReportFilters }

function DisbursedFundsReport({ filters }: Props): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'disbursed-funds', filters],
    queryFn: () => fetchDisbursedFunds(filters) as Promise<Report>,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pt-6">
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!data || data.count === 0) {
    return <ChartEmpty message="No funds disbursed in this period" />;
  }

  return (
    <div className="space-y-6 pt-6">
      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          title="Total Disbursed"
          value={formatUGX(data.totalDisbursed)}
          icon={Banknote}
          subtitle={`${data.count} payment${data.count === 1 ? '' : 's'}`}
        />
        <StatCard
          title="Payment Count"
          value={data.count}
          icon={Banknote}
          subtitle="Invoices funded"
        />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Disbursed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.payments.map((p) => (
                <TableRow key={p.invoiceId}>
                  <TableCell className="font-mono text-xs">{p.invoiceId.slice(0, 12)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.supplierId.slice(0, 12)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.buyerId.slice(0, 12)}</TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay value={p.disbursedAmount} />
                  </TableCell>
                  <TableCell className="capitalize">{p.status.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-xs">{formatDate(p.disbursedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default DisbursedFundsReport;
