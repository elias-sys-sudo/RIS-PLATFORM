import { Shield, AlertTriangle, FileText, Scale } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatCard } from '../components/stat-card';
import { useLegalDashboard } from '../hooks/use-dashboard';
import { formatUGX } from '@/lib/format-ugx';
import { formatRelative } from '@/lib/format-date';
import { AmountDisplay } from '@/components/display/amount-display';

const SAR_STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-amber-50 text-amber-700', filed: 'bg-blue-50 text-blue-700', cleared: 'bg-green-50 text-green-700',
};

export function ComplianceDashboard(): React.ReactElement {
  const navigate = useNavigate();
  const { data, isLoading } = useLegalDashboard();

  if (isLoading) return <div className="grid gap-6 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-display">Compliance Dashboard</h1>
        <p className="text-sm text-muted-foreground">AML monitoring & regulatory compliance</p>
      </div>

      {data && (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="SAR Flagged" value={String(data.sarFlaggedCount)} icon={AlertTriangle} />
            <StatCard title="SAR Total Amount" value={formatUGX(data.sarTotalAmount)} icon={Shield} />
            <StatCard title="SAR Items" value={String(data.sarItems.length)} icon={FileText} />
            <StatCard title="Tier-3 Escalations" value={String(data.tier3Escalations.length)} icon={Scale} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">SAR-Flagged Invoices</CardTitle></CardHeader>
            <CardContent>
              {data.sarItems.length === 0 ? <p className="text-sm text-muted-foreground">No SAR flags.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Supplier</TableHead><TableHead>Buyer</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Flagged</TableHead></TableRow></TableHeader>
                  <TableBody>{data.sarItems.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/invoices/${s.id}`)}>
                      <TableCell className="font-mono text-xs">{s.invoiceRef}</TableCell>
                      <TableCell>{s.supplierName}</TableCell>
                      <TableCell>{s.buyerName}</TableCell>
                      <TableCell className="text-right"><AmountDisplay value={s.amount} /></TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{s.reason}</TableCell>
                      <TableCell><Badge variant="outline" className={SAR_STATUS_COLORS[s.status] ?? ''}>{s.status.replace('_', ' ')}</Badge></TableCell>
                      <TableCell className="text-xs">{formatRelative(s.flaggedAt)}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Tier-3 Legal Escalations</CardTitle></CardHeader>
            <CardContent>
              {data.tier3Escalations.length === 0 ? <p className="text-sm text-muted-foreground">No tier-3 escalations.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Supplier</TableHead><TableHead>Buyer</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Days Overdue</TableHead><TableHead>Escalated</TableHead></TableRow></TableHeader>
                  <TableBody>{data.tier3Escalations.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.invoiceRef}</TableCell>
                      <TableCell>{e.supplierName}</TableCell>
                      <TableCell>{e.buyerName}</TableCell>
                      <TableCell className="text-right"><AmountDisplay value={e.amount} /></TableCell>
                      <TableCell className="text-orange-600 font-medium">{e.daysOverdue}d</TableCell>
                      <TableCell className="text-xs">{formatRelative(e.escalatedAt)}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
