import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, AlertTriangle, Scale, Clock, TrendingUp, X } from 'lucide-react';
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

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending Due Date',
  reminded: 'Courtesy Reminded',
  overdue: 'Overdue (Grace)',
  escalated: 'Demand Letter Issued',
  collected: 'Fully Settled',
  bad_debt: 'Default / Legal',
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
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Collections &amp; Recovery</h1>
            <Badge variant="gold" className="text-[10px] font-bold uppercase tracking-wider">
              <Scale className="size-3 mr-1" />
              Automated Demand Letters
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor debtor maturities, automated dunning notifications, demand letter escalations &amp; settlements
          </p>
        </div>
      </div>

      {/* Summary stats */}
      {data?.summaryStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Clock className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Total Outstanding</p>
                <p className="text-xl font-bold font-mono text-foreground">{formatUGX(data.summaryStats.totalOutstandingUgx)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <AlertTriangle className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Overdue Count</p>
                <p className="text-xl font-bold font-mono text-destructive">{data.summaryStats.overdueCount}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                <Clock className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Avg Days Overdue</p>
                <p className="text-xl font-bold font-mono text-foreground">{data.summaryStats.avgDaysOverdue.toFixed(0)} Days</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <TrendingUp className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Recovery Rate</p>
                <p className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {data.summaryStats.collectionRate.toFixed(1)}%
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search collections by buyer or invoice #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8 h-10 rounded-xl bg-card/60 border-border/80 text-xs focus-visible:ring-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 rounded-xl bg-card/60 border-border/80 text-xs font-semibold">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/80">
              <SelectItem value="all" className="text-xs">All statuses</SelectItem>
              <SelectItem value="pending" className="text-xs">Pending</SelectItem>
              <SelectItem value="reminded" className="text-xs">Reminded</SelectItem>
              <SelectItem value="overdue" className="text-xs">Overdue</SelectItem>
              <SelectItem value="escalated" className="text-xs">Escalated</SelectItem>
              <SelectItem value="collected" className="text-xs">Collected</SelectItem>
              <SelectItem value="bad_debt" className="text-xs">Bad Debt</SelectItem>
            </SelectContent>
          </Select>

          <Select value={escFilter} onValueChange={(v) => { setEscFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 rounded-xl bg-card/60 border-border/80 text-xs font-semibold">
              <SelectValue placeholder="Escalation" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/80">
              <SelectItem value="all" className="text-xs">All escalation levels</SelectItem>
              <SelectItem value="none" className="text-xs">None</SelectItem>
              <SelectItem value="reminder" className="text-xs">Reminder Letter</SelectItem>
              <SelectItem value="formal" className="text-xs">Formal Notice</SelectItem>
              <SelectItem value="legal" className="text-xs">Legal Action</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-xs">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Invoice #</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Buyer (Debtor)</TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Face Value</TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Outstanding</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Due Date</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Aging Overdue</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Escalation Stage</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Recovery Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-16 rounded" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.data.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/collections/${c.id}`)}
                  >
                    <TableCell className="font-mono text-xs font-bold text-primary">{c.invoiceNumber}</TableCell>
                    <TableCell className="font-medium text-sm">{c.buyerName}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm">{formatUGX(c.faceValue)}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm text-foreground">{formatUGX(c.outstandingAmount)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{formatDate(c.dueDate)}</TableCell>
                    <TableCell>
                      {c.daysOverdue > 0 ? (
                        <Badge variant="destructive" className="text-[10px] font-mono font-bold">
                          +{c.daysOverdue}d overdue
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground font-mono">Current</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.escalationLevel === 'legal'
                            ? 'destructive'
                            : c.escalationLevel === 'formal'
                            ? 'warning'
                            : 'outline'
                        }
                        className="text-[10px] font-semibold uppercase"
                      >
                        {ESCALATION_LABELS[c.escalationLevel] ?? c.escalationLevel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.status === 'collected'
                            ? 'success'
                            : c.status === 'bad_debt' || c.status === 'escalated'
                            ? 'destructive'
                            : c.status === 'overdue'
                            ? 'warning'
                            : 'outline'
                        }
                        className="text-[10px] font-semibold uppercase"
                      >
                        {STATUS_LABELS[c.status] ?? c.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  <Scale className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No collections matching selected filters.</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground font-mono">Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="text-xs rounded-lg">
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className="text-xs rounded-lg">
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CollectionsListPage;

