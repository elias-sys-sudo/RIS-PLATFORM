import { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, CalendarDays, Download } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/features/dashboard/components/stat-card';
import { ChartEmpty } from '@/components/charts/chart-empty';
import { formatDate } from '@/lib/format-date';
import { cn } from '@/lib/cn';
import { fetchAuditExport } from '../api/reporting.api';
import type { AuditExportReport, AuditEntry } from '@/types/reporting.types';

// ── Props ───────────────────────────────────────────────────────────────────

interface AuditReportProps {
  filters: { period?: string; startDate?: string; endDate?: string };
}

// ── Constants ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const ACTION_STYLE: Record<string, string> = {
  CREATE: 'bg-green-50 text-green-700 border-green-200',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
};

function actionClasses(action: string): string {
  const upper = action.toUpperCase();
  return ACTION_STYLE[upper] ?? 'bg-stone-50 text-stone-600 border-stone-200';
}

// ── Loading skeleton ────────────────────────────────────────────────────────

function AuditSkeleton(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncateId(id: string | null | undefined): string {
  if (!id) return '--';
  return id.length > 8 ? `${id.slice(0, 8)}...` : id;
}

function computeDateRange(entries: AuditEntry[]): string {
  if (entries.length === 0) return '--';
  const dates = entries
    .map((e) => e.createdAt)
    .filter(Boolean)
    .sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return '--';
  return `${formatDate(first)} - ${formatDate(last)}`;
}

function buildCsvContent(entries: AuditEntry[]): string {
  const header = 'User ID,Action,Table,Record ID,Date';
  const rows = entries.map(
    (e) => `${e.userId},${e.action},${e.tableName},${e.recordId},${e.createdAt}`,
  );
  return [header, ...rows].join('\n');
}

function buildJsonContent(entries: AuditEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ── Component ───────────────────────────────────────────────────────────────

function AuditReportView({ filters }: AuditReportProps): React.ReactElement {
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery<AuditExportReport>({
    queryKey: ['reports', 'audit-export', filters],
    queryFn: () => fetchAuditExport(filters) as Promise<AuditExportReport>,
    staleTime: 5 * 60 * 1000,
  });

  const entries = data?.entries ?? [];
  const totalCount = data?.totalCount ?? entries.length;

  const dateRange = useMemo(() => computeDateRange(entries), [entries]);

  const pageEntries = useMemo(() => {
    const start = page * PAGE_SIZE;
    return entries.slice(start, start + PAGE_SIZE);
  }, [entries, page]);

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  const handleExportCsv = useCallback(() => {
    const csv = buildCsvContent(entries);
    downloadFile(csv, 'audit-export.csv', 'text/csv');
  }, [entries]);

  const handleExportJson = useCallback(() => {
    const json = buildJsonContent(entries);
    downloadFile(json, 'audit-export.json', 'application/json');
  }, [entries]);

  if (isLoading) return <AuditSkeleton />;

  if (entries.length === 0) {
    return (
      <ChartEmpty
        message="No audit entries for this period"
        hint="Audit records are created automatically as users interact with the system"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          title="Total Entries"
          value={String(totalCount)}
          icon={ClipboardList}
          subtitle="Audit log records"
        />
        <StatCard
          title="Date Range"
          value={dateRange}
          icon={CalendarDays}
          subtitle="Earliest to latest entry"
          valueClassName="text-base"
        />
      </div>

      {/* Audit table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Audit Trail</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="mr-1.5 size-3.5" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportJson}>
              <Download className="mr-1.5 size-3.5" />
              JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageEntries.map((entry: AuditEntry, idx: number) => (
                  <TableRow
                    key={entry.id}
                    className={cn(idx % 2 === 1 && 'bg-secondary/30')}
                  >
                    <TableCell className="font-mono text-xs">
                      {truncateId(entry.userId)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[11px] font-medium',
                          actionClasses(entry.action),
                        )}
                      >
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.tableName}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateId(entry.recordId)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(entry.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}
              {' - '}
              {Math.min((page + 1) * PAGE_SIZE, entries.length)}
              {' of '}
              {entries.length} entries
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canPrev}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canNext}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AuditReportView;
