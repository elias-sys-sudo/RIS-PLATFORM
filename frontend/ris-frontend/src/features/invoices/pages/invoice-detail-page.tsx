import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { InvoiceStatusBadge } from '../components/invoice-status-badge';
import { InvoiceActions } from '../components/invoice-actions';
import { InvoiceBankDetailsSection } from '../components/invoice-bank-details-section';
import { DocumentUpload } from '../components/document-upload';
import { CollateralSection } from '../components/collateral-section';
import { PricingBreakdownCard } from '@/features/pricing/components/pricing-breakdown-card';
import { PricingTransparency } from '../components/pricing-transparency';
import { useInvoiceDetail } from '../hooks/use-invoices';
import { useAuthStore } from '@/store/auth.store';
import { useQueryClient } from '@tanstack/react-query';
import { formatUGX } from '@/lib/format-ugx';
import { formatDate, formatAbsolute } from '@/lib/format-date';

/** Statuses at which pricing has been generated and the breakdown should be visible */
const PRICING_VISIBLE_STATUSES = new Set([
  'priced', 'approved', 'rejected',
  'pending_first_auth', 'pending_second_auth',
  'executing', 'funded', 'collecting',
  'overdue', 'collected', 'defaulted',
]);

export function InvoiceDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: inv, isLoading, error } = useInvoiceDetail(id ?? '');
  const role = useAuthStore((s) => s.role);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !inv) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <FileText className="size-12 text-muted-foreground" />
        <p className="text-muted-foreground">Invoice not found.</p>
        <Button variant="outline" onClick={() => navigate('/invoices')}>
          Back to invoices
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/invoices')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono">{inv.invoiceNumber}</h1>
            <InvoiceStatusBadge status={inv.status} />
            {inv.riskLevel && (
              <Badge variant="outline" className="text-xs capitalize">
                {inv.riskLevel} risk
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Created {formatDate(inv.createdAt)}
          </p>
        </div>
      </div>

      {/* Workflow Actions */}
      <InvoiceActions
        invoiceId={inv.id}
        status={inv.status}
        invoiceNumber={inv.invoiceNumber}
        invoice={inv}
      />

      {/* G6 — Post-approval bank details capture (supplier only, status=approved) */}
      <InvoiceBankDetailsSection
        invoiceId={inv.id}
        status={inv.status}
        bankDetailsCapturedAt={inv.bankDetailsCapturedAt}
        canCapture={role === 'supplier'}
      />

      {/* Financials */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Face Value</p>
            <p className="text-xl font-bold font-mono">{formatUGX(inv.faceValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Advance Amount</p>
            <p className="text-xl font-bold font-mono">{formatUGX(inv.advanceAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Discount</p>
            <p className="text-xl font-bold font-mono">{formatUGX(inv.discountAmount)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Details grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Supplier / Buyer info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">Supplier</p>
              <p className="text-sm font-medium">{inv.supplierInfo.name}</p>
              <p className="text-xs text-muted-foreground">{inv.supplierInfo.industry}</p>
            </div>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground">Buyer</p>
              <p className="text-sm font-medium">{inv.buyerInfo.name}</p>
              <p className="text-xs text-muted-foreground">{inv.buyerInfo.industry}</p>
            </div>
          </CardContent>
        </Card>

        {/* Dates / Meta */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Issue Date</span>
              <span>{formatDate(inv.issueDate)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Due Date</span>
              <span>{formatDate(inv.dueDate)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tenor</span>
              <span>{inv.tenor} days</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Risk Score</span>
              <span>{inv.riskScore ?? '—'}</span>
            </div>
            {inv.fundedAt && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Funded At</span>
                <span>{formatAbsolute(inv.fundedAt)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Risk breakdown */}
      {inv.riskBreakdown && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Risk Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Object.entries(inv.riskBreakdown).map(([key, val]) => (
                <div key={key}>
                  <p className="text-xs text-muted-foreground capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </p>
                  <p className="text-lg font-bold">{(val as number).toFixed(1)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pricing transparency hero — supplier-only, priced status */}
      {role === 'supplier' && inv.status === 'priced' && inv.netPaymentToSupplier != null && (
        <PricingTransparency
          faceValue={inv.faceValue}
          netPayment={inv.netPaymentToSupplier}
          discountAmount={inv.discountAmount}
          tenor={inv.tenor}
          paymentMethod="Mobile Money"
        />
      )}

      {/* Pricing breakdown — visible once invoice has been priced */}
      {PRICING_VISIBLE_STATUSES.has(inv.status) && (
        <PricingBreakdownCard invoiceId={inv.id} />
      )}

      {/* Status timeline */}
      {inv.statusTimeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {inv.statusTimeline.map((t, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <InvoiceStatusBadge status={t.status} />
                      <span className="text-xs text-muted-foreground">
                        {formatAbsolute(t.transitionedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.actorName} ({t.actorRole}){t.notes ? ` — ${t.notes}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Documents & Collateral */}
      <div className="grid gap-6 md:grid-cols-2">
        <DocumentUpload
          invoiceId={inv.id}
          documents={inv.documents}
          onUploadComplete={() => void qc.invalidateQueries({ queryKey: ['invoices', id] })}
          readOnly={inv.status !== 'draft' && inv.status !== 'submitted'}
        />
        <CollateralSection
          invoiceId={inv.id}
          items={inv.collateral}
          readOnly={inv.status !== 'draft' && inv.status !== 'submitted'}
        />
      </div>

      {/* AML flag warning */}
      {(inv as unknown as { amlFlagged?: boolean }).amlFlagged && (
        <Card className="border-orange-300 bg-orange-50">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="size-5 text-orange-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-orange-800">AML Flag</p>
              <p className="text-xs text-orange-700">
                This invoice has been flagged for exceeding the AML threshold of UGX 100,000,000.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default InvoiceDetailPage;
