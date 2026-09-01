# shared/ — Utility Usage

## Four logging layers — use the right one

| Layer | Call | When |
|---|---|---|
| DB audit log | `repo.createAuditEntryWithClient(client, ...)` | Every state change — inside transaction |
| Security log | `logger.audit('ACTION', { component, entityId })` | Same events — called AFTER commit |
| App log | `logger.info/warn/error(...)` | Non-state events, errors, warnings |
| Never | `console.log` | Blocked by lint |

`logger.audit()` is a **custom method** — writes to both `logs/security.log` AND `logs/app.log`. Do NOT use `logger.info()` for compliance events.

```typescript
// User-initiated action: ipAddress + userAgent required
await repo.createAuditEntryWithClient(client, userId, 'INVOICE_APPROVED', 'invoices', id,
  { status: 'scored' },                        // before state
  { status: 'approved', approverId: userId },  // after state — no PII
  ipAddress, userAgent,
);
await client.query('COMMIT');
logger.audit('INVOICE_APPROVED', { component: 'approvals', invoiceId: id, approverId: userId });

// System job: userId=null, ipAddress=null, userAgent=null
await repo.createAuditEntryWithClient(client, null, 'INVOICE_SCORED', 'invoices', id,
  null, { compositeScore, recommendation }, null, null
);
```

❌ WRONG audit metadata — never include:
`supplierName` `buyerEmail` `phoneNumber` `bankAccount` `amount` `freeText`

✅ SAFE audit metadata: `status` `provider` `invoiceId` `supplierId` `score` `tier` `boolean flags`

---

## risk-config — live DB-backed thresholds

```typescript
import { getRiskConfigNumber, getRiskWeights } from '../../shared/risk-config';

const threshold = await getRiskConfigNumber('tier3_auto_reject_threshold'); // default: 3
const weights   = await getRiskWeights(); // { buyer_credit:0.30, tenor:0.20, ... }
```

Cache: 5-minute TTL. Falls back to defaults if DB unavailable. After admin change: call `invalidateRiskConfigCache()`.

❌ WRONG — hardcoding configurable thresholds:
```typescript
if (score >= 75) { ... }        // use getRiskConfigNumber('threshold_auto_approve')
const maxRejections = 3;        // use getRiskConfigNumber('tier3_auto_reject_threshold')
```

Available keys: `threshold_auto_approve(75)` `threshold_refer_manager(50)` `tier3_auto_reject_threshold(3)` `advance_pct_high(0.95)` `advance_pct_mid(0.90)` `advance_pct_low(0.85)` `weight_buyer_credit(0.30)` `weight_tenor(0.20)` `weight_track_record(0.20)` `weight_concentration(0.15)` `weight_collateral(0.15)`

---

## pool.ts

```typescript
import { pool } from '../../shared/database/pool';
// Single query
const { rows } = await pool.query<RowType>('SELECT ... WHERE id=$1 AND supplier_id=$2', [id, supplierId]);
// Transaction → see src/CLAUDE.md §3
```
❌ `new Pool(...)` anywhere in service code — never create a second pool.

---

## crypto.ts

```typescript
import { encrypt, decrypt, hashDocument } from '../../shared/crypto';
const encrypted = encrypt(plaintext);          // returns single "iv:authTag:ciphertext" string
const plain = decrypt(row.encrypted_column);  // single string arg — service layer only
```
Must encrypt: `supplier/buyer name` `phone` `email` `bank account` `TIN` `document content`

---

## Error class → HTTP status quick map

`ValidationError`→400 `AuthError`→401 `ForbiddenError`→403 `NotFoundError`→404 `BusinessRuleError`→422 `PaymentError`→502 `RisError`→500

❌ `throw new Error(...)` — always use a typed class with an error code enum value.
