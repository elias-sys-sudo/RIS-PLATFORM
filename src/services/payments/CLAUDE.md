# payments/ — Critical Rules & Templates

> This module moves real money. Every pattern here is a hard requirement, not a guideline.

## Bash commands

- `npm run test:unit -- --coverage --collectCoverageFrom="src/services/payments/**/*.ts"` — must reach 95%
- `npm run typecheck` — zero errors before any commit
- `grep -r "dual_auth_user" src/services/payments/` — verify both app + DB trigger checks exist

---

## Dual Authorisation — Three-Layer Enforcement

No disbursement fires unless TWO DIFFERENT `finance_manager` users have approved.

### Layer 1: Application (service layer)

```typescript
// payments.service.ts — second authorisation handler
if (payment.dualAuthUser1 === userId) {
  throw new BusinessRuleError(
    PaymentErrorCode.SAME_AUTHORISER,
    'Same user cannot provide both authorisations',
  );
}
await repo.setSecondAuthWithClient(client, paymentId, userId);
```

### Layer 2: Database Trigger (in migration)

```sql
CREATE OR REPLACE FUNCTION enforce_dual_auth_different_users()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.dual_auth_user_2 IS NOT NULL
     AND NEW.dual_auth_user_1 = NEW.dual_auth_user_2 THEN
    RAISE EXCEPTION 'dual_auth_user_1 and dual_auth_user_2 must be different users';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_dual_auth_check
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION enforce_dual_auth_different_users();
```

### Layer 3: Provider Callback

Status only advances to `funded` when the provider sends a success webhook. The application does NOT set `funded` status itself.

❌ WRONG — setting funded without provider confirmation:

```typescript
await repo.updateStatus(paymentId, PaymentStatus.FUNDED); // NEVER do this directly
```

---

## Provider Selection — payments.service.ts Only

Mobile-money providers (MTN MoMo, Airtel Money) were retired. Every supplier
advance is funded via EFT (bank ACH); the supplier's `preferred_payment_method`
is no longer consulted to choose a provider — `mapProvider()` returns
`PaymentProvider.EFT` unconditionally. Legacy supplier rows that still carry
`'MTN_MOMO'` / `'AIRTEL'` in `preferred_payment_method` (DB enum kept for
audit immutability) flow through the same EFT path, so old data does not
block disbursement.

```typescript
// payments.service.ts — current implementation
function mapProvider(_method: string): PaymentProvider {
  return PaymentProvider.EFT;
}
```

---

## Idempotency — Payment Initiation

Every payment create request must carry a client-generated `idempotencyKey`.

```typescript
// Before creating payment record
const existing = await repo.findByIdempotencyKey(idempotencyKey);
if (existing) {
  return existing; // return existing record, do NOT create duplicate
}

// Create payment with idempotency key stored
await repo.createPaymentWithClient(client, { ...data, idempotencyKey });
```

❌ WRONG — no idempotency check:

```typescript
await repo.createPayment(data); // network retry = double disbursement
```

---

## Webhook Security Checklist

There are no inbound provider webhooks while EFT is the only channel — the
bank confirms disbursements via batch reconciliation (and manual-confirm
endpoint). When a future provider webhook is added, every handler MUST:

1. Verify the HMAC signature against the raw request bytes (timing-safe).
2. Reject the request before parsing the body if the signature is invalid.
3. Idempotency-check `(provider, externalId)` via `repo.checkWebhookIdempotency`.
4. Persist the event row via `repo.recordWebhookEvent` BEFORE business
   processing — prevents double-handling on a crash between accept and apply.
5. Return `202 Accepted` immediately; do business work asynchronously via a
   queue.

The repo helpers (`checkWebhookIdempotency`, `recordWebhookEvent`,
`getPaymentByTransactionRef`) are kept in `payments.repository.ts` for that
future use — the audit table `webhook_events` is unchanged.

---

## External API Failure Protocol

When any provider call throws or returns an error status:

```typescript
try {
  await provider.initiate(disbursement);
} catch (err) {
  // 1. Set status to failed
  await repo.updateStatusWithClient(client, paymentId, PaymentStatus.FAILED);

  // 2. Audit log — log error CODE not message (message may contain PII)
  await repo.createAuditEntryWithClient(client, userId, 'PAYMENT_FAILED', 'payments', paymentId, {
    errorCode: (err as { code?: string }).code ?? 'UNKNOWN',
    provider: payment.provider,
  });

  // 3. Queue notification to finance_manager
  await notifyQueue.add(
    'payment_failed',
    { paymentId, provider: payment.provider },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );

  throw new PaymentError(PaymentErrorCode.PROVIDER_ERROR, 'Payment provider error');
}
```

After 3 BullMQ retries: escalate to manual intervention. Do NOT auto-retry beyond 3.

---

## AML Gate — Checked Before pending_first_auth

The payment AML guard reads three columns: `face_value`, `aml_flagged`,
`aml_cleared_at`. An over-threshold flagged invoice blocks disbursement
until a compliance officer has cleared it.

```typescript
function guardAmlCleared(invoice: {
  face_value: string;
  aml_flagged: boolean;
  aml_cleared_at: string | null;
}): void {
  const overThreshold = BigInt(invoice.face_value) >= AML_FLAG_THRESHOLD_UGX;
  const requiresClearance = overThreshold && invoice.aml_flagged;
  const isCleared = invoice.aml_cleared_at !== null;
  if (requiresClearance && !isCleared) {
    throw new BusinessRuleError(
      PaymentErrorCode.AML_FLAG_REQUIRED,
      'Invoice requires compliance clearance before payment',
    );
  }
}
```

Clearance is performed by `POST /admin/aml/clear/:id` (compliance_officer
only) — implemented in `services/compliance/aml-clearance.service.ts`.
Three columns are written atomically: `aml_cleared_at`, `aml_cleared_by`,
`aml_clearance_reason`. The DB CHECK constraint
`invoices_aml_clearance_complete` (migration 037) enforces that all three
are NULL together or all three NOT NULL together — there is no
half-cleared state.

Re-clearance is rejected. If `aml_cleared_at IS NOT NULL` the endpoint
throws `BusinessRuleError(ComplianceErrorCode.AML_ALREADY_CLEARED)`
(also surfaced as `PaymentErrorCode.AML_ALREADY_CLEARED` for clients
that observe the payment-side error code) — the original officer's
identity is regulatorily immutable per FIA 2013.

After clearance commits, a `notify-finance-manager-aml-cleared` job is
enqueued so the payment workflow can resume automatically.

---

## Status Transitions This Module Owns

```
approved            → pending_first_auth   (credit_officer initiates payment)
pending_first_auth  → pending_second_auth  (first finance_manager authorises)
pending_second_auth → executing            (second finance_manager authorises — different user enforced)
executing           → funded               (provider webhook success callback)
executing           → failed               (provider webhook failure OR timeout)
failed              → pending_first_auth   (finance_manager manual retry)
```

Never transition any other invoice/payment status from this module.

**`approved → pending_first_auth` — atomic with payment insert.** Performed
inside `createPaymentTxn` via `repo.updateInvoiceStatusWithClient`, guarded
by `WHERE id=$1 AND status='approved'`. A second worker that lost the race
finds zero rows updated; the helper logs a warn ("possible duplicate
payment row") but the transaction still COMMITs — the duplicate-payment
detection is left to a separate idempotency check at the start of
`initiatePayment` (`getPaymentByInvoiceId`).

## Worker Terminal Failure

When the BullMQ `process-payment` job exhausts `attempts: 3` retries the
worker's `'failed'` event fires with `job.attemptsMade >= job.opts.attempts`.
Routes-layer listener delegates to `handleTerminalWorkerFailure(invoiceId,
errorCode)` in this service — which writes an audit row
(`PAYMENT_INITIATION_FAILED`, table `invoices`, no PII) inside its own
transaction and enqueues a `payment_failed` notification to the
`finance_manager`. Backoff aligned to the platform standard
`{ attempts: 3, backoff: { type: 'exponential', delay: 30_000 } }`.

Operator triage: `GET /admin/approvals/orphans` (management +
finance_manager) lists invoices stuck in `'approved'` with no payment row
for >5 minutes.
