import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { RiskBadge } from '@/components/display/status-badge';
import { AmountDisplay } from '@/components/display/amount-display';
import { useSupplierDetail } from '../hooks/use-suppliers';

export function SupplierDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useSupplierDetail(id ?? '');

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  // Explicit error state — e.g. 404 when a supplier ID in the URL no longer exists.
  if (isError || !data || !data.id) {
    return (
      <div className="py-20 text-center space-y-3">
        <p className="text-muted-foreground">Supplier not found.</p>
        <Button variant="outline" onClick={() => navigate('/suppliers')}>
          <ArrowLeft className="mr-2 size-4" /> Back to suppliers
        </Button>
      </div>
    );
  }

  const s = data;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/suppliers')}><ArrowLeft className="size-4" /></Button>
        <div className="flex flex-1 items-center gap-3">
          <h1 className="text-2xl font-bold font-display">{s.company}</h1>
          <Badge variant="outline" className="capitalize">{s.status}</Badge>
          <RiskBadge level={s.riskBand} />
        </div>
        {/* Checkers §5 entry point — any staff viewing the supplier can open
            the full KYC review page (documents, comments, feedback, approve/reject). */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/admin/suppliers/${s.id}/kyc`)}
        >
          <ClipboardCheck className="mr-2 size-4" />
          Review KYC
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Contact</p><p className="text-sm font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.contactEmail}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Invoices</p><p className="text-lg font-bold">{s.totalInvoices}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Outstanding</p><AmountDisplay value={s.totalOutstandingUgx} className="text-lg font-bold" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Phone</p><p className="text-sm font-medium">{s.contactPhone}</p></CardContent></Card>
      </div>
      {s.metrics && (
        <Card>
          <CardHeader><CardTitle className="text-base">Performance Metrics</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {/*
              Defaults guard against a freshly registered supplier whose
              metrics object exists but whose individual numbers are null /
              undefined (no transactions yet). Calling .toFixed on undefined
              previously crashed the whole page with a white screen.
            */}
            <div><p className="text-xs text-muted-foreground">Collection Rate</p><p className="text-lg font-bold">{(s.metrics.collectionRate ?? 0).toFixed(1)}%</p></div>
            <div><p className="text-xs text-muted-foreground">Avg Days to Payment</p><p className="text-lg font-bold">{(s.metrics.avgDaysToPayment ?? 0).toFixed(0)}d</p></div>
            <div><p className="text-xs text-muted-foreground">Total Invoices</p><p className="text-lg font-bold">{s.metrics.totalInvoices ?? 0}</p></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export default SupplierDetailPage;
