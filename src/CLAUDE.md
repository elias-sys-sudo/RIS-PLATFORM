# src/ — Backend Implementation Patterns

## Bash commands

- `npm run typecheck` — must pass before finishing any file
- `npm run lint -- --fix` — auto-fix lint issues
- `npm run test:unit -- --testPathPattern=tests/unit/[module] --verbose` — run module tests

## 1. Middleware chain — exact order in routes.ts

```typescript
router.post('/path',
  authMiddleware,              // 1. JWT → populates req.user
  requireRole(['role']),       // 2. RBAC → 403 if wrong role
  validate(schema),            // 3. Joi → 400 if invalid
  controller.method            // 4. Zero logic here
);
```

## 2. WithClient pattern — required for all multi-table writes

Every repo function that modifies state needs TWO forms:

```typescript
// Standalone (owns its client)
export async function updateStatus(id: string, status: string): Promise<void> {
  await pool.query('UPDATE x SET status=$1 WHERE id=$2', [status, id]);
}
// WithClient (used inside service transactions)
export async function updateStatusWithClient(client: PoolClient, id: string, status: string): Promise<void> {
  await client.query('UPDATE x SET status=$1 WHERE id=$2', [status, id]);
}
```

## 3. Transaction template — copy exactly

```typescript
const client = await pool.connect();
try {
  await beginWithRls(client); // BEGIN + SET LOCAL RLS context (import from shared/database/pool)
  await repo.updateXWithClient(client, ...);
  await repo.createAuditEntryWithClient(client, userId, 'ACTION', 'entity', id, metadata);
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release(); // always — even if COMMIT throws
}
// After commit — outside transaction:
logger.audit('ACTION', { component: 'module', entityId: id });
```

## 4. Encrypt/decrypt layering

```
Service layer:  encrypt() before repo INSERT  |  decrypt() after repo SELECT
Repository:     stores/returns ciphertext only
Database:       stores { iv, tag, ciphertext } columns
```

## 5. Error code enum — required in every module's types.ts

```typescript
export enum InvoiceErrorCode {
  NOT_FOUND    = 'INVOICE_NOT_FOUND',
  WRONG_STATUS = 'INVOICE_WRONG_STATUS',
}
// Usage:
throw new BusinessRuleError(InvoiceErrorCode.WRONG_STATUS, 'Status is draft, expected submitted');
// Response: { code: 'INVOICE_WRONG_STATUS', message: '...', statusCode: 422 }
```

## 6. Queue init pattern — never instantiate in service layer

```typescript
let notificationQueue: Queue | null = null;
export function setNotificationQueue(queue: Queue): void { notificationQueue = queue; }

// When using:
if (!notificationQueue) { logger.warn('Queue not configured', { module, entityId }); return; }
await notificationQueue.add(type, payload, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
```

## Pre-flight checklist before submitting any file

**routes.ts** — every route has `auth → role → validate → controller`; no logic
**controller.ts** — extracts `ipAddress`/`userAgent` from req; calls `next(err)` in catch; one service call per handler
**service.ts** — audit log inside same transaction; `logger.audit()` after COMMIT; PII encrypted before repo; multi-table writes use transaction
**repository.ts** — all SQL parameterised; supplier queries have `AND supplier_id=$N`; writes have `WithClient` variant
