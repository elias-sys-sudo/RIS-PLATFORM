import { http, HttpResponse, delay } from 'msw';
import { MOCK_INVOICES } from './invoice.handlers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PaymentRecord {
  id: string;
  invoice_id: string;
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  amount: string;
  provider: 'MTN_MOMO' | 'AIRTEL' | 'EFT';
  status: string;
  dual_auth_user_1: string | null;
  dual_auth_user_1_name: string | null;
  dual_auth_user_2: string | null;
  dual_auth_user_2_name: string | null;
  transaction_reference: string | null;
  funded_at: string | null;
  failure_reason: string | null;
  created_at: string;
  sla_deadline: string;
}

/* ------------------------------------------------------------------ */
/*  Provider assignment (round-robin for demo)                        */
/* ------------------------------------------------------------------ */

const PROVIDERS: Array<'MTN_MOMO' | 'AIRTEL' | 'EFT'> = ['MTN_MOMO', 'AIRTEL', 'EFT'];
let providerIdx = 0;

function pickProvider(): 'MTN_MOMO' | 'AIRTEL' | 'EFT' {
  const p = PROVIDERS[providerIdx % PROVIDERS.length];
  providerIdx++;
  return p;
}

/* ------------------------------------------------------------------ */
/*  Build payment records dynamically from invoice store              */
/* ------------------------------------------------------------------ */

/**
 * Statuses that should appear in the Payments queue.
 * approved           → ready for 1st auth
 * pending_first_auth → 1st auth done, waiting on 2nd
 * pending_second_auth→ both auths done, ready to execute
 * executing          → payment in progress
 * funded             → completed (show in history)
 */
const PAYMENT_STATUSES = [
  'approved',
  'pending_first_auth',
  'pending_second_auth',
  'executing',
  'funded',
];

/** Map invoice status to a payment-specific status label */
function invoiceToPaymentStatus(invoiceStatus: string): string {
  const map: Record<string, string> = {
    approved: 'pending_first_auth',
    pending_first_auth: 'pending_first_auth',
    pending_second_auth: 'pending_second_auth',
    executing: 'executing',
    funded: 'funded',
  };
  return map[invoiceStatus] ?? invoiceStatus;
}

function buildPaymentFromInvoice(inv: typeof MOCK_INVOICES[number]): PaymentRecord {
  const paymentStatus = invoiceToPaymentStatus(inv.status);

  return {
    id: `pay_${inv.id}`,
    invoice_id: inv.id,
    invoice_number: inv.invoiceNumber,
    supplier_name: inv.supplierName,
    buyer_name: inv.buyerName,
    amount: String(inv.advanceAmount),
    provider: pickProvider(),
    status: paymentStatus,
    dual_auth_user_1: inv.dualAuthUser1Id ?? null,
    dual_auth_user_1_name: inv.dualAuthUser1Name ?? null,
    dual_auth_user_2: inv.dualAuthUser2Id ?? null,
    dual_auth_user_2_name: inv.dualAuthUser2Name ?? null,
    transaction_reference: inv.status === 'funded' ? `MTN-TXN-${Date.now()}` : null,
    funded_at: inv.fundedAt,
    failure_reason: null,
    created_at: inv.approvedAt ?? inv.updatedAt,
    sla_deadline: new Date(new Date(inv.approvedAt ?? inv.updatedAt).getTime() + 72 * 60 * 60 * 1000).toISOString(),
  };
}

function getPaymentRecords(): PaymentRecord[] {
  // Reset provider index for consistent assignment
  providerIdx = 0;
  return MOCK_INVOICES
    .filter((inv) => PAYMENT_STATUSES.includes(inv.status))
    .map(buildPaymentFromInvoice);
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                           */
/* ------------------------------------------------------------------ */

export const paymentsHandlers = [
  /** GET /api/payments/pending — list payment queue (dynamically from invoices) */
  http.get('/api/payments/pending', async () => {
    await delay(250);
    const records = getPaymentRecords();
    return HttpResponse.json({ data: records });
  }),

  /** GET /api/payments/:id — payment detail */
  http.get('/api/payments/:id', async ({ params }) => {
    await delay(200);
    const records = getPaymentRecords();
    const payment = records.find((p) => p.id === params.id);
    if (!payment) {
      return HttpResponse.json({ message: 'Payment not found' }, { status: 404 });
    }
    return HttpResponse.json({ data: payment });
  }),

  /** POST /api/payments/:id/authorise — dual-auth step */
  http.post('/api/payments/:id/authorise', async ({ params }) => {
    await delay(400);
    const records = getPaymentRecords();
    const payment = records.find((p) => p.id === params.id);
    if (!payment) {
      return HttpResponse.json({ message: 'Payment not found' }, { status: 404 });
    }

    // Find the linked invoice and update its status directly
    const invoiceId = payment.invoice_id;
    const idx = MOCK_INVOICES.findIndex((inv) => inv.id === invoiceId);
    if (idx === -1) {
      return HttpResponse.json({ message: 'Linked invoice not found' }, { status: 404 });
    }

    const inv = MOCK_INVOICES[idx];
    const currentUserId = 'usr_001';

    if (inv.status === 'approved' || inv.status === 'pending_first_auth') {
      // 1st auth → advance to pending_second_auth
      MOCK_INVOICES[idx] = { ...inv, status: 'pending_second_auth' as typeof inv.status, updatedAt: new Date().toISOString() };
      const updated = buildPaymentFromInvoice(MOCK_INVOICES[idx]);
      updated.dual_auth_user_1 = currentUserId;
      updated.dual_auth_user_1_name = 'Admin User';
      return HttpResponse.json({ data: updated });
    }

    if (inv.status === 'pending_second_auth') {
      // 2nd auth → advance to executing, then auto-fund after delay
      MOCK_INVOICES[idx] = { ...inv, status: 'executing' as typeof inv.status, updatedAt: new Date().toISOString() };

      // Simulate async funding
      setTimeout(() => {
        MOCK_INVOICES[idx] = {
          ...MOCK_INVOICES[idx],
          status: 'funded' as typeof inv.status,
          fundedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }, 2000);

      const updated = buildPaymentFromInvoice(MOCK_INVOICES[idx]);
      return HttpResponse.json({ data: updated });
    }

    return HttpResponse.json(
      { message: `Payment cannot be authorised in status: ${payment.status}` },
      { status: 422 },
    );
  }),
];
