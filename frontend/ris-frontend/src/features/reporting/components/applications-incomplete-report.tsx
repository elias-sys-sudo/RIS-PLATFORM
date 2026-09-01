/**
 * Checkers §6c — Incomplete Applications.
 * Lists applications stuck in draft/rejected with the missing document types.
 */
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { fetchApplicationsIncomplete } from '../api/reporting.api';
import type {
  IncompleteApplicationRow,
  ReportFilters,
} from '@/types/reporting.types';

interface Props { filters: ReportFilters }

function ApplicationsIncompleteReport({ filters }: Props): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'applications-incomplete', filters],
    queryFn: () => fetchApplicationsIncomplete(filters) as Promise<IncompleteApplicationRow[]>,
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
  if (!data?.length) {
    return <ChartEmpty message="All applications are complete" />;
  }

  const stale = data.filter((r) => r.daysInStatus > 14);

  return (
    <div className="space-y-6 pt-6">
      <div className="grid gap-4 md:grid-cols-2">
        <StatCard title="Incomplete" value={data.length} icon={AlertCircle} subtitle="Missing docs or data" />
        <StatCard
          title="Stale (>14 days)"
          value={stale.length}
          icon={AlertCircle}
          subtitle="Need escalation"
          valueClassName="text-red-600"
        />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Missing Documents by Applicant</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Missing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.supplierId}>
                  <TableCell className="font-mono text-xs">
                    {row.supplierId.slice(0, 12)}
                  </TableCell>
                  <TableCell className="capitalize">{row.kycStatus.replace(/_/g, ' ')}</TableCell>
                  <TableCell className={
                    row.daysInStatus > 14
                      ? 'text-right font-medium text-red-600'
                      : 'text-right'
                  }>
                    {row.daysInStatus}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.missingDocTypes.map((d) => (
                        <Badge key={d} variant="outline" className="text-[10px] capitalize">
                          {d.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default ApplicationsIncompleteReport;
