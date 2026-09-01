import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Landmark, BookCheck, Lock, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AmountDisplay } from '@/components/display/amount-display';
import { TimelineStepper } from '@/components/display/timeline-stepper';
import { AmountComparison } from '@/components/display/amount-comparison';
import { ConfirmationDialog } from '@/components/overlays/confirmation-dialog';
import { formatAbsolute } from '@/lib/format-date';
import { formatUGX } from '@/lib/format-ugx';
import {
  useSettlementDetail,
  useRepayFacility,
  useBookProfit,
  useCloseSettlement,
} from '../hooks/use-settlements';
import type { SettlementStatus } from '../api/settlements.api';

const STATUS_COLORS: Record<SettlementStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  facility_repaid: 'bg-blue-50 text-blue-700 border-blue-200',
  profit_booked: 'bg-green-50 text-green-700 border-green-200',
  closed: 'bg-gray-50 text-gray-500 border-gray-200',
};

const STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: 'Pending',
  facility_repaid: 'Facility Repaid',
  profit_booked: 'Profit Booked',
  closed: 'Closed',
};

export function SettlementDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: s, isLoading } = useSettlementDetail(id ?? '');
  const repayFacility = useRepayFacility();
  const bookProfit = useBookProfit();
  const closeSettlement = useCloseSettlement();
  const [showConfirm, setShowConfirm] = useState<'repay' | 'profit' | 'close' | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!s) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Settlement not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settlements')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold font-mono">{s.invoiceNumber}</h1>
            <Badge variant="outline" className={STATUS_COLORS[s.status]}>
              {STATUS_LABELS[s.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {s.supplierName} → {s.buyerName}
          </p>
        </div>

        {/* Action button — shows next step based on current status */}
        {s.status === 'pending' && (
          <Button onClick={() => setShowConfirm('repay')}>
            <Landmark className="mr-2 size-4" /> Repay Facility
          </Button>
        )}
        {s.status === 'facility_repaid' && (
          <Button onClick={() => setShowConfirm('profit')}>
            <BookCheck className="mr-2 size-4" /> Book Profit
          </Button>
        )}
        {s.status === 'profit_booked' && (
          <Button onClick={() => setShowConfirm('close')}>
            <Lock className="mr-2 size-4" /> Close Settlement
          </Button>
        )}
      </div>

      {/* Closed banner */}
      {s.status === 'closed' && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="size-4 text-green-600" />
          <AlertDescription className="text-green-700">
            This settlement is closed. Profit of {formatUGX(s.netProfit)} has been booked.
          </AlertDescription>
        </Alert>
      )}

      {/* Settlement stages */}
      <TimelineStepper
        steps={[
          { id: 'pending', label: 'Settlement Initiated' },
          { id: 'facility_repaid', label: 'Facility Repaid' },
          { id: 'profit_booked', label: 'Profit Booked' },
          { id: 'closed', label: 'Closed' },
        ]}
        currentStepId={s.status}
        className="mb-2"
      />

      {/* Profit breakdown */}
      <AmountComparison
        heroLabel="Net Profit"
        heroAmount={String(s.netProfit ?? '0')}
        items={[
          { label: 'Discount Earned', amount: String(s.discountEarned ?? '0'), type: 'credit' },
          { label: 'Bank Cost', amount: String(s.facilityRepayment ?? '0'), type: 'debit' },
          { label: 'Penalty Income', amount: String(s.penaltyIncome ?? '0'), type: 'credit' },
        ]}
        className="mb-2"
      />

      {/* Collection details */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Face Value</p>
            <AmountDisplay value={s.faceValue} className="text-lg font-bold" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Collected Amount</p>
            <AmountDisplay value={s.collectedAmount} className="text-lg font-bold" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Collected At</p>
            <p className="text-sm font-medium">{formatAbsolute(s.collectedAt)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Advance & Facility */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advance & Facility</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Advance Amount</span>
            <AmountDisplay value={s.advanceAmount} />
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Facility Repayment</span>
            <AmountDisplay value={s.facilityRepayment} />
          </div>
        </CardContent>
      </Card>

      {/* Revenue Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Discount Earned</span>
            <AmountDisplay value={s.discountEarned} />
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Penalty Income</span>
            <AmountDisplay value={s.penaltyIncome} />
          </div>
          <Separator />
          <div className="flex justify-between text-sm font-bold">
            <span className="text-green-700">Net Profit</span>
            <AmountDisplay value={s.netProfit} className="text-green-700 font-bold" />
          </div>
        </CardContent>
      </Card>

      {/* Dates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Created</span>
            <span>{formatAbsolute(s.createdAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Settled At</span>
            <span>{s.settledAt ? formatAbsolute(s.settledAt) : '—'}</span>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation dialogs with financial event breakdowns */}
      <ConfirmationDialog
        open={showConfirm === 'repay'}
        onOpenChange={(open) => { if (!open) setShowConfirm(null); }}
        title="Repay Facility"
        description="This will record the facility repayment. The following financial events will occur:"
        confirmLabel="Repay Facility"
        onConfirm={async () => {
          await repayFacility.mutateAsync({
            id: id!,
            facilityRepaymentAmount: String(s.advanceAmount),
            accruedInterest: String(s.facilityRepayment),
          });
          setShowConfirm(null);
        }}
        isLoading={repayFacility.isPending}
      >
        <div className="rounded-lg border bg-secondary/30 p-4 space-y-2 text-sm my-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Repayment to bank</span>
            <AmountDisplay value={s.facilityRepayment} className="font-semibold" />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Advance disbursed</span>
            <AmountDisplay value={s.advanceAmount} />
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            The facility drawn amount will decrease and available balance will increase by this amount.
            An audit log entry will be created.
          </p>
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={showConfirm === 'profit'}
        onOpenChange={(open) => { if (!open) setShowConfirm(null); }}
        title="Book Profit"
        description="This publishes the net profit to the P&L report. The following will be booked:"
        confirmLabel="Book Profit"
        onConfirm={async () => {
          await bookProfit.mutateAsync({
            id: id!,
            discountEarned: String(s.discountEarned),
            bankCostPaid: String(s.facilityRepayment),
          });
          setShowConfirm(null);
        }}
        isLoading={bookProfit.isPending}
      >
        <div className="rounded-lg border bg-secondary/30 p-4 space-y-2 text-sm my-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discount earned</span>
            <AmountDisplay value={s.discountEarned} className="text-green-600" />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bank interest cost</span>
            <AmountDisplay value={s.facilityRepayment} className="text-red-600" />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Penalty income</span>
            <AmountDisplay value={s.penaltyIncome} className="text-green-600" />
          </div>
          <Separator />
          <div className="flex justify-between font-semibold">
            <span>Net profit</span>
            <AmountDisplay value={s.netProfit} className="text-green-700 font-bold" />
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            VAT (18%) on the discount fee and WHT (6%) on the supplier payment will be calculated.
            This record cannot be modified after booking.
            <span className="block mt-2 font-medium text-foreground">
              Booking here is what updates Net Profit on the P&L report.
            </span>
          </p>
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={showConfirm === 'close'}
        onOpenChange={(open) => { if (!open) setShowConfirm(null); }}
        title="Close Settlement"
        description={`Administrative close for ${s.invoiceNumber}. Profit has already been recognised on the P&L.`}
        confirmLabel="Close Settlement"
        onConfirm={async () => { await closeSettlement.mutateAsync(id!); setShowConfirm(null); }}
        isLoading={closeSettlement.isPending}
      >
        <div className="rounded-lg border bg-secondary/30 p-4 space-y-2 text-sm my-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice</span>
            <span className="font-mono font-medium">{s.invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Supplier</span>
            <span className="font-medium">{s.supplierName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Final profit</span>
            <AmountDisplay value={s.netProfit} className="text-green-700 font-bold" />
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            The supplier will be notified. The audit trail will be sealed with 7-year retention.
            Management sign-off is recorded.
            <span className="block mt-2 italic">
              This step does not change P&L totals — net profit was recognised at Book Profit.
            </span>
          </p>
        </div>
      </ConfirmationDialog>
    </div>
  );
}

export default SettlementDetailPage;
