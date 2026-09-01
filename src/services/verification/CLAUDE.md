# verification/ — Buyer Confirmation Module

> It generates cryptographic confirmation tokens and manages the Notice of Assignment.

---

## Two Queues — Both Required at Startup

```typescript
let notificationQueue: Queue | null = null;  // sends confirmation email to buyer
let riskScoringQueue: Queue | null = null;   // triggers risk-engine after buyer confirms

export function setNotificationQueue(queue: Queue): void { notificationQueue = queue; }
export function setRiskScoringQueue(queue: Queue): void { riskScoringQueue = queue; }
```

After buyer confirms → queue risk scoring. After risk scoring completes → risk-engine transitions invoice to `scored`.

---

## Confirmation Token — Raw vs Hashed

The buyer receives a raw 64-hex-char token in an email link. The database stores only the SHA-256 hash.

```typescript
import crypto from 'crypto';

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Generate and store:
const rawToken = crypto.randomBytes(32).toString('hex'); // 64 hex chars
const tokenHash = hashToken(rawToken);
const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48-hour window

await repo.storeConfirmationTokenWithClient(client, invoiceId, tokenHash, expiresAt.toISOString());

// Queue email with rawToken in the link (NOT tokenHash):
await notificationQueue.add('buyer-confirmation', { invoiceId, buyerId, rawToken });
// rawToken goes to buyer via email link. After that it is discarded from memory.

// Verify incoming token from buyer's click:
const incoming = req.query.token as string;
const incomingHash = hashToken(incoming);
const record = await repo.findByTokenHash(incomingHash); // compare hash, not raw
```

❌ WRONG — storing raw token in DB:
```typescript
await repo.storeToken(invoiceId, rawToken); // if DB is breached, tokens are compromised
```

❌ WRONG — passing raw token in queue payload and logging it:
```typescript
logger.info('Token generated', { rawToken }); // rawToken in logs = same as plaintext in DB
```

---

## PII Must NEVER Go Into Queue Payloads

This rule is explicitly called out in the source code comment:

```
// decrypt import removed — PII must never be passed to Bull queue data.
// Workers must look up and decrypt PII themselves from buyerId.
```

```typescript
// ✅ CORRECT — pass only IDs in queue payload
await notificationQueue.add('buyer-confirmation', {
  invoiceId,
  buyerId,       // worker fetches and decrypts buyer contact from DB
  rawToken,      // this is a random token, not PII
});

// ❌ WRONG — passing decrypted PII into queue
await notificationQueue.add('buyer-confirmation', {
  buyerEmail: decrypt(...),    // PII in Redis queue storage
  buyerPhone: decrypt(...),    // PII in Redis queue storage
  buyerName: decrypt(...),
});
```

BullMQ stores job payloads in Redis. Redis is not encrypted at rest. Workers MUST decrypt PII from PostgreSQL at job execution time, not at job creation time.

---

## RIS Bank Details — Hardcoded Constant

The Notice of Assignment instructs buyers to pay RIS instead of the supplier. Bank details are a constant:

```typescript
const RIS_BANK_DETAILS =
  'Rapha Integrated Solutions | Bank: Stanbic Bank Uganda | ' +
  'Account: 9030XXXXXXXXX | Branch: Kampala Main | ' +
  'Swift: SBICUGKX | Reference: Invoice number';
```

This string appears in: email templates, PDF Notice of Assignment, SMS reminders.
Do NOT fetch bank details from DB — they are regulatory constants, not config.

---

## Token Expiry — 48 Hours

Confirmation tokens expire after 48 hours. On expiry:
1. Buyer clicks link → `CONFIRMATION_TOKEN_EXPIRED` error
2. credit_officer can regenerate a new token (restarts the 48-hour window)
3. Old token hash is invalidated in DB before new token is issued

```typescript
if (new Date(record.expires_at) < new Date()) {
  throw new BusinessRuleError(VerificationErrorCode.TOKEN_EXPIRED,
    'Confirmation link has expired. Please request a new one.'
  );
}
```

---

## Status Flow This Module Owns

```
submitted → buyer_confirmed  (buyer clicks confirmation link with valid token)
```

After `buyer_confirmed`: queue risk-scoring job. Do NOT call risk-engine service directly.

```typescript
// ✅ CORRECT — decouple via queue
if (riskScoringQueue) {
  await riskScoringQueue.add('score-invoice', { invoiceId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  });
}

// ❌ WRONG — direct service call creates tight coupling and blocking HTTP request
import { scoreInvoice } from '../risk-engine/risk-engine.service';
await scoreInvoice(invoiceId); // blocks the HTTP response, no retry on failure
```
