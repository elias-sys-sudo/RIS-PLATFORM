# approvals/ — Four-Tier Decision Engine

> Canonical transaction-flow reference (authorization matrix, stages) →
> [`01-Documents/TRANSACTION-FLOW.md`](../../../01-Documents/TRANSACTION-FLOW.md).

---

## Tier Routing Matrix — determineTier() Logic

```typescript
// Order matters — highest tier evaluated FIRST (highest priority)
if (faceValue > 200_000_000n || score < 30)                  → TIER_4  (mgmt + officer)
if (faceValue > 50_000_000n || score < 50)                   → TIER_3  (committee)
if (faceValue >= 10_000_000n || (score >= 50 && score < 75) || amlFlagged) → TIER_2 (credit officer)
else                                                          → AUTO    (system)
```

| Tier | Face Value | Score | AML | Who decides | Quorum |
|---|---|---|---|---|---|
| AUTO | < 10M UGX | ≥ 75 | No | System | Immediate |
| TIER_2 | 10M–50M UGX | 50–74 | Either | 1 credit_officer | 1 approval |
| TIER_3 | > 50M–200M UGX | < 50 | Either | 2 different officers (or 1 management override) | 2 approvals |
| TIER_4 | > 200M UGX | < 30 | Either | 1 management + 1 credit_officer | 2 approvals (both roles) |

> The score-based triggers `TIER_3 (score < 50)` and `TIER_4 (score < 30)` are
> defense-in-depth: with default `risk_config` thresholds the risk engine auto-rejects at
> `score < 50`, so they are only reachable if `threshold_refer_manager` is lowered. Same-user
> dual-sign is blocked in TIER_3/TIER_4 at the application layer.

❌ WRONG — evaluating conditions in wrong order:
```typescript
if (faceValue >= 10_000_000n) return ApprovalTier.TIER_2; // misses TIER_3 invoices >50M
```

---

## Concurrency Lock — lockInvoiceForReview()

Before any write inside the approval transaction, lock the invoice row:

```typescript
const locked = await repo.lockInvoiceForReview(client, invoiceId);
// SQL: SELECT id FROM invoices WHERE id = $1 FOR UPDATE NOWAIT
if (!locked) {
  throw new BusinessRuleError(ApprovalErrorCode.INVOICE_LOCKED,
    'Invoice could not be locked for review'
  );
}
```

`NOWAIT` means: if another request is already processing this invoice, fail immediately (no queue). This prevents two credit officers approving simultaneously and both succeeding.

---

## Tier 3 Quorum — 2 Different Officers Required

```typescript
function validateTier3Officer(userId: string, role: string, existing: ApprovalRecord[]): void {
  if (role === 'management') return; // management can override at any time

  const alreadyDecided = existing.some(a => a.approver_id === userId);
  if (alreadyDecided) {
    throw new BusinessRuleError(ApprovalErrorCode.SAME_OFFICER,
      'Same officer cannot provide both Tier 3 decisions'
    );
  }
}

// Quorum check after saving approval
const approvalCount = existingApprovals.filter(a => a.decision === 'APPROVED').length + 1;
const quorumReached = approvalCount >= 2;
if (quorumReached) {
  await repo.updateInvoiceStatus(client, invoiceId, 'approved', 'scored');
  await queuePayment(invoiceId); // only fires payment when quorum is met
}
```

Return `quorumReached: false` in the response when a Tier 3 approval is recorded but quorum not yet met. The caller should surface this to the officer: "1 of 2 approvals received."

---

## Tier 3 Rejection — Auto-Reject Threshold

Tier 3 rejections increment a counter. When counter ≥ `tier3_auto_reject_threshold` (from risk-config, not hardcoded):

```typescript
const rejCount = await repo.incrementTier3RejectionCount(client, invoiceId);
const threshold = await getRiskConfigNumber('tier3_auto_reject_threshold');

if (rejCount >= threshold) {
  await repo.updateInvoiceStatus(client, invoiceId, 'rejected', 'scored');
  await queueRejectionNotification(invoiceId);
  // Audit with action 'TIER3_AUTO_REJECTED'
}
// If below threshold: rejection recorded but invoice stays in 'scored' for re-review
```

management can reset this counter via `resetTier3RejectionCount()` to allow re-evaluation.

---

## Two Queues — Both Required at Startup

```typescript
let paymentQueue: Queue | null = null;      // fires payment initiation after approval
let notificationQueue: Queue | null = null; // sends rejection / SLA escalation notices

export function setPaymentQueue(queue: Queue): void { paymentQueue = queue; }
export function setNotificationQueue(queue: Queue): void { notificationQueue = queue; }
```

If `paymentQueue` is null when AUTO/TIER_2/TIER_3 quorum approval fires: log warn, continue (payment missed — operations team must handle manually). Do NOT throw — the approval itself succeeded.

Backoff is platform-standard `{ attempts: 3, backoff: { type: 'exponential', delay: 30_000 } }` for ALL three enqueues in this module (payment, rejection notification, SLA escalation) — see src/services/CLAUDE.md "External API Retry — Standard BullMQ Config". A `process-payment` job that exhausts its retries is surfaced by the payments module's worker terminal-failure handler (audit + finance_manager notification + `GET /admin/approvals/orphans` listing).

---

## SLA Monitoring — 24-Hour Breach

```typescript
// Called by a scheduled job (BullMQ repeatable) every hour
export async function checkSlaBreaches(): Promise<void> {
  const breaches = await repo.getInvoicesExceedingSLA(24); // hours
  for (const breach of breaches) {
    await queueSlaEscalation(breach); // notifies management
  }
}
// Queue job payload: { invoiceId, hoursPending, tier }
```

SLA is 24 hours from `scored` status to final approval decision. This does NOT change invoice status — it only escalates the notification.

---

## AUTO Approval — approverId is 'SYSTEM'

```typescript
await repo.createApprovalWithClient(client, {
  id: approvalId,
  invoiceId: invoice.id,
  tier: ApprovalTier.AUTO,
  decision: ApprovalDecision.APPROVED,
  approverId: 'SYSTEM',   // ← literal string, not a user UUID
  comments: `Auto-approved: score ${score}, value ${faceValue}`,
});
```

When querying approvals history, `approverId === 'SYSTEM'` indicates auto-approval. Do not look up this value in the users table.
