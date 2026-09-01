# database/ — SQL Rules & Templates

> Root CLAUDE.md has the schema rules (BIGINT, TIMESTAMPTZ, UUID, indexes).
> This file has the implementation patterns: transactions, ownership, migrations, audit.

---

## Transaction Checklist — Six Steps, No Exceptions

```typescript
const client = await pool.connect();        // step 1: get client
try {
  await beginWithRls(client);              // step 2: BEGIN + activate RLS for current user
                                           // import: import { beginWithRls } from '../../shared/database/pool'
  await repo.updateXWithClient(client, ...); // step 3: all writes use client
  await repo.createAuditEntryWithClient(client, ...); // step 4: audit INSIDE transaction

  await client.query('COMMIT');             // step 5: commit only on success
} catch (err) {
  await client.query('ROLLBACK');           // step 6: rollback on ANY error
  throw err;
} finally {
  client.release();                         // ALWAYS — even if COMMIT throws
}
```

❌ WRONG — bare `client.query('BEGIN')` bypasses RLS activation:
```typescript
await client.query('BEGIN');               // ← never use this directly in service code
await repo.updateX(pool, ...);  // using pool not client = different connection = NOT in transaction
await client.query('COMMIT');
client.release();               // if COMMIT throws, client is leaked forever
```

---

## Ownership Check — Enforced in Repository, Not Middleware

Every query returning supplier-owned data MUST include `AND supplier_id = $N`.

```typescript
// ✅ CORRECT — ownership in SQL
export async function getInvoiceById(id: string, supplierId: string): Promise<InvoiceRow | null> {
  const { rows } = await pool.query<InvoiceRow>(
    'SELECT * FROM invoices WHERE id = $1 AND supplier_id = $2',
    [id, supplierId]
  );
  return rows[0] ?? null; // returns null if wrong supplier — service throws NotFoundError
}

// Controller passes req.user.id as supplierId:
const invoice = await repo.getInvoiceById(req.params.id, req.user.id);
if (!invoice) throw new NotFoundError('Invoice not found'); // same error — no info leak
```

❌ WRONG — fetching by ID only, then checking ownership in code:
```typescript
const invoice = await repo.getInvoiceById(id);            // fetches any supplier's invoice
if (invoice.supplierId !== req.user.id) throw new ForbiddenError(); // too late — data loaded
// Also: reveals whether the resource exists (info leak)
```

---

## Parameterised SQL — Zero String Concatenation

```typescript
// ✅ CORRECT
pool.query('SELECT * FROM invoices WHERE status = $1 AND supplier_id = $2', [status, supplierId])

// ❌ WRONG — SQL injection
pool.query(`SELECT * FROM invoices WHERE status = '${status}'`)
pool.query('SELECT * FROM invoices WHERE status = ' + status)
pool.query(`SELECT * FROM invoices WHERE id IN (${ids.join(',')})`) // even arrays
```

For dynamic `IN` clauses:
```typescript
// ✅ CORRECT dynamic IN
const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
pool.query(`SELECT * FROM invoices WHERE id IN (${placeholders})`, ids)
```

---

## audit_logs — Insert Only, Transaction Inside

```typescript
// Always use a passed client so audit is in the same transaction as the state change
export async function createAuditEntryWithClient(
  client: PoolClient,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [userId, action, entityType, entityId, JSON.stringify(metadata)]
  );
  // DB trigger prevents UPDATE and DELETE on this table
}
```

❌ WRONG — audit log in separate connection (not atomic with state change):
```typescript
await pool.query('UPDATE invoices SET status = $1 WHERE id = $2', [status, id]);
await pool.query('INSERT INTO audit_logs ...', [...]);  // if this fails, state changed with no audit
```

---

## Migration Rules

1. **Never edit an existing migration** — always create a new file
2. File naming: `migrations/YYYYMMDDHHMMSS_description.sql`
3. Every migration is idempotent:
   - `CREATE TABLE IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
4. Every new foreign key gets an index in the same migration:

```sql
-- ✅ CORRECT migration structure
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS risk_assessment_id UUID REFERENCES risk_assessments(id);
CREATE INDEX IF NOT EXISTS idx_invoices_risk_assessment_id ON invoices(risk_assessment_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status); -- index every status column
```

5. Monetary columns must be `BIGINT`:
```sql
face_value    BIGINT NOT NULL CHECK (face_value > 0),  -- ✅
face_value    DECIMAL(15,2),                            -- ❌ floating point
face_value    NUMERIC(15,2),                            -- ❌ floating point
```
