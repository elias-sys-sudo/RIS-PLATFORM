/**
 * Checkers §6a — Applications Received.
 * Total new applications + breakdown by status + daily trend.
 */
import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { fetchApplicationsReceived } from '../api/reporting.api';
import type {
  ApplicationsReceivedReport as Report,
  ReportFilters,
} from '@/types/reporting.types';

interface Props { filters: ReportFilters }

function ApplicationsReceivedReport({ filters }: Props): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'applications-received', filters],
    queryFn: () => fetchApplicationsReceived(filters) as Promise<Report>,
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
  if (!data || data.total === 0) {
    return <ChartEmpty message="No applications received in this period" />;
  }

  return (
    <div className="space-y-6 pt-6">
      <StatCard title="Total Applications" value={data.total} icon={Inbox} subtitle="Received to date" />

      <Card>
        <CardHeader><CardTitle className="text-base">By Current Status</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byStatus.map((row) => (
                <TableRow key={row.status}>
                  <TableCell className="font-medium capitalize">
                    {row.status.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell className="text-right">{row.count}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {((row.count / data.total) * 100).toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.byDay.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Daily Arrivals (last 30 days)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Applications</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byDay.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-mono text-xs">{row.date}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
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

export default ApplicationsReceivedReport;
