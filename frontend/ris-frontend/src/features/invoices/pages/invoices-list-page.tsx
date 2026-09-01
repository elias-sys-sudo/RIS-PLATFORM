import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Search, FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InvoiceStatusBadge } from '../components/invoice-status-badge';
import { InvoiceCard } from '../components/invoice-card';
import { useInvoices } from '../hooks/use-invoices';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';
import { useAuthStore } from '@/store/auth.store';
import type { InvoiceFilters, InvoiceStatus } from '@/types/invoice.types';

const POPULAR_FILTER_PILLS: { label: string; value: string }[] = [
  { label: 'All Invoices', value: 'all' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'Verified', value: 'verified' },
  { label: 'Priced', value: 'priced' },
  { label: 'Approved', value: 'approved' },
  { label: 'Funded', value: 'funded' },
  { label: 'Overdue', value: 'overdue' },
];

export function InvoicesListPage(): React.ReactElement {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const [filters, setFilters] = useState<InvoiceFilters>({
    page: 1,
    page_size: 20,
  });
  const [search, setSearch] = useState('');
  const isMobile = useIsMobile();

  const { data, isLoading, isError } = useInvoices({
    ...filters,
    status: filters.status,
    search: search || undefined,
  });

  const activeStatus = filters.status?.[0] ?? 'all';

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
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Invoices</h1>
            <Badge variant="outline" className="text-xs font-mono">
              {data ? `${data.total} Total` : isLoading ? 'Loading...' : '0'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage, track, and discount commercial trade invoices
          </p>
        </div>

        {role === 'supplier' && (
          <Button asChild variant="gradient" className="font-bold text-xs shadow-md">
            <Link to="/invoices/new">
              <Plus className="mr-1.5 size-4" /> New Invoice
            </Link>
          </Button>
        )}
      </div>

      {/* Filter Tabs & Search */}
      <div className="space-y-3">
        {/* Quick Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {POPULAR_FILTER_PILLS.map((pill) => {
            const isSelected = activeStatus === pill.value;
            return (
              <button
                key={pill.value}
                type="button"
                onClick={() => handleStatusFilter(pill.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'bg-card/80 text-muted-foreground hover:text-foreground hover:bg-accent/40 border border-border/70'
                }`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by invoice # or buyer name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8 h-10 rounded-xl bg-card/60 border-border/80 text-sm focus-visible:ring-primary"
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
      </div>

      {/* Mobile card view */}
      {isMobile && !isLoading && data?.data && (
        <div className="space-y-3 md:hidden">
          {data.data.map((inv) => (
            <InvoiceCard key={inv.id} invoice={inv} />
          ))}
          {data.data.length === 0 && (
            <div className="text-center py-12 rounded-2xl border border-dashed border-border p-6 space-y-2">
              <FileText className="mx-auto size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">No invoices matching filters.</p>
            </div>
          )}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block overflow-hidden rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-xs">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Invoice #</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Supplier</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Buyer</TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Face Value</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Maturity Date</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Risk Grade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24 rounded" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.data.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                  >
                    <TableCell className="font-mono text-xs font-bold text-primary">
                      {inv.invoiceNumber}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{inv.supplierName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{inv.buyerName}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm">
                      {formatUGX(inv.faceValue)}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{formatDate(inv.dueDate)}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell>
                      {inv.riskLevel ? (
                        <Badge
                          variant={
                            inv.riskLevel === 'low'
                              ? 'success'
                              : inv.riskLevel === 'high'
                              ? 'destructive'
                              : 'warning'
                          }
                          className="text-[10px] font-semibold uppercase tracking-wider"
                        >
                          {inv.riskLevel}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground font-mono">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && isError && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-destructive">
                  Could not load invoices. Please verify your connection and try again.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  <FileText className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No invoices found matching current criteria.</p>
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
              disabled={data.page <= 1}
              onClick={() => handlePageChange(data.page - 1)}
              className="text-xs rounded-lg"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.page >= data.totalPages}
              onClick={() => handlePageChange(data.page + 1)}
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

export default InvoicesListPage;

