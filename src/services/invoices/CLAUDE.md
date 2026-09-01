# invoices/ — Invoice Intake Rules

---

## 5-Step Validation Chain — All Steps Run, All Logged

`submitInvoice()` runs five validation steps IN ORDER. Even if step 1 fails, all step results are logged to audit_logs before throwing. This gives compliance a full picture of why an invoice was rejected.

```
Step 1: supplier_active_check   — supplier KYC status must be 'approved'
Step 2: duplicate_check         — invoice_number must be unique per supplier
Step 3: buyer_relationship      — buyer must exist AND be linked to this supplier
Step 4: tenor_validation        — tenor must be 7–90 days
Step 5: aml_check               — face_value < AML_FLAG_THRESHOLD (100M UGX)
```

```typescript
const validationResults: ValidationResult[] = [];
// Each step pushes to validationResults before throwing
// ALL results are logged even if earlier step failed:
await logValidationResults(userId, invoiceId, validationResults, ipAddress, userAgent);
```

❌ WRONG — throwing immediately without logging all steps:
```typescript
if (supplier.kyc_status !== 'approved') throw new BusinessRuleError(...); // no log
```

---

## Tenor Calculation — Ceiling Division

```typescript
const MIN_TENOR_DAYS = parseInt(process.env.MIN_INVOICE_TENOR_DAYS ?? '7', 10);
const MAX_TENOR_DAYS = parseInt(process.env.MAX_INVOICE_TENOR_DAYS ?? '90', 10);

function computeTenorDays(dueDate: string): number {
  const diffMs = new Date(dueDate).getTime() - new Date().getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // ceiling — partial day = full day
}
```

Tenor is computed from today to `due_date`. It is NOT supplied by the client directly — the client supplies `due_date` and `invoice_date`. Tenor is derived.

---

## AML Check on Submission

```typescript
const AML_THRESHOLD_UGX = BigInt(process.env.AML_FLAG_THRESHOLD_UGX ?? '100000000');

const step5Passed = faceValue < AML_THRESHOLD_UGX;
// ≥ 100M UGX → invoice is flagged, submission rejected, 'AML_THRESHOLD_EXCEEDED' logged
```

AML flag at submission prevents the invoice entering the pipeline. The supplier must contact compliance — there is no self-service resolution.

---

## Supplier Ownership — All Queries

The `invoices` module is the primary place where supplier ownership is enforced. Every query must include `supplier_id`:

```typescript
// ✅ CORRECT — ownership in repo
export async function getInvoiceByIdForSupplier(id: string, supplierId: string) {
  return pool.query(
    'SELECT * FROM invoices WHERE id = $1 AND supplier_id = $2',
    [id, supplierId]
  );
}
```

credit_officer and management roles can query without the `supplier_id` filter (they see all invoices). Route access is role-gated; repository has separate functions:
- `getInvoiceById(id)` — for officers (no ownership filter)
- `getInvoiceByIdForSupplier(id, supplierId)` — for suppliers

---

## Status Transitions This Module Owns

```
(new)    → draft         (invoice created but not submitted)
draft    → submitted     (submitInvoice() — all 5 validations pass)
```

All subsequent transitions are owned by downstream modules (see services/CLAUDE.md).

---

## Invoice Number Uniqueness

Uniqueness is per-supplier, not global:
```sql
UNIQUE (invoice_number, supplier_id)
-- Two different suppliers can submit invoices with the same number
```

Validation: `repo.findInvoiceByNumberAndSupplier(invoiceNumber, supplierId)` — returns existing row if duplicate.

---

## Notification After Submission

After successful INSERT and audit log (inside transaction), queue buyer notification OUTSIDE transaction:
```typescript
// Queue buyer confirmation request — notifications/CLAUDE.md for payload shape
if (notificationQueue) {
  await notificationQueue.add('buyer-confirmation-request', {
    invoiceId, buyerId: data.buyer_id, supplierId,
  }, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
}
// If queue is null: log warn, continue — invoice is still submitted successfully
```
