import { v4 as uuidv4 } from 'uuid';
import { pool, beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { NotFoundError, BusinessRuleError } from '../../shared/errors';
import * as repo from './assignments.repository';
import type {
  CreateAssignmentInput,
  AssignmentRecord,
  AssignmentQueueItem,
  AssignmentEntityType,
} from './assignments.types';
import { AssignmentErrorCode } from './assignments.types';

// =========================================================================
// Create assignment
// =========================================================================

export async function createAssignment(
  input: CreateAssignmentInput,
  assignedBy: string,
  ip?: string,
  ua?: string,
): Promise<AssignmentRecord> {
  const id = uuidv4();

  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.createAssignmentWithClient(client, {
      id,
      entityType: input.entity_type,
      entityId: input.entity_id,
      assignedTo: input.assigned_to,
      assignedBy,
      notes: input.notes,
    });
    await repo.createAuditEntryWithClient(
      client,
      assignedBy,
      'ASSIGNMENT_CREATED',
      id,
      {
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        assigned_to: input.assigned_to,
      },
      ip,
      ua,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.audit('ASSIGNMENT_CREATED', { component: 'assignments', assignmentId: id });

  const record = await repo.getAssignmentById(id);
  if (!record)
    throw new NotFoundError(AssignmentErrorCode.NOT_FOUND, 'Assignment not found after insert');
  return record;
}

// =========================================================================
// Get officer queue
// =========================================================================

export async function getMyQueue(userId: string): Promise<AssignmentQueueItem[]> {
  return repo.getActiveAssignmentsByAssignee(userId);
}

// =========================================================================
// Get assignments for entity
// =========================================================================

export async function getAssignmentsForEntity(
  entityType: AssignmentEntityType,
  entityId: string,
): Promise<AssignmentRecord[]> {
  return repo.getAssignmentsByEntity(entityType, entityId);
}

// =========================================================================
// Remove assignment
// =========================================================================

export async function removeAssignment(
  id: string,
  removedBy: string,
  ip?: string,
  ua?: string,
): Promise<void> {
  const existing = await repo.getAssignmentById(id);
  if (!existing) throw new NotFoundError(AssignmentErrorCode.NOT_FOUND, 'Assignment not found');
  if (!existing.is_active) {
    throw new BusinessRuleError(AssignmentErrorCode.NOT_FOUND, 'Assignment is already inactive');
  }

  const client = await pool.connect();
  try {
    await beginWithRls(client);
    const deactivated = await repo.deactivateAssignmentWithClient(client, id);
    if (!deactivated) {
      throw new BusinessRuleError(
        AssignmentErrorCode.NOT_FOUND,
        'Assignment could not be deactivated',
      );
    }
    await repo.createAuditEntryWithClient(
      client,
      removedBy,
      'ASSIGNMENT_REMOVED',
      id,
      {
        entity_type: existing.entity_type,
        entity_id: existing.entity_id,
        assigned_to: existing.assigned_to,
      },
      ip,
      ua,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.audit('ASSIGNMENT_REMOVED', { component: 'assignments', assignmentId: id });
}
