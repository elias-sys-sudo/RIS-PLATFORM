import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AmountDisplay } from '@/components/display/amount-display';
import { RiskBadge } from '@/components/display/status-badge';
import { useSuppliers } from '../hooks/use-suppliers';
import { formatDate } from '@/lib/format-date';

const STATUS_COLORS: Record<string, string> = { active: 'bg-green-50 text-green-700', inactive: 'bg-gray-50 text-gray-500', suspended: 'bg-red-50 text-red-700' };

export function SuppliersListPage(): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSuppliers({ search: search || undefined, page, page_size: 20 });

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold font-display">Suppliers</h1><p className="text-sm text-muted-foreground">{data?.total ?? 0} suppliers</p></div>
      <div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Contact</TableHead><TableHead>Status</TableHead><TableHead>Risk</TableHead><TableHead>Invoices</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Joined</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>)}</TableRow>) :
              data?.data.map((s) => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/suppliers/${s.id}`)}>
                  <TableCell className="font-medium">{s.company}</TableCell>
                  <TableCell className="text-sm">{s.name}</TableCell>
                  <TableCell><Badge variant="outline" className={STATUS_COLORS[s.status] ?? ''}>{s.status}</Badge></TableCell>
                  <TableCell><RiskBadge level={s.riskBand} /></TableCell>
                  <TableCell>{s.totalInvoices}</TableCell>
                  <TableCell className="text-right"><AmountDisplay value={s.totalOutstandingUgx} /></TableCell>
                  <TableCell className="text-xs">{formatDate(s.registrationDate)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
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
export default SuppliersListPage;
