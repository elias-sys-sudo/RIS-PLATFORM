import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCollections } from '../hooks/use-collections';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import { ESCALATION_LABELS } from '@/lib/constants';
import type { CollectionFilters, CollectionStatus } from '@/types/collection.types';
import type { EscalationLevel } from '@/lib/constants';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-50 text-gray-700 border-gray-200',
  reminded: 'bg-amber-50 text-amber-700 border-amber-200',
  overdue: 'bg-orange-50 text-orange-700 border-orange-200',
  escalated: 'bg-red-50 text-red-700 border-red-200',
  collected: 'bg-green-50 text-green-700 border-green-200',
  bad_debt: 'bg-red-50 text-red-900 border-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  reminded: 'Reminded',
  overdue: 'Overdue',
  escalated: 'Escalated',
  collected: 'Collected',
  bad_debt: 'Bad Debt',
};

const ESC_COLORS: Record<string, string> = {
  none: 'bg-gray-50 text-gray-600',
  reminder: 'bg-yellow-50 text-yellow-700',
  formal: 'bg-orange-50 text-orange-700',
  legal: 'bg-red-50 text-red-700',
};

export function CollectionsListPage(): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [escFilter, setEscFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const filters: CollectionFilters = {
    status: statusFilter !== 'all' ? [statusFilter as CollectionStatus] : undefined,
    escalation_level: escFilter !== 'all' ? [escFilter as EscalationLevel] : undefined,
    search: search || undefined,
    page,
    page_size: 20,
  };

  const { data, isLoading } = useCollections(filters);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold font-display">Collections</h1>
        <p className="text-sm text-muted-foreground">Track and manage invoice collections</p>
      </div>

      {/* Summary stats */}
      {data?.summaryStats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="text-lg font-bold font-mono">{formatUGX(data.summaryStats.totalOutstandingUgx)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Overdue</p>
              <p className="text-lg font-bold">{data.summaryStats.overdueCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Avg Days Overdue</p>
              <p className="text-lg font-bold">{data.summaryStats.avgDaysOverdue.toFixed(0)}d</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Collection Rate</p>
              <p className="text-lg font-bold">{data.summaryStats.collectionRate.toFixed(1)}%</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="reminded">Reminded</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
            <SelectItem value="collected">Collected</SelectItem>
            <SelectItem value="bad_debt">Bad Debt</SelectItem>
          </SelectContent>
        </Select>
        <Select value={escFilter} onValueChange={(v) => { setEscFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Escalation" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="reminder">Reminder</SelectItem>
            <SelectItem value="formal">Formal</SelectItem>
            <SelectItem value="legal">Legal</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="text-right">Face Value</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Days Overdue</TableHead>
              <TableHead>Escalation</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.data.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/collections/${c.id}`)}
                  >
                    <TableCell className="font-mono text-sm">{c.invoiceNumber}</TableCell>
                    <TableCell>{c.buyerName}</TableCell>
                    <TableCell className="text-right font-mono">{formatUGX(c.faceValue)}</TableCell>
                    <TableCell className="text-right font-mono">{formatUGX(c.outstandingAmount)}</TableCell>
                    <TableCell>{formatDate(c.dueDate)}</TableCell>
                    <TableCell>
                      {c.daysOverdue > 0 ? (
                        <span className="text-orange-600 font-medium">{c.daysOverdue}d</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ESC_COLORS[c.escalationLevel] ?? ''}>
                        {ESCALATION_LABELS[c.escalationLevel] ?? c.escalationLevel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_COLORS[c.status] ?? ''}>
                        {STATUS_LABELS[c.status] ?? c.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No collections found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CollectionsListPage;
