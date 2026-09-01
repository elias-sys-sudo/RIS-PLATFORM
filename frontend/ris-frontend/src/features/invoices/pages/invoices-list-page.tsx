import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InvoiceStatusBadge } from '../components/invoice-status-badge';
import { InvoiceCard } from '../components/invoice-card';
import { useInvoices } from '../hooks/use-invoices';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import { INVOICE_STATUS_LABELS } from '@/lib/constants';
import { useAuthStore } from '@/store/auth.store';
import type { InvoiceFilters, InvoiceStatus } from '@/types/invoice.types';

const ALL_STATUSES = Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[];

export function InvoicesListPage(): React.ReactElement {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const visibleStatuses = ALL_STATUSES;
  const [filters, setFilters] = useState<InvoiceFilters>({
    page: 1,
    page_size: 20,
  });
  const [search, setSearch] = useState('');
  const isMobile = useIsMobile();

  // Finance managers (and every other staff role) now see the full pipeline by
  // default. They can still narrow the view via the status filter — previously
  // an FM-only allowlist hid pre-approval invoices, so anything stuck at
  // submitted/scored/priced never reached the finance queue.
  const { data, isLoading, isError } = useInvoices({
    ...filters,
    status: filters.status,
    search: search || undefined,
  });

  function handleStatusFilter(val: string): void {
    setFilters((prev) => ({
      ...prev,
      status: val === 'all' ? undefined : [val as InvoiceStatus],
      page: 1,
    }));
  }

  function handlePageChange(page: number): void {
    setFilters((prev) => ({ ...prev, page }));
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            {isError
              ? 'Could not load invoices'
              : data
              ? `${data.total} total`
              : isLoading
              ? 'Loading...'
              : 'No invoices found'}
          </p>
        </div>
        {role === 'supplier' && (
          <Button onClick={() => navigate('/invoices/new')}>
            <Plus className="mr-2 size-4" /> New Invoice
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by invoice number or buyer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={filters.status?.[0] ?? 'all'}
          onValueChange={handleStatusFilter}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {visibleStatuses.map((s) => (
              <SelectItem key={s} value={s}>
                {INVOICE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Mobile card view */}
      {isMobile && !isLoading && data?.data && (
        <div className="space-y-3 md:hidden">
          {data.data.map((inv) => (
            <InvoiceCard key={inv.id} invoice={inv} />
          ))}
          {data.data.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No invoices found.</p>
          )}
        </div>
      )}

      {/* Desktop table */}
      <div className="rounded-md border hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="text-right">Face Value</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Risk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.data.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                  >
                    <TableCell className="font-mono text-sm">
                      {inv.invoiceNumber}
                    </TableCell>
                    <TableCell>{inv.supplierName}</TableCell>
                    <TableCell>{inv.buyerName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatUGX(inv.faceValue)}
                    </TableCell>
                    <TableCell>{formatDate(inv.dueDate)}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell>
                      {inv.riskLevel ? (
                        <span className="text-xs capitalize">{inv.riskLevel}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && isError && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-destructive">
                  Could not load invoices. Please refresh and try again.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No invoices found.
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
              disabled={data.page <= 1}
              onClick={() => handlePageChange(data.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.page >= data.totalPages}
              onClick={() => handlePageChange(data.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default InvoicesListPage;
