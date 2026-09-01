import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Building, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AmountDisplay } from '@/components/display/amount-display';
import { RiskBadge } from '@/components/display/status-badge';
import { useSuppliers } from '../hooks/use-suppliers';
import { formatDate } from '@/lib/format-date';

export function SuppliersListPage(): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSuppliers({ search: search || undefined, page, page_size: 20 });

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Suppliers</h1>
            <Badge variant="outline" className="text-xs font-mono">
              {data?.total ?? 0} Active
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Registered SME commercial suppliers, risk bands &amp; exposure balances
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search suppliers by name or tax ID..."
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

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-xs">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Company</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Contact Person</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">KYC Status</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Risk Band</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Invoices</TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Total Outstanding</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Joined Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
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
                    onClick={() => navigate(`/suppliers/${s.id}`)}
                  >
                    <TableCell className="font-semibold text-sm text-foreground">{s.company}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={s.status === 'active' ? 'success' : s.status === 'suspended' ? 'destructive' : 'outline'}
                        className="text-[10px] font-semibold uppercase"
                      >
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <RiskBadge level={s.riskBand} />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{s.totalInvoices}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm">
                      <AmountDisplay value={s.totalOutstandingUgx} />
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{formatDate(s.registrationDate)}</TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  <Building className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No suppliers matching search criteria.</p>
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

export default SuppliersListPage;

