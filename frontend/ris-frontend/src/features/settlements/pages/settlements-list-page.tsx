import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Landmark, TrendingUp, DollarSign, Clock, CheckCircle2, X } from 'lucide-react';
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
import { useSettlements } from '../hooks/use-settlements';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import type {
  SettlementFilters,
  SettlementStatus,
} from '../api/settlements.api';

const STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: 'Pending Repayment',
  facility_repaid: 'Bank Principal Repaid',
  profit_booked: 'Margin Realized',
  closed: 'Settlement Closed',
};

export function SettlementsListPage(): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const filters: SettlementFilters = {
    status: statusFilter !== 'all'
      ? (statusFilter as SettlementStatus)
      : undefined,
    search: search || undefined,
    page,
    page_size: 20,
  };

  const { data, isLoading } = useSettlements(filters);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Settlement &amp; Profit Ledger</h1>
            <Badge variant="gold" className="text-[10px] font-bold uppercase tracking-wider">
              <Landmark className="size-3 mr-1" />
              Automated Waterfall
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automated waterfall accounting: partner bank facility repayment, margin booking &amp; audit reconciliation
          </p>
        </div>
      </div>

      {/* Summary stats */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <TrendingUp className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Total Realized Margin</p>
                <p className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {formatUGX(data.summary.totalNetProfit)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Landmark className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Facilities Repaid</p>
                <p className="text-xl font-bold font-mono text-foreground">{formatUGX(data.summary.totalFacilityRepaid)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <DollarSign className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Total Settlements</p>
                <p className="text-xl font-bold font-mono text-foreground">{data.summary.totalSettlements}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-xs">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                <Clock className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Pending Allocation</p>
                <p className="text-xl font-bold font-mono text-foreground">{data.summary.pendingCount}</p>
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
            placeholder="Search settlements by invoice # or company..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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

        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
        >
          <SelectTrigger className="w-48 rounded-xl bg-card/60 border-border/80 text-xs font-semibold">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-border/80">
            <SelectItem value="all" className="text-xs">All waterfall statuses</SelectItem>
            <SelectItem value="pending" className="text-xs">Pending Repayment</SelectItem>
            <SelectItem value="facility_repaid" className="text-xs">Bank Facility Repaid</SelectItem>
            <SelectItem value="profit_booked" className="text-xs">Profit Booked</SelectItem>
            <SelectItem value="closed" className="text-xs">Settlement Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-xs">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Invoice #</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Supplier</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Buyer (Debtor)</TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Collected Principal</TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Bank Advance</TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Net Realized Margin</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Waterfall Status</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Settled Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-16 rounded" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.data.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/settlements/${s.id}`)}
                  >
                    <TableCell className="font-mono text-xs font-bold text-primary">
                      {s.invoiceNumber}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{s.supplierName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.buyerName}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm">
                      {formatUGX(s.collectedAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm text-foreground">
                      {formatUGX(s.advanceAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                      {formatUGX(s.netProfit)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          s.status === 'profit_booked' || s.status === 'closed'
                            ? 'success'
                            : s.status === 'facility_repaid'
                            ? 'info'
                            : 'warning'
                        }
                        className="text-[10px] font-semibold uppercase"
                      >
                        {STATUS_LABELS[s.status] ?? s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {formatDate(s.settledAt ?? s.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-12 text-muted-foreground"
                >
                  <CheckCircle2 className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No settlements matching current filter.</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground font-mono">
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="text-xs rounded-lg"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage(page + 1)}
              className="text-xs rounded-lg"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettlementsListPage;

