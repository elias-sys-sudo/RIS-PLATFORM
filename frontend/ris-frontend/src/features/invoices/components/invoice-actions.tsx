import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  CheckCircle,
  BarChart3,
  DollarSign,
  Landmark,
  Loader2,
  AlertTriangle,
  Clock,
  UserX,
  ArrowRight,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuthStore } from '@/store/auth.store';
import { INVOICE_STATUS_LABELS } from '@/lib/constants';
import type { InvoiceStatus, Role } from '@/lib/constants';
import type { Invoice } from '@/types/invoice.types';
import {
  useConfirmBuyer,
  useRunRiskScoring,
  useGeneratePricing,
  useApproveInvoice,
  useRejectInvoice,
  useMarkFunded,
} from '../hooks/use-invoices';

// ── Types ────────────────────────────────────────────────────────────────────

interface InvoiceActionsProps {
  invoiceId: string;
  status: InvoiceStatus;
  invoiceNumber: string;
  invoice: Invoice;
}

interface ActionConfig {
  label: string;
  description: string;
  nextStep: string;
  roles: Role[];
  icon: React.ReactNode;
  variant: 'default' | 'destructive' | 'outline';
  needsConfirmation: boolean;
  confirmTitle?: string;
  confirmDescription?: string;
  /** When true, comment textarea is shown and required before confirm */
  commentRequired?: boolean;
}

// ── Action definitions per status ────────────────────────────────────────────

function getActionsForStatus(status: InvoiceStatus): ActionConfig[] {
  switch (status) {
    case 'submitted': {
      return [
        {
          label: 'Confirm Buyer',
          description:
            'Send a confirmation email to the buyer with a magic link. The invoice advances to risk scoring once the buyer clicks the link.',
          nextStep: 'After the buyer confirms via email, the invoice will proceed to risk scoring.',
          roles: ['credit_officer'],
          icon: <CheckCircle className="size-4" />,
          variant: 'default',
          needsConfirmation: true,
          confirmTitle: 'Send Confirmation Email',
          confirmDescription:
            "This sends a magic-link email to the buyer's registered contact address. The invoice stays in submitted status until the buyer clicks the link and submits the 4-way confirmation form.",
        },
      ];
    }

    case 'buyer_confirmed':
      return [
        {
          label: 'Run Risk Scoring',
          description:
            'Execute the risk engine to calculate a composite risk score for this invoice.',
          nextStep: 'After scoring, the invoice will be ready for pricing.',
          roles: ['credit_officer', 'finance_manager'],
          icon: <BarChart3 className="size-4" />,
          variant: 'default',
          needsConfirmation: false,
        },
      ];

    case 'scored':
      return [
        {
          label: 'Generate Pricing',
          description: 'Calculate the discount rate and advance amount based on the risk score.',
          nextStep: 'After pricing, the supplier will be able to accept or reject the offer.',
          roles: ['credit_officer', 'finance_manager'],
          icon: <DollarSign className="size-4" />,
          variant: 'default',
          needsConfirmation: false,
        },
      ];

    case 'priced':
      // Supplier accept/dispute/decline are rendered by PricingBreakdownCard
      // (POST /invoices/:id/pricing/{accept,reject,dispute}, supplier role).
      // Credit officer / management advance the invoice to `approved` by
      // calling POST /invoices/:id/approve (or the /approvals/:id/approve
      // facade route). Backend Joi requires `comments` (min 20 chars), so
      // both actions have commentRequired:true.
      return [
        {
          label: 'Approve Invoice',
          description: 'Approve this priced invoice for payment processing.',
          nextStep:
            'After approval, the invoice enters the dual-authorisation queue (finance team).',
          roles: ['credit_officer', 'management'],
          icon: <CheckCircle className="size-4" />,
          variant: 'default',
          needsConfirmation: true,
          confirmTitle: 'Approve Invoice',
          confirmDescription:
            'Confirm approval. Provide a brief justification (min 20 chars). This is recorded in the audit log.',
          commentRequired: true,
        },
        {
          label: 'Reject Invoice',
          description: 'Reject this invoice. The supplier will be notified.',
          nextStep: 'The invoice will be marked as rejected and cannot be re-submitted.',
          roles: ['credit_officer', 'management'],
          icon: <UserX className="size-4" />,
          variant: 'destructive',
          needsConfirmation: true,
          confirmTitle: 'Reject Invoice',
          confirmDescription:
            'Provide a rejection reason (min 20 chars). The supplier will see this.',
          commentRequired: true,
        },
      ];

    // For approved → pending_first_auth → pending_second_auth → executing,
    // all live actions belong to the payments module (POST /payments/:id/...).
    // The invoice page previously called POST /invoices/:id/authorise etc,
    // which only exist in MSW mocks — real backend 404s. We surface a single
    // navigation action here that sends finance_manager to /payments where
    // the wired-up buttons live.
    case 'approved':
      return [
        {
          label: 'Open in Payments Queue',
          description:
            'This invoice is awaiting first authorisation. The dual-auth controls live on the Payments page.',
          nextStep: 'Open the Payments queue to grant the first authorisation.',
          roles: ['finance_manager', 'management'],
          icon: <ArrowRight className="size-4" />,
          variant: 'default',
          needsConfirmation: false,
        },
      ];

    case 'pending_first_auth':
      return [
        {
          label: 'Open in Payments Queue',
          description:
            'First authorisation recorded. A different finance manager must now sign as second authoriser.',
          nextStep:
            'Open the Payments queue to grant the second authorisation (must be a different user).',
          roles: ['finance_manager', 'management'],
          icon: <ArrowRight className="size-4" />,
          variant: 'default',
          needsConfirmation: false,
        },
      ];

    case 'pending_second_auth':
      return [
        {
          label: 'Open in Payments Queue',
          description: 'Both authorisations recorded. The payment is ready to execute.',
          nextStep:
            'Open the Payments queue to execute the disbursement via the selected provider.',
          roles: ['finance_manager', 'management'],
          icon: <ArrowRight className="size-4" />,
          variant: 'default',
          needsConfirmation: false,
        },
      ];

    case 'executing':
      return [
        {
          label: 'Mark as Funded',
          description: 'Confirm that the payment has been successfully disbursed to the supplier.',
          nextStep: 'The invoice will move to the collections phase.',
          roles: ['finance_manager'],
          icon: <Landmark className="size-4" />,
          variant: 'default',
          needsConfirmation: true,
          confirmTitle: 'Mark as Funded',
          confirmDescription:
            'Confirm that the supplier has received the disbursement. The invoice will enter the collections period.',
        },
      ];

    default:
      return [];
  }
}

// ── Confirm-Buyer resend tracking ────────────────────────────────────────────
//
// Every backend call to POST /invoices/:id/confirm-buyer regenerates the
// magic-link token and invalidates the previous email's link (replay-attack
// guard). If a credit officer clicks the button multiple times in quick
// succession, only the LAST email is usable — the buyer lands on
// "verification link expired or invalid" if they click any earlier link.
//
// We track the last successful send in sessionStorage (UI hint only, not a
// security token, no PII) so the UI can:
//   1. Re-label the button to "Resend confirmation email" within 60 minutes
//   2. Surface an AlertDialog warning that resending invalidates the prior link
//
// After 60 minutes we assume the previous email is stale and revert to the
// default "Confirm Buyer" flow (no extra confirmation).
const CONFIRM_BUYER_STORAGE_PREFIX = 'ris.confirm-buyer.sent.';
const CONFIRM_BUYER_WINDOW_MS = 60 * 60 * 1000;

function confirmBuyerStorageKey(invoiceId: string): string {
  return `${CONFIRM_BUYER_STORAGE_PREFIX}${invoiceId}`;
}

function readLastConfirmBuyerSentAt(invoiceId: string): Date | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(confirmBuyerStorageKey(invoiceId));
    if (raw === null || raw === '') return null;
    const ts = new Date(raw);
    if (Number.isNaN(ts.getTime())) return null;
    return ts;
  } catch {
    // sessionStorage may throw in some sandboxed contexts — fall back to no
    // tracking rather than blocking the action.
    return null;
  }
}

function writeLastConfirmBuyerSentAt(invoiceId: string, when: Date): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(confirmBuyerStorageKey(invoiceId), when.toISOString());
  } catch {
    // Ignore — tracking is best-effort UX.
  }
}

function isWithinResendWindow(sentAt: Date | null, now: number): boolean {
  if (sentAt === null) return false;
  return now - sentAt.getTime() < CONFIRM_BUYER_WINDOW_MS;
}

// ── 72-hour SLA helper ──────────────────────────────────────────────────────

function getSlaInfo(invoice: Invoice): { hoursRemaining: number; isBreached: boolean } | null {
  // SLA starts from when invoice was approved (entered auth flow)
  const slaStart = invoice.approvedAt ?? invoice.updatedAt;
  if (!slaStart) return null;

  const authStatuses: InvoiceStatus[] = [
    'approved',
    'pending_first_auth',
    'pending_second_auth',
    'executing',
  ];
  if (!authStatuses.includes(invoice.status)) return null;

  const elapsed = Date.now() - new Date(slaStart).getTime();
  const slaMs = 72 * 60 * 60 * 1000;
  const remaining = slaMs - elapsed;
  return {
    hoursRemaining: Math.max(0, Math.floor(remaining / (60 * 60 * 1000))),
    isBreached: remaining <= 0,
  };
}

// ── Confirm-Buyer button (with resend guard) ────────────────────────────────

interface ConfirmBuyerButtonProps {
  invoiceId: string;
}

function ConfirmBuyerButton({ invoiceId }: ConfirmBuyerButtonProps): React.ReactElement {
  const confirmBuyer = useConfirmBuyer();
  const [lastSentAt, setLastSentAt] = useState<Date | null>(() =>
    readLastConfirmBuyerSentAt(invoiceId),
  );
  // Reset state when navigating between invoices (component is reused by id).
  useEffect(() => {
    setLastSentAt(readLastConfirmBuyerSentAt(invoiceId));
  }, [invoiceId]);

  // Tick once a minute so "Resent 3 minutes ago" stays fresh and so the button
  // automatically reverts to the default flow once the 60-min window closes.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const inResendWindow = isWithinResendWindow(lastSentAt, now);
  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  const [firstSendDialogOpen, setFirstSendDialogOpen] = useState(false);

  const fireMutation = useCallback((): void => {
    const sendAt = new Date();
    confirmBuyer.mutate(invoiceId, {
      onSuccess: () => {
        writeLastConfirmBuyerSentAt(invoiceId, sendAt);
        setLastSentAt(sendAt);
        // The mutation hook already shows a generic success toast; this
        // optimistic note specifically warns the operator about the
        // latest-email-only rule when this was a resend.
        if (inResendWindow) {
          toast.success('Resent — buyer must click the LATEST email');
        }
      },
    });
    setResendDialogOpen(false);
    setFirstSendDialogOpen(false);
  }, [confirmBuyer, invoiceId, inResendWindow]);

  const isPending = confirmBuyer.isPending;
  const label = inResendWindow ? 'Resend confirmation email' : 'Confirm Buyer';
  const icon = isPending ? (
    <Loader2 className="size-4 animate-spin" />
  ) : inResendWindow ? (
    <Send className="size-4" />
  ) : (
    <CheckCircle className="size-4" />
  );

  const relativeSent =
    lastSentAt !== null
      ? formatDistanceToNow(lastSentAt, { addSuffix: false })
      : null;
  const warningText =
    relativeSent !== null
      ? `An email was sent ${relativeSent} ago. Resending will invalidate the link in the previous email — the buyer must click the LATEST email's link.`
      : '';

  // Resend mode: guard with an AlertDialog that explains the token-invalidation
  // semantics before firing the mutation.
  if (inResendWindow) {
    return (
      <div className="flex flex-col items-end gap-2">
        <AlertDialog open={resendDialogOpen} onOpenChange={setResendDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={isPending}>
              {icon}
              {label}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Invalidate previous link?</AlertDialogTitle>
              <AlertDialogDescription>{warningText}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={(e) => {
                  // Prevent the default close-before-mutate behaviour so the
                  // pending state remains visible until the request resolves.
                  e.preventDefault();
                  fireMutation();
                }}
                disabled={isPending}
              >
                {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Resend (invalidate old link)
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="max-w-xs text-right text-xs text-amber-700">{warningText}</p>
      </div>
    );
  }

  // Default first-send flow: keep the original confirmation Dialog so the
  // operator still gets a clear "this triggers a magic-link email" prompt.
  return (
    <Dialog open={firstSendDialogOpen} onOpenChange={setFirstSendDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="default" disabled={isPending}>
          {icon}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send Confirmation Email</DialogTitle>
          <DialogDescription>
            This sends a magic-link email to the buyer&apos;s registered contact address. The
            invoice stays in submitted status until the buyer clicks the link and submits the
            4-way confirmation form.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setFirstSendDialogOpen(false)}>
            Cancel
          </Button>
          <Button onClick={fireMutation} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Confirm Buyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Action Button (with optional confirmation dialog) ────────────────────────

interface ActionButtonProps {
  action: ActionConfig;
  invoiceId: string;
  invoiceNumber: string;
  invoice: Invoice;
}

function ActionButton({
  action,
  invoiceId,
  invoiceNumber,
  invoice,
}: ActionButtonProps): React.ReactElement {
  // The "Confirm Buyer" action has its own dedicated UI that guards against
  // accidentally invalidating the prior email's magic-link token. See
  // ConfirmBuyerButton for the resend-window logic. We early-return BEFORE any
  // hook is called: each ActionButton instance renders one specific action, so
  // a given instance always takes the same branch and the rules of hooks hold.
  if (action.label === 'Confirm Buyer') {
    return <ConfirmBuyerButton invoiceId={invoiceId} />;
  }

  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? '';
  const userName = user?.name ?? '';
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [comment, setComment] = useState('');

  // Hooks — all must be called unconditionally
  const confirmBuyer = useConfirmBuyer();
  const runScoring = useRunRiskScoring();
  const generatePricing = useGeneratePricing();
  const approve = useApproveInvoice();
  const reject = useRejectInvoice();
  const funded = useMarkFunded();

  const trimmedComment = comment.trim() || undefined;
  // Suppress unused-var warnings for fields still threaded through props for
  // legacy actions. userId/userName were used by authFirst/authSecond which now
  // route through /payments instead.
  void userId;
  void userName;

  function handleAction(): void {
    switch (action.label) {
      case 'Confirm Buyer':
        confirmBuyer.mutate(invoiceId);
        break;
      case 'Run Risk Scoring':
        runScoring.mutate(invoiceId);
        break;
      case 'Generate Pricing':
        generatePricing.mutate(invoiceId);
        break;
      case 'Approve Invoice':
        approve.mutate({ id: invoiceId, comments: trimmedComment ?? '' });
        break;
      case 'Reject Invoice':
        reject.mutate({ id: invoiceId, comments: trimmedComment ?? '' });
        break;
      case 'Open in Payments Queue':
        // approved / pending_first_auth / pending_second_auth all need to
        // happen on /payments where the dual-auth + execute buttons are wired
        // to the real POST /payments/:id/* endpoints. The matching invoice-
        // module endpoints only exist in MSW mocks and 404 in real backends.
        navigate('/payments');
        break;
      case 'Mark as Funded':
        funded.mutate(invoiceId);
        break;
    }
    setDialogOpen(false);
    setComment('');
  }

  // Check if this is a dual-auth action where same-user is blocked
  const isSameUserBlocked =
    action.label === 'Second Authorisation' && invoice.dualAuthUser1Id === userId;

  const isPending =
    confirmBuyer.isPending ||
    runScoring.isPending ||
    generatePricing.isPending ||
    approve.isPending ||
    reject.isPending ||
    funded.isPending;

  const buttonContent = (
    <>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : action.icon}
      {action.label}
    </>
  );

  // Same-user blocked — show disabled button with explanation
  if (isSameUserBlocked) {
    return (
      <Button variant="outline" disabled className="opacity-60">
        <UserX className="size-4" />
        Blocked — Same User
      </Button>
    );
  }

  // Actions that need a confirmation dialog (with optional or required comment)
  const isAuthAction = ['Authorise Payment', 'Second Authorisation', 'Execute Payment'].includes(
    action.label,
  );
  const showComment = isAuthAction || action.commentRequired;
  const confirmDisabled = action.commentRequired && !comment.trim();

  if (action.needsConfirmation) {
    return (
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setComment('');
        }}
      >
        <DialogTrigger asChild>
          <Button variant={action.variant} disabled={isPending}>
            {buttonContent}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{action.confirmTitle}</DialogTitle>
            <DialogDescription>
              {action.confirmDescription} Invoice: <strong>{invoiceNumber}</strong>
            </DialogDescription>
          </DialogHeader>

          {showComment && (
            <div className="space-y-1.5 py-1">
              <Label htmlFor="auth-comment" className="text-sm">
                {action.commentRequired ? 'Reason (required)' : 'Add a note (optional)'}
              </Label>
              <Textarea
                id="auth-comment"
                rows={3}
                placeholder={
                  action.commentRequired
                    ? 'Please provide a reason for this decision...'
                    : 'e.g. Verified liquidity, confirmed delivery...'
                }
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                setComment('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant={action.variant === 'destructive' ? 'destructive' : 'default'}
              onClick={handleAction}
              disabled={isPending || confirmDisabled}
            >
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {action.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Button variant={action.variant} onClick={handleAction} disabled={isPending}>
      {buttonContent}
    </Button>
  );
}

// ── Dual-auth status panel ──────────────────────────────────────────────────

function DualAuthPanel({ invoice }: { invoice: Invoice }): React.ReactElement | null {
  const authStatuses: InvoiceStatus[] = [
    'pending_first_auth',
    'pending_second_auth',
    'executing',
    'funded',
  ];
  if (!authStatuses.includes(invoice.status)) return null;

  const sla = getSlaInfo(invoice);

  return (
    <Card className="border-l-4 border-l-indigo-500">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Dual Authorisation Status</p>
          {sla && !sla.isBreached && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" />
              72h SLA: {sla.hoursRemaining}h remaining
            </span>
          )}
          {sla?.isBreached && (
            <span className="flex items-center gap-1 text-xs text-destructive font-medium">
              <AlertTriangle className="size-3" />
              72h SLA BREACHED
            </span>
          )}
        </div>

        {/* Auth 1 */}
        <div className="flex items-center gap-3">
          <div
            className={`h-3 w-3 rounded-full ${invoice.dualAuthUser1Id ? 'bg-green-500' : 'bg-gray-300'}`}
          />
          <div className="flex-1">
            <p className="text-sm">First Authorisation</p>
            {invoice.dualAuthUser1Id ? (
              <p className="text-xs text-muted-foreground">
                Signed by <strong>{invoice.dualAuthUser1Name}</strong>
                {invoice.dualAuthUser1At &&
                  ` at ${new Date(invoice.dualAuthUser1At).toLocaleString()}`}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Pending — awaiting finance officer</p>
            )}
          </div>
        </div>

        {/* Auth 2 */}
        <div className="flex items-center gap-3">
          <div
            className={`h-3 w-3 rounded-full ${invoice.dualAuthUser2Id ? 'bg-green-500' : 'bg-gray-300'}`}
          />
          <div className="flex-1">
            <p className="text-sm">Second Authorisation</p>
            {invoice.dualAuthUser2Id ? (
              <p className="text-xs text-muted-foreground">
                Signed by <strong>{invoice.dualAuthUser2Name}</strong>
                {invoice.dualAuthUser2At &&
                  ` at ${new Date(invoice.dualAuthUser2At).toLocaleString()}`}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Pending — requires a <strong>different</strong> finance officer
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Same-user warning banner ────────────────────────────────────────────────

function SameUserWarning({ invoice }: { invoice: Invoice }): React.ReactElement | null {
  const user = useAuthStore((s) => s.user);
  if (invoice.status !== 'pending_first_auth') return null;
  if (invoice.dualAuthUser1Id !== user?.id) return null;

  return (
    <Card className="border-l-4 border-l-amber-500 bg-amber-50">
      <CardContent className="flex items-start gap-3 p-4">
        <UserX className="size-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-amber-900">You signed the first authorisation</p>
          <p className="text-xs text-amber-700">
            Dual authorisation requires two different finance officers. Please log in as a different
            finance officer to complete the second authorisation.
          </p>
          <p className="text-xs text-amber-600 font-mono mt-1">
            Login: finance2@ris.ug / Finance2@1234
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function InvoiceActions({
  invoiceId,
  status,
  invoiceNumber,
  invoice,
}: InvoiceActionsProps): React.ReactElement | null {
  const role = useAuthStore((s) => s.role);
  const actions = getActionsForStatus(status);

  if (actions.length === 0) {
    return null;
  }

  // Filter to actions the current user's role can perform
  const availableActions = actions.filter((a) => role !== null && a.roles.includes(role));
  // Actions the user cannot perform (show as informational)
  const blockedActions = actions.filter((a) => role === null || !a.roles.includes(role));

  if (availableActions.length === 0 && blockedActions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Dual-auth status panel with SLA */}
      <DualAuthPanel invoice={invoice} />

      {/* Same-user warning banner */}
      <SameUserWarning invoice={invoice} />

      {/* Actions the current user CAN perform */}
      {availableActions.map((action) => (
        <Card key={action.label} className="border-l-4 border-l-green-500">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">{action.description}</p>
              <p className="text-xs text-muted-foreground">Next step: {action.nextStep}</p>
            </div>
            <ActionButton
              action={action}
              invoiceId={invoiceId}
              invoiceNumber={invoiceNumber}
              invoice={invoice}
            />
          </CardContent>
        </Card>
      ))}

      {/* Actions waiting on another role */}
      {availableActions.length === 0 && blockedActions.length > 0 && (
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">
                Status: {INVOICE_STATUS_LABELS[status] ?? status}
              </p>
              <p className="text-xs text-muted-foreground">
                Waiting for {blockedActions[0].roles.map((r) => r.replace(/_/g, ' ')).join(' or ')}{' '}
                to {blockedActions[0].label.toLowerCase()}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default InvoiceActions;
