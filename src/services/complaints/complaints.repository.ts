// ============================================================
// complaints.repository.ts — ALL SQL lives here. No business logic.
// ============================================================
import type { PoolClient } from 'pg';
import { pool } from '../../shared/database/pool';
import type { ComplaintRecord, ComplaintFilters, PaginationParams } from './complaints.types';

// ── Read ─────────────────────────────────────────────────────

/** Fetch complaint by ID (no ownership filter — staff access). */
export async function getComplaintById(id: string): Promise<ComplaintRecord | null> {
  const { rows } = await pool.query<ComplaintRecord>('SELECT * FROM complaints WHERE id = $1', [
    id,
  ]);
  return rows[0] ?? null;
}

/** Fetch complaint by ID and complainant (ownership-enforced). */
export async function getComplaintByIdForUser(
  id: string,
  complainantId: string,
): Promise<ComplaintRecord | null> {
  const { rows } = await pool.query<ComplaintRecord>(
    'SELECT * FROM complaints WHERE id = $1 AND complainant_id = $2',
    [id, complainantId],
  );
  return rows[0] ?? null;
}

/** List complaints with filters and pagination (staff view). */
export async function findAllComplaints(
  filters: ComplaintFilters,
  pagination: PaginationParams,
): Promise<{ rows: ComplaintRecord[]; total: number }> {
  const offset = (pagination.page - 1) * pagination.limit;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters.status !== undefined) {
    conditions.push(`status = $${String(paramIdx++)}`);
    params.push(filters.status);
  }
  if (filters.category !== undefined) {
    conditions.push(`category = $${String(paramIdx++)}`);
    params.push(filters.category);
  }
  if (filters.complainant_id !== undefined) {
    conditions.push(`complainant_id = $${String(paramIdx++)}`);
    params.push(filters.complainant_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM complaints ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const dataResult = await pool.query<ComplaintRecord>(
    `SELECT * FROM complaints ${where}
     ORDER BY created_at DESC
     LIMIT $${String(paramIdx)} OFFSET $${String(paramIdx + 1)}`,
    [...params, pagination.limit, offset],
  );

  return { rows: dataResult.rows, total };
}

// ── Write (WithClient — used inside service-layer transactions) ──

/** Create a complaint within a transaction. */
export async function createComplaintWithClient(
  client: PoolClient,
  data: {
    id: string;
    complainantId: string;
    entityType: string;
    entityId: string | null;
    subject: string;
    description: string;
    category: string;
    priority: string;
    status: string;
    amountInvolved: string;
    escalated: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO complaints
       (id, complainant_id, entity_type, entity_id,
        subject, description, category, priority,
        status, amount_involved, escalated,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
    [
      data.id,
      data.complainantId,
      data.entityType,
      data.entityId,
      data.subject,
      data.description,
      data.category,
      data.priority,
      data.status,
      data.amountInvolved,
      data.escalated,
    ],
  );
}

/** Update complaint fields within a transaction. */
export async function updateComplaintWithClient(
  client: PoolClient,
  id: string,
  fields: {
    status?: string;
    priority?: string;
    assigned_to?: string;
  },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.status !== undefined) {
    sets.push(`status = $${String(i++)}`);
    params.push(fields.status);
  }
  if (fields.priority !== undefined) {
    sets.push(`priority = $${String(i++)}`);
    params.push(fields.priority);
  }
  if (fields.assigned_to !== undefined) {
    sets.push(`assigned_to = $${String(i++)}`);
    params.push(fields.assigned_to);
  }

  if (sets.length === 0) return;
  sets.push('updated_at = NOW()');
  params.push(id);

  await client.query(`UPDATE complaints SET ${sets.join(', ')} WHERE id = $${String(i)}`, params);
}

/** Resolve a complaint within a transaction. */
export async function resolveComplaintWithClient(
  client: PoolClient,
  id: string,
  resolution: string,
  resolvedBy: string,
): Promise<void> {
  await client.query(
    `UPDATE complaints
     SET status = 'RESOLVED', resolution = $1, resolved_at = NOW(),
         resolved_by = $2, updated_at = NOW()
     WHERE id = $3`,
    [resolution, resolvedBy, id],
  );
}

/** Escalate a complaint within a transaction. */
export async function escalateComplaintWithClient(client: PoolClient, id: string): Promise<void> {
  await client.query(
    `UPDATE complaints
     SET status = 'ESCALATED', escalated = true, updated_at = NOW()
     WHERE id = $1`,
    [id],
  );
}

// ── Audit log ────────────────────────────────────────────────

/** Insert audit log entry within a transaction. */
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
       (user_id, action, table_name, record_id,
        old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      action,
      entityType,
      entityId,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}

// ── Pool client accessor ─────────────────────────────────────

/** Acquire a client from the pool for transactional work. */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}
