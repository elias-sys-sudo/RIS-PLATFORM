import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AmountDisplay } from '@/components/display/amount-display';
import { useAuthStore } from '@/store/auth.store';
import { useBuyers } from '../hooks/use-buyers';

export function BuyersListPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, isLoading } = useBuyers();
  const role = useAuthStore((s) => s.role);
  const canCreate = role === 'credit_officer' || role === 'management';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold font-display">Buyers</h1><p className="text-sm text-muted-foreground">{data?.total ?? 0} buyers</p></div>
        {canCreate && (
          <Button onClick={() => navigate('/buyers/new')}><Plus className="mr-1 size-4" /> New Buyer</Button>
        )}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Industry</TableHead><TableHead className="text-right">Credit Limit</TableHead><TableHead>Payment Terms</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 4 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>)}</TableRow>) :
              data?.data.map((b) => (
                <TableRow key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/buyers/${b.id}`)}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>{b.industry}</TableCell>
                  <TableCell className="text-right"><AmountDisplay value={b.creditLimit} /></TableCell>
                  <TableCell>{b.paymentTermsDays}d</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
export default BuyersListPage;
