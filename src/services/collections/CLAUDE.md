# collections/ — Repayment & Escalation Engine

## Bash commands

- `npm run test:unit -- --testPathPattern=tests/unit/collections --verbose`
- `npm run test:unit -- --coverage --collectCoverageFrom="src/services/collections/**/*.ts"`
- `grep -n "SAR_REVIEW_FLAGGED\|AML_FLAG" src/services/collections/collections.service.ts` — verify SAR trigger present

---

## Penalty Calculation — BigInt with PENALTY_PRECISION

```typescript
const PENALTY_PRECISION = 1_000_000n; // 6 decimal places for rate arithmetic
const DEFAULT_DAILY_PENALTY_RATE = '0.001'; // 0.1% per day — overridable per collection

// penalty = face_value × daily_rate × days_overdue
function calculatePenalty(faceValue: string, daysOverdue: number, dailyPenaltyRate: string): string {
  const fv = BigInt(faceValue);
  const days = BigInt(daysOverdue);

  // Parse rate string to scaled integer (handles "0.001" → 1000n out of 1_000_000n)
  const [intPart, fracPart = ''] = dailyPenaltyRate.split('.');
  const rateInt = BigInt(intPart) * PENALTY_PRECISION
                + BigInt(fracPart.padEnd(6, '0').slice(0, 6));

  const penalty = (fv * rateInt * days) / PENALTY_PRECISION;
  return penalty.toString();
}
```

❌ WRONG — floating point penalty:
```typescript
const penalty = parseFloat(faceValue) * 0.001 * daysOverdue; // loses precision on large UGX
```

---

## Escalation Level Map

```
Level 0  → none      (collecting, not yet overdue)
Level 1  → reminder  (T+1: invoice is overdue, first contact)
Level 2  → formal    (T+3: formal written notice, cc legal)
Level 3  → legal     (T+7: legal action initiated)
```

Trigger points from scheduled jobs:
- `T+1 day` → `processOverdueInvoice()` — sets invoice to `overdue`, creates collection record at level 1
- `T+3 days` → `escalateCollection()` — escalation_level 1 → 2
- `T+7 days` → `escalateCollection()` — escalation_level 2 → 3, triggers SAR review flag

❌ WRONG — manually setting escalation level without calling the escalation function:
```typescript
await repo.updateEscalationLevel(collectionId, 3); // skips SAR check, skips audit, skips notification
```

---

## SAR Review Flag — Triggered at Level 3

When escalation reaches level 3 AND `face_value >= AML_FLAG_THRESHOLD_UGX`:

```typescript
const AML_FLAG_THRESHOLD = BigInt(process.env.AML_FLAG_THRESHOLD_UGX ?? '100000000');

if (newLevel >= 3 && BigInt(collection.face_value) >= AML_FLAG_THRESHOLD) {
  await repo.flagForSarReview(client, collection.id);
  // Audit: action = 'SAR_REVIEW_FLAGGED'
  // Notify: compliance_officer via notificationQueue
}
```

`flagForSarReview()` sets `sar_review_required = true` on the collection record. The `compliance_officer` must then manually file the SAR with FIA Uganda and record the outcome in the system.

---

## Two Queues — Different Purposes

```typescript
let notificationQueue: Queue | null = null;       // SMS, email, WhatsApp to buyer/supplier
let facilityRepaymentQueue: Queue | null = null;  // triggers facility repayment when collection received

export function setNotificationQueue(queue: Queue): void { notificationQueue = queue; }
export function setFacilityRepaymentQueue(queue: Queue): void { facilityRepaymentQueue = queue; }
```

When a payment is received from a buyer:
1. Update collection to `collected`, invoice to `collected`
2. Queue `facilityRepaymentQueue` job — triggers `facilities` module to repay drawdown
3. Queue `notificationQueue` job — notify supplier and RIS operations

If `facilityRepaymentQueue` is null: log warn, proceed — collections record is still updated. Operations team handles facility repayment manually.

---

## Overdue Processing — Exact Workflow

```typescript
// processOverdueInvoice(invoiceId) — called by scheduled job
// 1. Fetch invoice (must be in 'funded' status)
// 2. Calculate penalty for day 1
// 3. BEGIN transaction:
//    a. INSERT into collections (status=overdue, escalation_level=1, penalty_amount)
//    b. UPDATE invoices SET status='overdue'  (from 'funded')
//    c. INSERT audit_log: action='INVOICE_OVERDUE'
// 4. COMMIT
// 5. Queue notification to buyer (outside transaction)
```

❌ WRONG — updating invoice status outside a transaction with collection INSERT:
```typescript
await repo.createCollection(invoiceId, penaltyAmount);
await repo.updateInvoiceStatus(invoiceId, 'overdue'); // if this fails, collection exists with wrong invoice status
```

---

## Full Recourse — RIS Can Claim from Supplier

If buyer defaults (collection reaches `defaulted` status):
1. Set collection → `defaulted`, invoice → `defaulted`
2. Audit: `INVOICE_DEFAULTED`
3. Queue notification to `finance_manager` and `management`
4. The `full_recourse` flag in the invoice enables RIS to invoice the SUPPLIER for the face value

The collections module does NOT automatically recover from suppliers — it flags the case. A `finance_manager` initiates recourse manually via the admin interface.

---

## Status Transitions This Module Owns

```
funded          → collecting    (payment expected, not yet received)
collecting      → overdue       (due date passed, no payment — T+1 job)
overdue         → collected     (buyer pays — recordPayment())
collecting      → collected     (buyer pays before overdue — recordPayment())
overdue         → defaulted     (legal action failed, write-off decision)
```
