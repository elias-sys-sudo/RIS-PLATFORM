import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AmountDisplay } from '@/components/display/amount-display';
import { useFacilityDetail } from '../hooks/use-facilities';
import { formatDate, formatAbsolute } from '@/lib/format-date';

export function FacilityDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: f, isLoading } = useFacilityDetail(id ?? '');

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!f) return <div className="py-20 text-center text-muted-foreground">Facility not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/facilities')}><ArrowLeft className="size-4" /></Button>
        <div><h1 className="text-2xl font-bold font-display">{f.bankName}</h1><Badge variant="outline" className="capitalize">{f.status}</Badge></div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Limit</p><AmountDisplay value={f.totalLimit} className="text-lg font-bold" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Drawn</p><AmountDisplay value={f.drawnAmount} className="text-lg font-bold" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Available</p><AmountDisplay value={f.availableAmount} className="text-lg font-bold text-green-600" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Utilisation</p><div className="flex items-center gap-2 mt-1"><Progress value={f.utilisationPct} className="h-2 flex-1" /><span className="text-sm font-bold">{f.utilisationPct.toFixed(1)}%</span></div></CardContent></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Interest Rate</p><p className="text-lg font-bold">{f.interestRate}%</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Interest Accrued</p><AmountDisplay value={f.interestAccrued} className="text-lg font-bold" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Maturity</p><p className="text-sm font-medium">{formatDate(f.maturityDate)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Drawdowns ({f.drawdowns.length})</CardTitle></CardHeader>
        <CardContent>
          <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{f.drawdowns.map((d) => (
              <TableRow key={d.id}><TableCell className="text-xs">{formatAbsolute(d.drawnAt)}</TableCell><TableCell className="font-mono text-xs">{d.invoiceRef}</TableCell><TableCell className="text-right"><AmountDisplay value={d.amount} /></TableCell></TableRow>
            ))}</TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Repayments ({f.repayments.length})</CardTitle></CardHeader>
        <CardContent>
          <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{f.repayments.map((r) => (
              <TableRow key={r.id}><TableCell className="text-xs">{formatAbsolute(r.paidAt)}</TableCell><TableCell className="font-mono text-xs">{r.reference}</TableCell><TableCell className="text-right"><AmountDisplay value={r.amount} /></TableCell></TableRow>
            ))}</TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default FacilityDetailPage;
