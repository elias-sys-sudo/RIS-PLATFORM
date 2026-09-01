import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, AlertTriangle, Building, Landmark, Calendar, Clock, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !inv) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <FileText className="size-8" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Invoice Not Found</h2>
          <p className="text-sm text-muted-foreground">The requested invoice could not be located or has been archived.</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/invoices')} className="rounded-xl">
          <ArrowLeft className="mr-1.5 size-4" /> Back to Invoices
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate('/invoices')}
            className="rounded-xl border-border/80 text-muted-foreground hover:text-foreground shrink-0"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold font-mono text-primary tracking-tight">
                {inv.invoiceNumber}
              </h1>
              <InvoiceStatusBadge status={inv.status} />
              {inv.riskLevel && (
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
                  {inv.riskLevel} Risk
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              Created on {formatDate(inv.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Workflow Actions Banner */}
      <InvoiceActions
        invoiceId={inv.id}
        status={inv.status}
        invoiceNumber={inv.invoiceNumber}
        invoice={inv}
      />

      {/* Post-approval bank details capture (supplier only, status=approved) */}
      <InvoiceBankDetailsSection
        invoiceId={inv.id}
        status={inv.status}
        bankDetailsCapturedAt={inv.bankDetailsCapturedAt}
        canCapture={role === 'supplier'}
      />

      {/* 3 Core Financial Metric Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card shadow-xs hover:border-primary/40 transition-all">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invoice Face Value</p>
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Landmark className="size-3.5" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-bold font-display tabular-nums tracking-tight">
              {formatUGX(inv.faceValue)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Full commercial value due from buyer</p>
          </CardContent>
        </Card>

        <Card className="glass-card shadow-xs hover:border-emerald-500/40 transition-all">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Net Supplier Advance</p>
              <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <Sparkles className="size-3.5" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-bold font-display tabular-nums text-emerald-600 dark:text-emerald-400 tracking-tight">
              {formatUGX(inv.advanceAmount)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Available early liquidity payout</p>
          </CardContent>
        </Card>

        <Card className="glass-card shadow-xs hover:border-amber-500/40 transition-all">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Discounting Fee</p>
              <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                <Clock className="size-3.5" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-bold font-display tabular-nums text-amber-600 dark:text-amber-400 tracking-tight">
              {formatUGX(inv.discountAmount)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Financing & risk margin</p>
          </CardContent>
        </Card>
      </div>

      {/* Details Grid: Parties & Timelines */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Parties */}
        <Card className="glass-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold font-display flex items-center gap-2">
              <Building className="size-4 text-primary" />
              Commercial Counterparties
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border/60 p-3 bg-muted/20">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Supplier (Payee)</p>
              <p className="text-sm font-bold text-foreground mt-0.5">{inv.supplierInfo.name}</p>
              <p className="text-xs text-muted-foreground">{inv.supplierInfo.industry}</p>
            </div>
            <div className="rounded-xl border border-border/60 p-3 bg-muted/20">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Buyer (Debtor)</p>
              <p className="text-sm font-bold text-foreground mt-0.5">{inv.buyerInfo.name}</p>
              <p className="text-xs text-muted-foreground">{inv.buyerInfo.industry}</p>
            </div>
          </CardContent>
        </Card>

        {/* Dates & Tenor */}
        <Card className="glass-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold font-display flex items-center gap-2">
              <Calendar className="size-4 text-primary" />
              Maturity & Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center text-sm py-1 border-b border-border/50">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Invoice Issue Date</span>
              <span className="font-mono font-medium">{formatDate(inv.issueDate)}</span>
            </div>
            <div className="flex justify-between items-center text-sm py-1 border-b border-border/50">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Payment Due Date</span>
              <span className="font-mono font-medium">{formatDate(inv.dueDate)}</span>
            </div>
            <div className="flex justify-between items-center text-sm py-1 border-b border-border/50">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Financing Tenor</span>
              <span className="font-mono font-bold text-primary">{inv.tenor} Days</span>
            </div>
            <div className="flex justify-between items-center text-sm py-1">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Risk Score (0–100)</span>
              <span className="font-mono font-bold">{inv.riskScore ?? '—'}</span>
            </div>
            {inv.fundedAt && (
              <div className="flex justify-between items-center text-sm py-1 border-t border-border/50">
                <span className="text-muted-foreground text-xs font-semibold uppercase">Funded Timestamp</span>
                <span className="font-mono text-xs text-emerald-600">{formatAbsolute(inv.fundedAt)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Risk Breakdown Scorecard */}
      {inv.riskBreakdown && (
        <Card className="glass-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold font-display flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              5-Factor Risk Breakdown
            </CardTitle>
            <CardDescription className="text-xs">Individual component scoring across buyer, supplier, and collateral metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {Object.entries(inv.riskBreakdown).map(([key, val]) => (
                <div key={key} className="rounded-xl border border-border/60 p-3 bg-muted/20 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </p>
                  <p className="text-xl font-extrabold font-mono text-foreground mt-1">
                    {(val as number).toFixed(1)}
                  </p>
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
        <Card className="glass-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold font-display">Status Transition Timeline</CardTitle>
            <CardDescription className="text-xs">Immutable audit trail of invoice lifecycle events</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {inv.statusTimeline.map((t, i) => (
                <div key={i} className="flex items-start gap-3 relative">
                  <div className="mt-1 flex size-3 items-center justify-center rounded-full bg-primary/20 ring-2 ring-primary/40 shrink-0">
                    <div className="size-1.5 rounded-full bg-primary" />
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <InvoiceStatusBadge status={t.status} />
                      <span className="text-xs font-mono text-muted-foreground">
                        {formatAbsolute(t.transitionedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Action by <span className="font-semibold text-foreground">{t.actorName}</span> ({t.actorRole})
                      {t.notes ? ` — "${t.notes}"` : ''}
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
        <Card className="border-amber-500/30 bg-amber-500/10 backdrop-blur-md">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="size-5 text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-900 dark:text-amber-300">AML Threshold Review Flag</p>
              <p className="text-xs text-amber-800 dark:text-amber-400">
                This invoice exceeds the AML threshold of UGX 100,000,000 and requires enhanced compliance verification.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default InvoiceDetailPage;

