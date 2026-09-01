import { useState } from 'react';
import { Check, X, Loader2, AlertTriangle, Clock, MessageSquare, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatUGX } from '@/lib/format-ugx';
import { formatAbsolute } from '@/lib/format-date';
import { useAuthStore } from '@/store/auth.store';
import {
  usePricing,
  useAcceptPricing,
  useRejectPricing,
  useDisputePricing,
} from '../hooks/use-pricing';
import {
  DISPUTE_REASON_LABELS,
} from '../api/pricing.api';
import type { DisputeReason } from '../api/pricing.api';

// ── Types & constants ─────────────────────────────────────────────────────────

const DISPUTE_REASONS: DisputeReason[] = [
  'rate_too_high',
  'advance_too_low',
  'tenor_mismatch',
  'calculation_error',
  'other',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'accepted') return 'default';
  if (status === 'rejected') return 'destructive';
  if (status === 'disputed') return 'outline';
  return 'secondary';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':  return 'Awaiting Your Response';
    case 'accepted': return 'Accepted';
    case 'rejected': return 'Declined';
    case 'disputed': return 'Under Review';
    default:         return status;
  }
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

// ── Fee line ──────────────────────────────────────────────────────────────────

interface FeeLineProps {
  label:     string;
  value:     string;
  bold?:     boolean;
  highlight?: 'green' | 'red';
  sublabel?: string;
}

function FeeLine({ label, value, bold, highlight, sublabel }: FeeLineProps): React.ReactElement {
  const valueClass = [
    'font-mono text-sm',
    bold      ? 'font-bold text-base'                            : '',
    highlight === 'green' ? 'text-emerald-600 dark:text-emerald-400' : '',
    highlight === 'red'   ? 'text-destructive'                       : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="flex items-baseline justify-between py-1.5">
      <div>
        <span className="text-sm text-muted-foreground">{label}</span>
        {sublabel && (
          <span className="ml-1 text-xs text-muted-foreground/70">({sublabel})</span>
        )}
      </div>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

// ── Dispute dialog (2-step) ───────────────────────────────────────────────────

interface DisputeDialogProps {
  invoiceId: string;
  open:      boolean;
  onClose:   () => void;
}

function DisputeDialog({ invoiceId, open, onClose }: DisputeDialogProps): React.ReactElement {
  const [step,                setStep]                = useState<1 | 2>(1);
  const [selectedReason,      setSelectedReason]      = useState<DisputeReason | null>(null);
  const [proposedRate,        setProposedRate]        = useState('');
  const [proposedAdvance,     setProposedAdvance]     = useState('');
  const [notes,               setNotes]               = useState('');
  const disputeMutation = useDisputePricing();

  function handleClose(): void {
    setStep(1);
    setSelectedReason(null);
    setProposedRate('');
    setProposedAdvance('');
    setNotes('');
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (!selectedReason) return;
    await disputeMutation.mutateAsync({
      invoiceId,
      payload: {
        reason:                    selectedReason,
        proposedRate:              proposedRate    ? parseFloat(proposedRate)    : undefined,
        proposedAdvancePercentage: proposedAdvance ? parseFloat(proposedAdvance) : undefined,
        notes:                     notes.trim() || undefined,
      },
    });
    handleClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        {step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="size-4 text-amber-500" />
                Raise a Pricing Concern
              </DialogTitle>
              <DialogDescription>
                What is your concern with this pricing? Select the option that best describes it.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-2">
              {DISPUTE_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setSelectedReason(reason)}
                  className={[
                    'flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors',
                    'hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20',
                    selectedReason === reason
                      ? 'border-amber-400 bg-amber-50 font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                      : 'border-border text-muted-foreground',
                  ].join(' ')}
                >
                  {DISPUTE_REASON_LABELS[reason]}
                  {selectedReason === reason && (
                    <Check className="size-4 text-amber-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                disabled={!selectedReason}
                onClick={() => setStep(2)}
                className="gap-2"
              >
                Continue <ChevronRight className="size-4" />
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 2 && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="size-4 text-amber-500" />
                Provide Details
              </DialogTitle>
              <DialogDescription>
                Optionally suggest alternative terms and add any supporting context.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Concern summary */}
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Your concern: </span>
                <span className="font-medium">
                  {selectedReason ? DISPUTE_REASON_LABELS[selectedReason] : ''}
                </span>
              </div>

              {/* Counter-proposal fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="proposed-rate" className="text-xs">
                    Acceptable Rate (%) <span className="text-muted-foreground">optional</span>
                  </Label>
                  <Input
                    id="proposed-rate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="e.g. 2.50"
                    value={proposedRate}
                    onChange={(e) => setProposedRate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="proposed-advance" className="text-xs">
                    Acceptable Advance (%) <span className="text-muted-foreground">optional</span>
                  </Label>
                  <Input
                    id="proposed-advance"
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    placeholder="e.g. 95"
                    value={proposedAdvance}
                    onChange={(e) => setProposedAdvance(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-xs">
                  Additional context <span className="text-muted-foreground">optional</span>
                </Label>
                <Textarea
                  id="notes"
                  rows={3}
                  placeholder="e.g. We received a quote of 2.8% from another lender for a similar tenor."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* What happens next */}
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-3 py-3 space-y-1">
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                  <Clock className="size-3" /> What happens next
                </p>
                <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-0.5 pl-4 list-disc">
                  <li>Your dispute is logged and sent to our credit team immediately.</li>
                  <li>We will respond within <strong>1 business day</strong> with a revised offer or explanation.</li>
                  <li>Your invoice remains eligible for funding during this period.</li>
                </ul>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)} disabled={disputeMutation.isPending}>
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={disputeMutation.isPending}
                className="bg-amber-500 hover:bg-amber-600 text-white gap-2"
              >
                {disputeMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                Submit Dispute
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Decline dialog (simple) ───────────────────────────────────────────────────

interface DeclineDialogProps {
  invoiceId: string;
  isPending: boolean;
  onDecline: (invoiceId: string, reason?: string) => void;
  open:      boolean;
  onClose:   () => void;
}

function DeclineDialog({ invoiceId, isPending, onDecline, open, onClose }: DeclineDialogProps): React.ReactElement {
  const [reason, setReason] = useState('');

  function handleSubmit(): void {
    onDecline(invoiceId, reason.trim() || undefined);
    setReason('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(''); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" />
            Decline Pricing
          </DialogTitle>
          <DialogDescription>
            Declining will close this pricing offer. This action cannot be undone.
            If you have concerns about the terms, consider <strong>raising a dispute</strong> instead
            — it keeps the deal open while we work with you on pricing.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Reason for declining (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Confirm Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Disputed state banner ─────────────────────────────────────────────────────

function DisputedBanner({ disputedAt, slaDeadline }: {
  disputedAt:  string;
  slaDeadline: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 space-y-1">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
        <Clock className="size-4" />
        Dispute Under Review
      </p>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Submitted {formatAbsolute(disputedAt)}. Our credit team will respond by{' '}
        <span className="font-medium">{formatAbsolute(slaDeadline)}</span>.
      </p>
      <p className="text-xs text-amber-600 dark:text-amber-500">
        Your invoice remains eligible for funding while this is being reviewed.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface PricingBreakdownCardProps {
  invoiceId: string;
}

export function PricingBreakdownCard({ invoiceId }: PricingBreakdownCardProps): React.ReactElement {
  const { data: pricing, isLoading, error } = usePricing(invoiceId);
  const acceptMutation  = useAcceptPricing();
  const rejectMutation  = useRejectPricing();
  const role            = useAuthStore((s) => s.role);

  const [disputeOpen,  setDisputeOpen]  = useState(false);
  const [declineOpen,  setDeclineOpen]  = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (error || !pricing) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Pricing Breakdown</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Unable to load pricing details.</p>
        </CardContent>
      </Card>
    );
  }

  const isSupplier  = role === 'supplier';
  const isPending   = pricing.status === 'pending';
  const isDisputed  = pricing.status === 'disputed';
  const showActions = isSupplier && isPending;

  function handleAccept(): void {
    acceptMutation.mutate(invoiceId);
  }

  function handleDecline(id: string, reason?: string): void {
    rejectMutation.mutate({ invoiceId: id, reason });
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Pricing Breakdown</CardTitle>
          <Badge variant={statusBadgeVariant(pricing.status)}>
            {statusLabel(pricing.status)}
          </Badge>
        </CardHeader>

        <CardContent className="space-y-1">
          {/* Invoice amounts */}
          <FeeLine label="Face Value"          value={formatUGX(pricing.faceValue)} />
          <FeeLine label="Advance Percentage"  value={formatPercent(pricing.advancePercentage)} />
          <FeeLine label="Advance Amount"      value={formatUGX(pricing.advanceAmount)} />

          <Separator className="my-2" />

          {/* Cost breakdown */}
          <FeeLine label="Discount Rate"    value={formatPercent(pricing.discountRate)} />
          <FeeLine
            label="Discount Amount"
            value={formatUGX(pricing.discountAmount)}
            sublabel="cost to supplier"
            highlight="red"
          />
          <FeeLine label="Bank Cost"        value={formatUGX(pricing.bankCost)} />
          <FeeLine label="Risk Premium"     value={formatUGX(pricing.riskPremium)} />
          <FeeLine label="RIS Margin"       value={formatUGX(pricing.risMargin)} />

          <Separator className="my-2" />

          <FeeLine label="Tenor" value={`${pricing.tenor} days`} />
          <FeeLine
            label="Net Payment to Supplier"
            value={formatUGX(pricing.netPaymentToSupplier)}
            bold
            highlight="green"
          />

          {/* Status stamps */}
          {pricing.acceptedAt && (
            <div className="mt-3 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="size-4" />
              <span>Accepted on {formatAbsolute(pricing.acceptedAt)}</span>
            </div>
          )}
          {pricing.rejectedAt && (
            <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
              <X className="size-4" />
              <span>Declined on {formatAbsolute(pricing.rejectedAt)}</span>
            </div>
          )}

          {/* Dispute summary */}
          {isDisputed && pricing.dispute && pricing.disputedAt && (
            <div className="mt-4">
              <DisputedBanner
                disputedAt={pricing.disputedAt}
                slaDeadline={pricing.dispute.slaDeadline}
              />
              {pricing.dispute.proposedRate != null && (
                <p className="mt-2 text-xs text-muted-foreground">
                  You proposed a rate of{' '}
                  <span className="font-medium">{pricing.dispute.proposedRate.toFixed(2)}%</span>
                  {pricing.dispute.proposedAdvancePercentage != null && (
                    <> and advance of{' '}
                      <span className="font-medium">{pricing.dispute.proposedAdvancePercentage}%</span>
                    </>
                  )}.
                </p>
              )}
            </div>
          )}

          {/* ── Three-path supplier actions ── */}
          {showActions && (
            <div className="mt-5 space-y-3">
              {/* Primary: Accept */}
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                onClick={handleAccept}
                disabled={acceptMutation.isPending || rejectMutation.isPending}
              >
                {acceptMutation.isPending
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Check className="size-4" />}
                Accept These Terms
              </Button>

              {/* Secondary: Dispute (keeps deal alive) */}
              <Button
                variant="outline"
                className="w-full border-amber-400 text-amber-700 hover:bg-amber-50 hover:border-amber-500 gap-2 dark:text-amber-400 dark:hover:bg-amber-950/20"
                onClick={() => setDisputeOpen(true)}
                disabled={acceptMutation.isPending || rejectMutation.isPending}
              >
                <MessageSquare className="size-4" />
                Dispute / Request Better Terms
              </Button>

              {/* Tertiary: True decline — equal-prominence destructive button */}
              <Button
                variant="destructive"
                className="w-full gap-2"
                onClick={() => setDeclineOpen(true)}
                disabled={acceptMutation.isPending || rejectMutation.isPending}
              >
                <X className="size-4" />
                Decline and Walk Away
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Raising a dispute keeps your invoice eligible for funding while we review your concerns.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <DisputeDialog
        invoiceId={invoiceId}
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
      />
      <DeclineDialog
        invoiceId={invoiceId}
        isPending={rejectMutation.isPending}
        onDecline={handleDecline}
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
      />
    </>
  );
}
