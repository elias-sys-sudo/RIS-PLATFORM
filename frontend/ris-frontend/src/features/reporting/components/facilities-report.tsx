import { useQuery } from '@tanstack/react-query';
import { Landmark, ArrowDownToLine, BarChart3, AlertTriangle } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AmountDisplay } from '@/components/display/amount-display';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { DataBar } from '@/components/charts/data-bar';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import { cn } from '@/lib/cn';
import { fetchFacilitiesReport } from '../api/reporting.api';
import type { FacilityReport, FacilityReportRow } from '@/types/reporting.types';

// ── Props ───────────────────────────────────────────────────────────────────

interface FacilitiesReportProps {
  filters: { period?: string; startDate?: string; endDate?: string };
}

// ── Status badge colors ─────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  active:    'bg-green-50 text-green-700 border-green-200',
  matured:   'bg-amber-50 text-amber-700 border-amber-200',
  closed:    'bg-stone-50 text-stone-500 border-stone-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
};

function statusClasses(status: string): string {
  return STATUS_STYLE[status] ?? 'bg-stone-50 text-stone-500 border-stone-200';
}

// ── Loading skeleton ────────────────────────────────────────────────────────

function FacilitiesSkeleton(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeTotals(rows: FacilityReportRow[]): {
  totalLimit: number;
  totalDrawn: number;
  overallUtil: number;
  totalDefaultedExposure: number;
} {
  let totalLimit = 0;
  let totalDrawn = 0;
  let totalDefaultedExposure = 0;
  for (const row of rows) {
    totalLimit += Number(row.totalLimit);
    totalDrawn += Number(row.drawnAmount);
    totalDefaultedExposure += Number(row.defaultedExposure ?? 0);
  }
  const overallUtil = totalLimit > 0
    ? (totalDrawn / totalLimit) * 100
    : 0;
  return { totalLimit, totalDrawn, overallUtil, totalDefaultedExposure };
}

// ── Component ───────────────────────────────────────────────────────────────

function FacilitiesReportView({ filters }: FacilitiesReportProps): React.ReactElement {
  const { data, isLoading } = useQuery<FacilityReport>({
    queryKey: ['reports', 'facilities', filters],
    queryFn: () => fetchFacilitiesReport(filters) as Promise<FacilityReport>,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <FacilitiesSkeleton />;

  const rows = data?.data ?? [];

  if (rows.length === 0) {
    return (
      <ChartEmpty
        message="No facility data for this period"
        hint="Check that credit facilities have been onboarded"
      />
    );
  }

  const { totalLimit, totalDrawn, overallUtil, totalDefaultedExposure } = computeTotals(rows);

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Limit"
          value={formatUGX(totalLimit)}
          icon={Landmark}
          subtitle="Sum of all facility limits"
        />
        <StatCard
          title="Total Drawn"
          value={formatUGX(totalDrawn)}
          icon={ArrowDownToLine}
          subtitle="Funds currently deployed"
        />
        <StatCard
          title="At-Risk Exposure"
          value={formatUGX(totalDefaultedExposure)}
          icon={AlertTriangle}
          subtitle="Bank debt on defaulted invoices"
        />
        <StatCard
          title="Overall Utilisation"
          value={`${overallUtil.toFixed(1)}%`}
          icon={BarChart3}
          subtitle="Drawn / total limit"
        />
      </div>

      {/* Facilities table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facility Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bank</TableHead>
                  <TableHead className="text-right">Total Limit</TableHead>
                  <TableHead className="text-right">Drawn</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>Utilisation</TableHead>
                  <TableHead className="text-right">Interest Accrued</TableHead>
                  <TableHead className="text-right">At Risk</TableHead>
                  <TableHead>Maturity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((f: FacilityReportRow, idx: number) => (
                  <TableRow
                    key={f.id}
                    className={cn(idx % 2 === 1 && 'bg-secondary/30')}
                  >
                    <TableCell className="font-medium">{f.bankName}</TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay value={f.totalLimit} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay value={f.drawnAmount} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay value={f.availableAmount} />
                    </TableCell>
                    <TableCell>
                      <DataBar value={f.utilisationPct} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay value={f.interestAccrued} />
                    </TableCell>
                    <TableCell className={cn(
                      'text-right',
                      Number(f.defaultedExposure ?? 0) > 0 && 'text-red-600 font-medium',
                    )}>
                      <AmountDisplay value={f.defaultedExposure ?? '0'} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(f.maturityDate)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[11px] font-medium capitalize',
                          statusClasses(f.status),
                        )}
                      >
                        {f.status}
                      </Badge>
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

export default FacilitiesReportView;
