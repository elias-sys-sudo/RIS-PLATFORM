import { useNavigate, Link } from 'react-router-dom';
import { Plus, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight">Corporate Buyers</h1>
            <Badge variant="outline" className="text-xs font-mono">
              {data?.total ?? 0} Onboarded
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Approved corporate obligors, assigned credit limits &amp; payment term horizons
          </p>
        </div>
        {canCreate && (
          <Button asChild variant="gradient" className="font-bold text-xs shadow-md">
            <Link to="/buyers/new">
              <Plus className="mr-1.5 size-4" /> New Buyer
            </Link>
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-xs">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Corporate Debtor</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Industry Sector</TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wider">Assigned Credit Limit</TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wider">Payment Terms</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20 rounded" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.data.map((b) => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/buyers/${b.id}`)}
                  >
                    <TableCell className="font-semibold text-sm text-foreground">{b.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.industry}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm">
                      <AmountDisplay value={b.creditLimit} />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{b.paymentTermsDays} Days</TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                  <Building2 className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No corporate buyers registered.</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default BuyersListPage;

