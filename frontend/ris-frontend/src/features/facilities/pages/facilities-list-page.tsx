import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFacilities } from '../hooks/use-facilities';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate } from '@/lib/format-date';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-50 text-green-700', matured: 'bg-blue-50 text-blue-700',
  closed: 'bg-gray-50 text-gray-500', suspended: 'bg-red-50 text-red-700',
};

export function FacilitiesListPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, isLoading } = useFacilities();

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold font-display">Facilities</h1><p className="text-sm text-muted-foreground">Bank credit line management</p></div>
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Bank</TableHead><TableHead className="text-right">Total Limit</TableHead>
            <TableHead className="text-right">Drawn</TableHead><TableHead className="text-right">Available</TableHead>
            <TableHead>Utilisation</TableHead><TableHead className="text-right">Interest</TableHead>
            <TableHead>Maturity</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>)}</TableRow>
            )) : data?.data.map((f) => (
              <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/facilities/${f.id}`)}>
                <TableCell className="font-medium">{f.bankName}</TableCell>
                <TableCell className="text-right font-mono">{formatUGX(f.totalLimit)}</TableCell>
                <TableCell className="text-right font-mono">{formatUGX(f.drawnAmount)}</TableCell>
                <TableCell className="text-right font-mono">{formatUGX(f.availableAmount)}</TableCell>
                <TableCell><div className="flex items-center gap-2"><Progress value={f.utilisationPct} className="h-2 w-16" /><span className="text-xs">{f.utilisationPct.toFixed(0)}%</span></div></TableCell>
                <TableCell className="text-right font-mono">{formatUGX(f.interestAccrued)}</TableCell>
                <TableCell className="text-xs">{formatDate(f.maturityDate)}</TableCell>
                <TableCell><Badge variant="outline" className={STATUS_COLORS[f.status] ?? ''}>{f.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default FacilitiesListPage;
