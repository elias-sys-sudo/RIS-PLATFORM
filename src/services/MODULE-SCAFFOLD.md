# New Module Scaffold

> Copy these templates when creating any new module.
> Replace every `[Module]`, `[module]`, `[Entity]`, `[entity]` placeholder.
> Delete sections that don't apply (e.g. no queue if module doesn't send notifications).

---

## [module].types.ts

```typescript
// ============================================================
// [module].types.ts
// ============================================================

export enum [Module]Status {
  PENDING   = 'pending',
  ACTIVE    = 'active',
  COMPLETED = 'completed',
}

export enum [Module]ErrorCode {
  NOT_FOUND         = '[ENTITY]_NOT_FOUND',
  WRONG_STATUS      = '[ENTITY]_WRONG_STATUS',
  ALREADY_EXISTS    = '[ENTITY]_ALREADY_EXISTS',
  FORBIDDEN         = '[ENTITY]_FORBIDDEN',
}

export interface [Entity]Record {
  id: string;
  supplier_id: string;
  status: [Module]Status;
  face_value: string;    // BIGINT serialised as string
  created_at: string;
  updated_at: string;
}

export interface Create[Entity]Input {
  supplierId: string;
  faceValue: bigint;
  // add fields
}
```

---

## [module].repository.ts

```typescript
// ============================================================
// [module].repository.ts — ALL SQL lives here. No business logic.
// ============================================================
import type { PoolClient } from 'pg';
import { pool } from '../../shared/database/pool';
import type { [Entity]Record } from './[module].types';

// ── Read ─────────────────────────────────────────────────────

/** Ownership-enforced fetch — supplier can only see their own records. */
export async function get[Entity]ByIdForSupplier(
  id: string,
  supplierId: string,
): Promise<[Entity]Record | null> {
  const { rows } = await pool.query<[Entity]Record>(
    'SELECT * FROM [entities] WHERE id = $1 AND supplier_id = $2',
    [id, supplierId],
  );
  return rows[0] ?? null;
}

/** Officer fetch — no ownership filter (all records). */
export async function get[Entity]ById(id: string): Promise<[Entity]Record | null> {
  const { rows } = await pool.query<[Entity]Record>(
    'SELECT * FROM [entities] WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

// ── Write (standalone) ────────────────────────────────────────

export async function create[Entity](data: {
  id: string;
  supplierId: string;
  faceValue: string;
  status: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO [entities] (id, supplier_id, face_value, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [data.id, data.supplierId, data.faceValue, data.status],
  );
}

// ── Write (WithClient — used inside service-layer transactions) ──

export async function update[Entity]StatusWithClient(
  client: PoolClient,
  id: string,
  status: string,
): Promise<void> {
  await client.query(
    'UPDATE [entities] SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id],
  );
}

// ── Audit log ────────────────────────────────────────────────

export async function createAuditEntryWithClient(
  client: PoolClient,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
      (user_id, action, entity_type, entity_id, before_state, after_state, ip_address, user_agent, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [userId, action, entityType, entityId,
     before ? JSON.stringify(before) : null,
     JSON.stringify(after),
     ipAddress ?? null, userAgent ?? null],
  );
}
```

---

## [module].service.ts

```typescript
// ============================================================
// [module].service.ts — Business logic only. No SQL. No Express.
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import { Queue } from 'bullmq';
import { pool } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { BusinessRuleError, NotFoundError, ForbiddenError } from '../../shared/errors';
import * as repo from './[module].repository';
import { [Module]Status, [Module]ErrorCode } from './[module].types';
import type { Create[Entity]Input, [Entity]Record } from './[module].types';

// ── Queue setup (omit if module sends no notifications) ──────

let notificationQueue: Queue | null = null;
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Create a new [entity].
 * Validates input, persists, writes audit log — all in one transaction.
 */
export async function create[Entity](
  input: Create[Entity]Input,
  ipAddress: string,
  userAgent: string,
): Promise<{ id: string }> {
  // 1. Business rule checks (before opening transaction)
  const existing = await repo.get[Entity]ByIdForSupplier('check', input.supplierId);
  // add validation...

  const id = uuidv4();

  // 2. Transaction wraps all writes
  const client = await pool.connect();
  try {
    await beginWithRls(client); // BEGIN + SET LOCAL RLS — import from shared/database/pool

    await repo.create[Entity]({
      id,
      supplierId: input.supplierId,
      faceValue: input.faceValue.toString(),
      status: [Module]Status.PENDING,
    });

    await repo.createAuditEntryWithClient(
      client, input.supplierId, '[ENTITY]_CREATED', '[entities]', id,
      null,
      { status: [Module]Status.PENDING },
      ipAddress, userAgent,
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 3. Post-commit side effects (outside transaction)
  logger.audit('[ENTITY]_CREATED', { component: '[module]', id, supplierId: input.supplierId });
  await queueNotification('[entity]-created', { id, supplierId: input.supplierId });

  return { id };
}

/**
 * Get a [entity] by ID. Supplier sees only their own; officers see all.
 */
export async function get[Entity](
  id: string,
  requesterId: string,
  requesterRole: string,
): Promise<[Entity]Record> {
  const isOfficer = ['credit_officer', 'finance_manager', 'management'].includes(requesterRole);

  const record = isOfficer
    ? await repo.get[Entity]ById(id)
    : await repo.get[Entity]ByIdForSupplier(id, requesterId);

  if (!record) throw new NotFoundError('[Entity]', id);
  return record;
}

// ── Private helpers ──────────────────────────────────────────

async function queueNotification(type: string, payload: Record<string, unknown>): Promise<void> {
  if (!notificationQueue) {
    logger.warn('[module]: notification queue not configured', { type });
    return;
  }
  await notificationQueue.add(type, payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  });
}
```

---

## [module].controller.ts

```typescript
// ============================================================
// [module].controller.ts — Parse request, call service, return response.
// Zero business logic. Zero SQL.
// ============================================================
import type { Request, Response, NextFunction } from 'express';
import * as service from './[module].service';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ipAddress = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    const result = await service.create[Entity](
      { supplierId: req.user.id, faceValue: BigInt(req.body.face_value) },
      ipAddress,
      userAgent,
    );

    res.status(201).json(result);
  } catch (err) {
    next(err); // global error handler formats the response
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.get[Entity](
      req.params.id,
      req.user.id,
      req.user.role,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
```

---

## [module].routes.ts

```typescript
// ============================================================
// [module].routes.ts — Router, middleware chain only. No logic.
// ============================================================
import { Router } from 'express';
import Joi from 'joi';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { requireRole } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import * as controller from './[module].controller';

const router = Router();

const create[Entity]Schema = Joi.object({
  face_value: Joi.number().integer().positive().required(),
  // add fields matching Create[Entity]Input
});

// Supplier creates
router.post('/',
  authMiddleware,
  requireRole(['supplier']),
  validate(create[Entity]Schema),
  controller.create,
);

// Anyone with access reads (role gates differ per entity)
router.get('/:id',
  authMiddleware,
  requireRole(['supplier', 'credit_officer', 'finance_manager', 'management']),
  controller.getOne,
);

export default router;
```

---

## Scaffold Checklist — Before Writing Any Real Code

- [ ] `types.ts`: error code enum created, all DB row types match actual schema columns
- [ ] `repository.ts`: every supplier query has `AND supplier_id = $N`, all writes have `WithClient` variant
- [ ] `service.ts`: transaction wraps ALL multi-table writes, audit log inside transaction, `logger.audit()` called after COMMIT
- [ ] `controller.ts`: extracts `ipAddress` + `userAgent` from request, passes to service, calls `next(err)` in catch
- [ ] `routes.ts`: middleware order is `auth → role → validate → controller`, every route has all three guards
- [ ] Queue setter exported and called from app entry point
- [ ] `npm run typecheck` passes with zero errors
