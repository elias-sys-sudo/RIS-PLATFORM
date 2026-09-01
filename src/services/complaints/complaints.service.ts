// ============================================================
// complaints.service.ts — Business logic only. No SQL. No Express.
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import { Queue } from 'bullmq';
import { beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import * as repo from './complaints.repository';
import { ComplaintStatus, ComplaintPriority, ComplaintErrorCode } from './complaints.types';
import type {
  CreateComplaintInput,
  UpdateComplaintInput,
  ComplaintRecord,
  ComplaintFilters,
  PaginationParams,
  PaginatedResult,
} from './complaints.types';

// ── Constants ────────────────────────────────────────────────

/** Auto-escalate complaints involving >= 5M UGX. */
const AUTO_ESCALATE_THRESHOLD = 5_000_000;

// ── Queue setup ──────────────────────────────────────────────

let notificationQueue: Queue | null = null;

export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// ── Public API ───────────────────────────────────────────────

/**
 * File a new complaint. Auto-escalates if amount >= 5M UGX.
 */
export async function fileComplaint(
  userId: string,
  input: CreateComplaintInput,
  ipAddress: string,
  userAgent: string,
): Promise<{ id: string }> {
  const id = uuidv4();
  const amountInvolved = input.amount_involved ?? 0;
  const shouldEscalate = amountInvolved >= AUTO_ESCALATE_THRESHOLD;
  const status = shouldEscalate ? ComplaintStatus.ESCALATED : ComplaintStatus.OPEN;
  const priority = shouldEscalate ? ComplaintPriority.HIGH : ComplaintPriority.NORMAL;

  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await createComplaintRecord(client, id, userId, input, status, priority, shouldEscalate);
    await auditComplaintCreated(client, userId, id, status, ipAddress, userAgent);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.audit('COMPLAINT_FILED', { component: 'complaints', complaintId: id });
  await queueNotification('complaint-filed', { complaintId: id, userId });

  return { id };
}

/**
 * Get a complaint by ID.
 */
export async function getComplaint(complaintId: string): Promise<ComplaintRecord> {
  const record = await repo.getComplaintById(complaintId);
  if (!record) {
    throw new NotFoundError('Complaint', complaintId);
  }
  return record;
}

/**
 * List complaints with pagination and filters.
 */
export async function listComplaints(
  filters: ComplaintFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<ComplaintRecord>> {
  const { rows, total } = await repo.findAllComplaints(filters, pagination);
  return {
    data: rows,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit),
  };
}

/**
 * Update complaint fields (status, priority, assigned_to).
 */
export async function updateComplaint(
  complaintId: string,
  update: UpdateComplaintInput,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<ComplaintRecord> {
  const existing = await repo.getComplaintById(complaintId);
  if (!existing) {
    throw new NotFoundError('Complaint', complaintId);
  }
  validateNotResolved(existing);

  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.updateComplaintWithClient(client, complaintId, update);
    await auditComplaintUpdated(client, userId, complaintId, update, ipAddress, userAgent);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.audit('COMPLAINT_UPDATED', { component: 'complaints', complaintId });
  const updated = await repo.getComplaintById(complaintId);
  return updated!;
}

/**
 * Resolve a complaint.
 */
export async function resolveComplaint(
  complaintId: string,
  resolution: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const existing = await repo.getComplaintById(complaintId);
  if (!existing) {
    throw new NotFoundError('Complaint', complaintId);
  }
  validateNotResolved(existing);

  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.resolveComplaintWithClient(client, complaintId, resolution, userId);
    await auditComplaintResolved(client, userId, complaintId, resolution, ipAddress, userAgent);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.audit('COMPLAINT_RESOLVED', { component: 'complaints', complaintId });
  await queueNotification('complaint-resolved', { complaintId });
}

/**
 * Escalate a complaint.
 */
export async function escalateComplaint(
  complaintId: string,
  reason: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const existing = await repo.getComplaintById(complaintId);
  if (!existing) {
    throw new NotFoundError('Complaint', complaintId);
  }
  validateNotResolved(existing);

  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.escalateComplaintWithClient(client, complaintId);
    await auditComplaintEscalated(client, userId, complaintId, reason, ipAddress, userAgent);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.audit('COMPLAINT_ESCALATED', { component: 'complaints', complaintId });
  await queueNotification('complaint-escalated', { complaintId, reason });
}

// ── Private helpers ──────────────────────────────────────────

function validateNotResolved(record: ComplaintRecord): void {
  const status = record.status as ComplaintStatus;
  if (status === ComplaintStatus.RESOLVED || status === ComplaintStatus.CLOSED) {
    throw new BusinessRuleError(
      ComplaintErrorCode.ALREADY_RESOLVED,
      'Complaint has already been resolved or closed',
    );
  }
}

async function createComplaintRecord(
  client: import('pg').PoolClient,
  id: string,
  userId: string,
  input: CreateComplaintInput,
  status: string,
  priority: string,
  escalated: boolean,
): Promise<void> {
  await repo.createComplaintWithClient(client, {
    id,
    complainantId: userId,
    entityType: input.entity_type,
    entityId: input.entity_id ?? null,
    subject: input.subject,
    description: input.description,
    category: input.category,
    priority,
    status,
    amountInvolved: String(input.amount_involved ?? 0),
    escalated,
  });
}

async function auditComplaintCreated(
  client: import('pg').PoolClient,
  userId: string,
  id: string,
  status: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createAuditEntryWithClient(
    client,
    userId,
    'COMPLAINT_FILED',
    'complaints',
    id,
    null,
    { status },
    ipAddress,
    userAgent,
  );
}

async function auditComplaintUpdated(
  client: import('pg').PoolClient,
  userId: string,
  id: string,
  update: UpdateComplaintInput,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createAuditEntryWithClient(
    client,
    userId,
    'COMPLAINT_UPDATED',
    'complaints',
    id,
    null,
    { fields: Object.keys(update) },
    ipAddress,
    userAgent,
  );
}

async function auditComplaintResolved(
  client: import('pg').PoolClient,
  userId: string,
  id: string,
  _resolution: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createAuditEntryWithClient(
    client,
    userId,
    'COMPLAINT_RESOLVED',
    'complaints',
    id,
    null,
    { status: ComplaintStatus.RESOLVED, hasResolution: true },
    ipAddress,
    userAgent,
  );
}

async function auditComplaintEscalated(
  client: import('pg').PoolClient,
  userId: string,
  id: string,
  _reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createAuditEntryWithClient(
    client,
    userId,
    'COMPLAINT_ESCALATED',
    'complaints',
    id,
    null,
    { status: ComplaintStatus.ESCALATED, escalated: true },
    ipAddress,
    userAgent,
  );
}

async function queueNotification(type: string, payload: Record<string, unknown>): Promise<void> {
  if (!notificationQueue) {
    logger.warn('complaints: notification queue not configured', { type });
    return;
  }
  await enqueueWithContext(notificationQueue, type, payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  });
}
