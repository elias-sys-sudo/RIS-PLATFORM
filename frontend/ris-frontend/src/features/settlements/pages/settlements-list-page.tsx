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
import { useSettlements } from '../hooks/use-settlements';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import type {
  SettlementFilters,
  SettlementStatus,
} from '../api/settlements.api';

// ── Status display config ────────────────────────────────────────────────────

const STATUS_COLORS: Record<SettlementStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  facility_repaid: 'bg-blue-50 text-blue-700 border-blue-200',
  profit_booked: 'bg-green-50 text-green-700 border-green-200',
  closed: 'bg-gray-50 text-gray-700 border-gray-200',
};

const STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: 'Pending',
  facility_repaid: 'Facility Repaid',
  profit_booked: 'Profit Booked',
  closed: 'Closed',
};

// ── Page component ───────────────────────────────────────────────────────────

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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold font-display">Settlements</h1>
        <p className="text-sm text-muted-foreground">
          Facility repayment and profit booking for collected invoices
        </p>
      </div>

      {/* Summary stats */}
      {data?.summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <SummaryCard
            label="Total Net Profit"
            value={formatUGX(data.summary.totalNetProfit)}
            highlight
          />
          <SummaryCard
            label="Total Facility Repaid"
            value={formatUGX(data.summary.totalFacilityRepaid)}
          />
          <SummaryCard
            label="Total Settlements"
            value={String(data.summary.totalSettlements)}
          />
          <SummaryCard
            label="Pending"
            value={String(data.summary.pendingCount)}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by invoice or company..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="facility_repaid">Facility Repaid</SelectItem>
            <SelectItem value="profit_booked">Profit Booked</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="text-right">Collected</TableHead>
              <TableHead className="text-right">Advance</TableHead>
              <TableHead className="text-right">Net Profit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.data.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/settlements/${s.id}`)}
                  >
                    <TableCell className="font-mono text-sm">
                      {s.invoiceNumber}
                    </TableCell>
                    <TableCell>{s.supplierName}</TableCell>
                    <TableCell>{s.buyerName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatUGX(s.collectedAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatUGX(s.advanceAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium text-green-700">
                      {formatUGX(s.netProfit)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_COLORS[s.status] ?? ''}
                      >
                        {STATUS_LABELS[s.status] ?? s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(s.settledAt ?? s.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-muted-foreground"
                >
                  No settlements found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Summary card helper ──────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-lg font-bold font-mono ${
            highlight ? 'text-green-700' : ''
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export default SettlementsListPage;
