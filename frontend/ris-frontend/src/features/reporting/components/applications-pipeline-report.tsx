/**
 * Checkers §6b — Applications Under Review / Pipeline.
 * Count and average days-in-status per review stage.
 */
import { useQuery } from '@tanstack/react-query';
import { Workflow } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { fetchApplicationsPipeline } from '../api/reporting.api';
import type {
  ApplicationsPipelineReport as Report,
  ReportFilters,
} from '@/types/reporting.types';

interface Props { filters: ReportFilters }

function ApplicationsPipelineReport({ filters }: Props): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'applications-pipeline', filters],
    queryFn: () => fetchApplicationsPipeline(filters) as Promise<Report>,
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
  if (!data?.stages?.length) {
    return <ChartEmpty message="Nothing currently in review" />;
  }

  const total = data.stages.reduce((n, s) => n + s.count, 0);
  const bottleneck = data.stages.reduce((a, b) => (a.avgDaysInStatus > b.avgDaysInStatus ? a : b));

  return (
    <div className="space-y-6 pt-6">
      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          title="In Review"
          value={total}
          icon={Workflow}
          subtitle="Applications currently progressing"
        />
        <StatCard
          title="Longest-dwell Stage"
          value={bottleneck.kycStatus.replace(/_/g, ' ')}
          icon={Workflow}
          subtitle={`${bottleneck.avgDaysInStatus} avg days`}
        />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pipeline Stages</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Avg Days in Stage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.stages.map((s) => (
                <TableRow key={s.kycStatus}>
                  <TableCell className="font-medium capitalize">
                    {s.kycStatus.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell className="text-right">{s.count}</TableCell>
                  <TableCell className="text-right">{s.avgDaysInStatus}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default ApplicationsPipelineReport;
