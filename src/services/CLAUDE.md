# src/services/ — Module Patterns

> Invoice status flow, role map, build order, and domain constants are in root CLAUDE.md.
> This file covers ONLY what root CLAUDE.md does not: per-module exceptions and cross-cutting service patterns.

---

## Module Build Order — Dependency Direction

Lower modules MAY import from higher modules. Never import downward.

```
1. auth
2. onboarding   → imports: auth
3. invoices     → imports: auth, onboarding
4. verification → imports: auth, invoices
5. risk-engine  → imports: auth, invoices, verification
6. pricing      → imports: auth, risk-engine
7. approvals    → imports: auth, pricing, risk-engine
8. payments     → imports: auth, approvals, notifications
9. collections  → imports: auth, payments, invoices
10. facilities  → imports: auth, payments
11. reporting   → imports: all modules (read-only)
```

---

## Status Transition Ownership

Each module OWNS specific transitions. Never transition a status from the wrong module.

| Transition | Owner Module |
|---|---|
| `draft → submitted` | invoices |
| `submitted → buyer_confirmed` | verification |
| `buyer_confirmed → scored / rejected` | risk-engine |
| `scored → priced` | pricing |
| `priced → approved / rejected` | approvals |
| `approved → pending_first_auth` | payments |
| `pending_first_auth → pending_second_auth` | payments |
| `pending_second_auth → executing` | payments |
| `executing → funded / failed` | payments (via provider callback) |
| `funded → collecting` | collections |
| `collecting → overdue` | collections (scheduled job) |
| `overdue / collecting → collected / defaulted` | collections |

❌ WRONG — collections module setting `approved` status:
```typescript
// collections.service.ts
await repo.updateStatus(invoiceId, 'approved'); // wrong module owns this
```

---

## Notification Pattern — Consistent Across All Modules

Every module that sends notifications follows this pattern:

```typescript
// At top of service file
let notificationQueue: Queue | null = null;
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// When dispatching
async function notifyUser(userId: string, type: string, payload: object): Promise<void> {
  if (!notificationQueue) {
    logger.warn(`${MODULE_NAME}: notification queue not configured`, { userId, type });
    return; // non-blocking — business logic already succeeded
  }
  await notificationQueue.add(type, { userId, ...payload }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  });
}
```

Modules that send notifications: `auth`, `onboarding`, `approvals`, `payments`, `collections`.

---

## Cross-Module Data Access — Repository Layer Only

A module must NEVER import another module's service. Import its repository for read-only lookups.

```typescript
// payments.service.ts ✅ CORRECT — read invoice data via its repository
import { getInvoiceById } from '../invoices/invoices.repository';

// payments.service.ts ❌ WRONG — service importing service
import { InvoicesService } from '../invoices/invoices.service';
```

Exception: `notifications` module service may be called directly for fire-and-forget sends.

---

## AML Check — Required Before Any Payment Initiation

Implemented in `payments.service.ts` but triggered by data from `invoices`. Pattern:

```typescript
if (invoice.faceValue >= AML_FLAG_THRESHOLD_UGX) {
  await repo.createAuditEntryWithClient(client, userId, 'AML_FLAG_TRIGGERED', 'invoices', invoiceId, {
    threshold: AML_FLAG_THRESHOLD_UGX,
    faceValue: invoice.faceValue, // numeric only — not supplier/buyer name
  });
  throw new BusinessRuleError(
    PaymentErrorCode.AML_FLAG_REQUIRED,
    'Invoice requires compliance review before payment'
  );
}
```

The compliance_officer must explicitly clear the AML flag before payment proceeds.

---

## External API Retry — Standard BullMQ Config

All modules calling external APIs (EFT settlement bank, SendGrid, Africa's Talking) use:

```typescript
{ attempts: 3, backoff: { type: 'exponential', delay: 30_000 } }
// Retry at: 30s, 120s, 480s
```

After 3 failures: set entity status to `failed`, audit log, notify `finance_manager`. Do NOT retry further automatically.

---

## Module Build Sequence — follow this order every time

```
Step 1   types.ts        interfaces · enums · error codes — no logic
Step 2   repository.ts   all SQL · parameterised · WithClient variants · ownership WHERE
Step 3   service.ts      business logic · transaction · audit log · queue dispatch
Step 4   controller.ts   parse req → call service → next(err) — no SQL, no logic
Step 5   routes.ts       auth → role → validate → controller
Step 6   CLAUDE.md       module rules grounded in the code just written
Step 7   tests/unit      service (mock repo) · repo (assert SQL params) · cross-supplier
Step 8   typecheck+lint  npm run typecheck && npm run lint — must be green
Step 9   coverage gate   ≥95% payments/risk-engine · ≥80% all others
Step 10  commit          feat([module]): description
```

For dual-auth (payments only): split Step 3 into three sub-steps — app layer, DB trigger, provider callback — each verified independently.
For a new BullMQ queue: queue declaration, job payload type, consumer handler are three separate steps.

---

## Stop Conditions — halt and report file + line before continuing

| What you find | Rule violated |
|---|---|
| BullMQ job payload contains decrypted PII (not just an ID) | Rule 3 |
| `audit_logs` INSERT is outside a transaction block | Rule 4 |
| `dual_auth_user_1 === dual_auth_user_2` path reachable | Rule 5 |
| New PII field written without `encrypt()` from `shared/crypto.ts` | Rule 6 |
| Repository function builds query via string concatenation | Rule 2 |
| Service function > 25 lines (or > 40 lines in payments) | Rule 10 |
| New money field typed as `number` or `float` instead of `bigint` | Architecture |
| Migration is not idempotent or uses `DROP` outside `mms_test` | DB safety |
| `typecheck` fails at end of any step | Non-negotiable |

Report: what was found, which file, which line, what fix is needed. Do not proceed until resolved.
