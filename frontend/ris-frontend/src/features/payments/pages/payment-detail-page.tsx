import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, ShieldCheck, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AmountDisplay } from '@/components/display/amount-display';
import { SlaCountdown } from '@/components/display/sla-countdown';
import { PaymentStatusBadge } from '@/components/display/status-badge';
import { AuthUrgencyBanner } from '../components/auth-urgency-banner';
import { usePaymentDetail, useAuthorisePayment } from '../hooks/use-payments';
import { formatAbsolute } from '@/lib/format-date';
import { formatUGX } from '@/lib/format-ugx';
import { useAuthStore } from '@/store/auth.store';
import { DualAuthBadge } from '@/components/display/dual-auth-badge';
import { StepUpAuthDialog } from '@/components/overlays/step-up-auth-dialog';

export function PaymentDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: payment, isLoading } = usePaymentDetail(id ?? '');
  const authorise = useAuthorisePayment();
  const currentUser = useAuthStore((s) => s.user);
  const [showAuth, setShowAuth] = useState(false);
  const [showStepUp, setShowStepUp] = useState(false);
  const [authComment, setAuthComment] = useState('');

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (!payment) {
    return <div className="py-20 text-center text-muted-foreground">Payment not found.</div>;
  }

  const canAuthorise =
    (payment.status === 'pending_first_auth' || payment.status === 'pending_second_auth') &&
    payment.dualAuthUser1 !== currentUser?.id;

  const authStep =
    payment.status === 'pending_first_auth' ? 'first' : 'second';

  function openAuthDialog(): void {
    setAuthComment('');
    setShowAuth(true);
  }

  async function handleAuthorise(): Promise<void> {
    await authorise.mutateAsync({ id: id!, comment: authComment });
    setShowAuth(false);
    setAuthComment('');
    navigate('/payments');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/payments')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold font-mono">{payment.id.slice(0, 12)}...</h1>
            <PaymentStatusBadge status={payment.status} />
          </div>
        </div>
        {canAuthorise && (
          <Button onClick={openAuthDialog}>
            <ShieldCheck className="mr-2 size-4" /> Authorize Payment
          </Button>
        )}
      </div>

      {/* Urgency banner — shown when this payment needs the current user's auth */}
      {currentUser && (
        <AuthUrgencyBanner
          paymentStatus={payment.status}
          dualAuthUser1={payment.dualAuthUser1}
          currentUserId={currentUser.id}
          slaStartedAt={payment.createdAt}
        />
      )}

      {/* SLA */}
      {(payment.status === 'pending_first_auth' || payment.status === 'pending_second_auth') && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">72h Payment SLA:</span>
          <SlaCountdown startedAt={payment.createdAt} slaHours={72} />
        </div>
      )}

      {/* Payment info */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Amount</p><AmountDisplay value={payment.amount} className="text-xl font-bold" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Provider</p><p className="text-sm font-medium">{payment.provider}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Invoice</p><p className="text-sm font-mono">{payment.invoiceId.slice(0, 12)}...</p></CardContent></Card>
      </div>

      {/* Dual-auth status */}
      <DualAuthBadge
        firstAuth={payment.dualAuthUser1 ? { role: 'Finance Manager', authorizedAt: payment.createdAt } : undefined}
        secondAuth={payment.dualAuthUser2 ? { role: 'Finance Manager', authorizedAt: payment.fundedAt ?? payment.createdAt } : undefined}
        className="mb-2"
      />
      {payment.dualAuthUser1 === currentUser?.id && payment.status === 'pending_second_auth' && (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5 mb-4">
          <Info className="size-4" />
          You authorized the first step. A different finance manager must complete the second.
        </p>
      )}

      {/* Dual-auth timeline */}
      <Card>
        <CardHeader><CardTitle className="text-base">Authorization Timeline</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${payment.dualAuthUser1 ? 'bg-green-500' : 'bg-gray-300'}`} />
            <div className="flex-1">
              <p className="text-sm font-medium">First Authorization</p>
              {payment.dualAuthUser1
                ? <p className="text-xs text-muted-foreground">Authorized by {payment.dualAuthUser1.slice(0, 8)}...</p>
                : <p className="text-xs text-muted-foreground">Pending</p>
              }
            </div>
            {payment.dualAuthUser1 && <Badge variant="outline" className="text-green-700">Done</Badge>}
          </div>
          <Separator />
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${payment.dualAuthUser2 ? 'bg-green-500' : 'bg-gray-300'}`} />
            <div className="flex-1">
              <p className="text-sm font-medium">Second Authorization</p>
              {payment.dualAuthUser2
                ? <p className="text-xs text-muted-foreground">Authorized by {payment.dualAuthUser2.slice(0, 8)}...</p>
                : <p className="text-xs text-muted-foreground">Pending — requires a different user</p>
              }
            </div>
            {payment.dualAuthUser2 && <Badge variant="outline" className="text-green-700">Done</Badge>}
          </div>
        </CardContent>
      </Card>

      {/* References */}
      <Card>
        <CardHeader><CardTitle className="text-base">References</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Transaction Ref</span><span className="font-mono">{payment.transactionReference ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Funded At</span><span>{payment.fundedAt ? formatAbsolute(payment.fundedAt) : '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{formatAbsolute(payment.createdAt)}</span></div>
          {payment.failureReason && (
            <div className="flex justify-between"><span className="text-muted-foreground">Failure Reason</span><span className="text-destructive">{payment.failureReason}</span></div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showAuth}
        onOpenChange={(open) => {
          setShowAuth(open);
          if (!open) setAuthComment('');
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {authStep === 'first' ? 'First Authorisation' : 'Second Authorisation'}
            </DialogTitle>
            <DialogDescription>
              This will record your {authStep === 'first' ? 'first' : 'second'} authorisation
              for <strong>{formatUGX(payment.amount)}</strong> via {payment.provider}. This
              action involves real money and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-1">
            <Label htmlFor="payment-auth-comment" className="text-sm">
              Add a note (optional)
            </Label>
            <Textarea
              id="payment-auth-comment"
              rows={3}
              maxLength={1000}
              placeholder="e.g. Verified liquidity, confirmed delivery..."
              value={authComment}
              onChange={(e) => setAuthComment(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Recorded in the audit log alongside your authorisation.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAuth(false);
                setAuthComment('');
              }}
              disabled={authorise.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleAuthorise} disabled={authorise.isPending}>
              {authorise.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Authorize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StepUpAuthDialog
        open={showStepUp}
        onOpenChange={setShowStepUp}
        onVerified={() => {
          setShowStepUp(false);
          setShowAuth(true);
        }}
        actionLabel="authorize this payment"
      />
    </div>
  );
}

export default PaymentDetailPage;
