import { query } from '../../shared/database/pool';
import type { PoolClient } from 'pg';
import type {
  AssignmentRecord,
  AssignmentQueueItem,
  AssignmentEntityType,
} from './assignments.types';

// =========================================================================
// Create
// =========================================================================

export async function createAssignmentWithClient(
  client: PoolClient,
  data: {
    id: string;
    entityType: AssignmentEntityType;
    entityId: string;
    assignedTo: string;
    assignedBy: string;
    notes?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO application_assignments
       (id, entity_type, entity_id, assigned_to, assigned_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.id, data.entityType, data.entityId, data.assignedTo, data.assignedBy, data.notes ?? null],
  );
}

// =========================================================================
// Read
// =========================================================================

export async function getAssignmentById(id: string): Promise<AssignmentRecord | null> {
  const result = await query<AssignmentRecord>(
    `SELECT id, entity_type, entity_id, assigned_to, assigned_by,
            assigned_at, notes, is_active
     FROM application_assignments WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function getActiveAssignmentsByAssignee(
  assignedTo: string,
): Promise<AssignmentQueueItem[]> {
  const result = await query<AssignmentQueueItem>(
    `SELECT id, entity_type, entity_id, assigned_at, notes
     FROM application_assignments
     WHERE assigned_to = $1 AND is_active = TRUE
     ORDER BY assigned_at ASC`,
    [assignedTo],
  );
  return result.rows;
}

export async function getAssignmentsByEntity(
  entityType: AssignmentEntityType,
  entityId: string,
): Promise<AssignmentRecord[]> {
  const result = await query<AssignmentRecord>(
    `SELECT id, entity_type, entity_id, assigned_to, assigned_by,
            assigned_at, notes, is_active
     FROM application_assignments
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY assigned_at DESC`,
    [entityType, entityId],
  );
  return result.rows;
}

// =========================================================================
// Deactivate (soft delete)
// =========================================================================

export async function deactivateAssignmentWithClient(
  client: PoolClient,
  id: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE application_assignments
     SET is_active = FALSE
     WHERE id = $1 AND is_active = TRUE`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

// =========================================================================
// Audit logging
// =========================================================================

export async function createAuditEntryWithClient(
  client: PoolClient,
  userId: string,
  action: string,
  recordId: string,
  newValues: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      action,
      'application_assignments',
      recordId,
      null,
      JSON.stringify(newValues),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}
