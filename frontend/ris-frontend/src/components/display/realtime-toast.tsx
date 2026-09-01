import { toast } from 'sonner';
import type { Role } from '@/lib/constants';

// ── Event data shape from SSE ────────────────────────────────────────────────

interface SseEventData {
  type: string;
  invoiceRef?: string;
  paymentRef?: string;
  approvalId?: string;
  message?: string;
  [key: string]: unknown;
}

// ── Supplier-specific toasts ─────────────────────────────────────────────────

function showSupplierToast(data: SseEventData): void {
  const ref = data.invoiceRef ?? 'your invoice';
  switch (data.type) {
    case 'invoice:status_changed':
      toast.info(`Invoice ${ref} status updated.`);
      break;
    case 'payment:authorized':
      toast.success(`${ref} has been funded!`);
      break;
    case 'collection:payment_received':
      toast.success(`Payment received for ${ref}.`);
      break;
  }
}

// ── Credit officer toasts ────────────────────────────────────────────────────

function showCreditOfficerToast(data: SseEventData): void {
  switch (data.type) {
    case 'approval:new':
      toast.info('New approval request awaiting your review.');
      break;
    case 'invoice:status_changed':
      toast.info(`Invoice ${data.invoiceRef ?? ''} status changed.`);
      break;
  }
}

// ── Finance manager toasts ───────────────────────────────────────────────────

function showFinanceManagerToast(data: SseEventData): void {
  const ref = data.paymentRef ?? data.invoiceRef ?? '';
  switch (data.type) {
    case 'approval:new':
      toast.info('Approval completed -- payment awaiting authorisation.');
      break;
    case 'payment:authorized':
      toast.success(`Payment ${ref} authorised.`);
      break;
    case 'collection:payment_received':
      toast.success(`Collection received for ${data.invoiceRef ?? ''}.`);
      break;
  }
}

// ── SLA breach (all roles) ───────────────────────────────────────────────────

function showSlaBreachToast(data: SseEventData): void {
  toast.error(data.message ?? 'SLA breach warning -- immediate action required.', {
    duration: Infinity,
    action: {
      label: 'View Dashboard',
      onClick: () => {
        window.location.href = '/';
      },
    },
  });
}

// ── Dispatch map ─────────────────────────────────────────────────────────────

const ROLE_TOAST_HANDLERS: Record<string, (data: SseEventData) => void> = {
  supplier:           showSupplierToast,
  credit_officer:     showCreditOfficerToast,
  finance_manager:    showFinanceManagerToast,
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Show a role-aware toast notification for an SSE event.
 * SLA breach events are shown to all roles as persistent error toasts.
 */
export function showRealtimeToast(
  eventType: string,
  data: Record<string, unknown>,
  role: Role | null,
): void {
  const sseData: SseEventData = { ...data, type: eventType };

  if (eventType === 'sla:breach_warning') {
    showSlaBreachToast(sseData);
    return;
  }

  if (!role) return;

  const handler = ROLE_TOAST_HANDLERS[role];
  if (handler) {
    handler(sseData);
    return;
  }

  // Management sees finance_manager toasts
  if (role === 'management') {
    showFinanceManagerToast(sseData);
  }
}
