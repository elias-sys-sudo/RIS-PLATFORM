// =============================================================================
// Collateral — Service (business logic, validation, audit logging)
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { Worker, type Job, type Queue } from 'bullmq';
import { logger } from '../../shared/logger';
import { getRiskConfigNumber } from '../../shared/risk-config';
import { NotFoundError, ForbiddenError, BusinessRuleError } from '../../shared/errors';
import { enqueueWithContext, withJobContext } from '../../shared/workers/queue-helpers';

const COVERAGE_RATIO_KEY = 'collateral_min_coverage_ratio';
const COVERAGE_RATIO_FALLBACK = 0.5;

/**
 * Read the configured minimum coverage ratio from risk_config.
 *
 * Falls back to 0.5 only for genuinely invalid values (NaN / Infinity /
 * negative). A configured value of 0 is treated as a deliberate operator
 * decision to disable the collateral gate — useful for staging and for
 * supplier cohorts where collateral isn't required (e.g. fully insured
 * receivables). The fallback exists for unmigrated environments and
 * accidental row deletion, not as a safety net against zero.
 */
async function getMinCoverageRatio(): Promise<number> {
  try {
    const value = await getRiskConfigNumber(COVERAGE_RATIO_KEY);
    if (!Number.isFinite(value) || value < 0) {
      logger.warn('collateral: invalid coverage threshold; using fallback', {
        component: 'collateral',
        key: COVERAGE_RATIO_KEY,
        receivedValue: value,
      });
      return COVERAGE_RATIO_FALLBACK;
    }
    return value;
  } catch {
    logger.warn('collateral: failed to read coverage threshold; using fallback', {
      component: 'collateral',
      key: COVERAGE_RATIO_KEY,
    });
    return COVERAGE_RATIO_FALLBACK;
  }
}
import * as repo from './collateral.repository';
import type {
  CollateralRecord,
  CollateralDocumentRef,
  CreateCollateralInput,
  UpdateCollateralInput,
} from './collateral.types';

// =========================================================================
// Queue setup
// =========================================================================

let notificationQueue: Queue | null = null;
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// ---------------------------------------------------------------------------
// Create collateral
// ---------------------------------------------------------------------------

/**
 * Create a new collateral record attached to an invoice.
 * Validates invoice exists and user has access.
 */
export async function createCollateral(
  userId: string,
  role: string,
  input: CreateCollateralInput,
  ipAddress: string,
  userAgent: string,
): Promise<CollateralRecord> {
  const invoice = await repo.getInvoiceStatus(input.invoice_id);
  if (!invoice) {
    throw new NotFoundError('Invoice', input.invoice_id);
  }

  const hasAccess = await repo.validateInvoiceAccess(input.invoice_id, userId, role);
  if (!hasAccess) {
    throw new ForbiddenError('Access denied to this invoice');
  }

  const id = uuidv4();

  const collateral = await repo.createCollateral(id, invoice.supplier_id, input);

  await repo.createAuditEntry(
    userId,
    'COLLATERAL_CREATED',
    'collateral',
    id,
    {},
    { type: input.type, value: input.estimated_value },
    ipAddress,
    userAgent,
  );

  logger.info('Collateral created', {
    component: 'collateral',
    collateralId: id,
    invoiceId: input.invoice_id,
    userId,
  });

  return collateral;
}

// ---------------------------------------------------------------------------
// List collateral
// ---------------------------------------------------------------------------

/**
 * List collateral for an invoice with pagination.
 */
export async function listCollateral(
  userId: string,
  role: string,
  invoiceId: string,
  page: number,
  limit: number,
): Promise<{
  data: CollateralRecord[];
  total: number;
}> {
  const hasAccess = await repo.validateInvoiceAccess(invoiceId, userId, role);
  if (!hasAccess) {
    throw new ForbiddenError('Access denied to this invoice');
  }

  return repo.listByInvoice(invoiceId, page, limit);
}

// ---------------------------------------------------------------------------
// Get single collateral
// ---------------------------------------------------------------------------

/**
 * Get a single collateral with documents.
 */
export async function getCollateral(
  userId: string,
  role: string,
  collateralId: string,
): Promise<{
  collateral: CollateralRecord;
  documents: CollateralDocumentRef[];
}> {
  const collateral = await repo.getCollateralById(collateralId);
  if (!collateral) {
    throw new NotFoundError('Collateral', collateralId);
  }

  if (collateral.invoice_id !== null) {
    const hasAccess = await repo.validateInvoiceAccess(collateral.invoice_id, userId, role);
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to this collateral');
    }
  }

  const documents = await repo.getCollateralDocuments(collateralId);

  return { collateral, documents };
}

// ---------------------------------------------------------------------------
// Update collateral
// ---------------------------------------------------------------------------

/**
 * Update collateral. Cannot change invoice_id after creation.
 * Logs value changes in audit trail.
 */
export async function updateCollateral(
  userId: string,
  role: string,
  collateralId: string,
  input: UpdateCollateralInput,
  ipAddress: string,
  userAgent: string,
): Promise<CollateralRecord> {
  const existing = await repo.getCollateralById(collateralId);
  if (!existing) {
    throw new NotFoundError('Collateral', collateralId);
  }

  if (existing.invoice_id !== null) {
    const hasAccess = await repo.validateInvoiceAccess(existing.invoice_id, userId, role);
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to this collateral');
    }
  }

  const fields: Record<string, unknown> = {};
  const oldValues: Record<string, unknown> = {};

  if (input.type !== undefined) {
    oldValues.collateral_type = existing.collateral_type;
    fields.collateral_type = input.type;
  }
  if (input.description !== undefined) {
    oldValues.description = existing.description;
    fields.description = input.description;
  }
  if (input.estimated_value !== undefined) {
    oldValues.value = existing.value;
    fields.value = input.estimated_value;
  }
  if (input.currency !== undefined) {
    oldValues.currency = existing.currency;
    fields.currency = input.currency;
  }
  if (input.expiry_date !== undefined) {
    oldValues.expiry_date = existing.expiry_date;
    fields.expiry_date = input.expiry_date;
  }

  let updated: CollateralRecord | null = existing;
  if (Object.keys(fields).length > 0) {
    updated = await repo.updateCollateral(collateralId, fields);
    if (!updated) {
      throw new NotFoundError('Collateral', collateralId);
    }
  }

  if (input.documents !== undefined) {
    await repo.replaceDocuments(collateralId, input.documents);
  }

  await repo.createAuditEntry(
    userId,
    'COLLATERAL_UPDATED',
    'collateral',
    collateralId,
    oldValues,
    fields,
    ipAddress,
    userAgent,
  );

  logger.info('Collateral updated', {
    component: 'collateral',
    collateralId,
    userId,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Soft delete collateral
// ---------------------------------------------------------------------------

/**
 * Soft delete collateral. Not allowed if invoice is 'funded'.
 */
export async function deleteCollateral(
  userId: string,
  role: string,
  collateralId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const existing = await repo.getCollateralById(collateralId);
  if (!existing) {
    throw new NotFoundError('Collateral', collateralId);
  }

  if (existing.invoice_id !== null) {
    const hasAccess = await repo.validateInvoiceAccess(existing.invoice_id, userId, role);
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to this collateral');
    }

    const invoice = await repo.getInvoiceStatus(existing.invoice_id);
    if (invoice && invoice.status === 'funded') {
      throw new BusinessRuleError(
        'COLLATERAL_DELETE_FUNDED',
        'Cannot delete collateral for a funded invoice',
      );
    }
  }

  await repo.softDelete(collateralId);

  await repo.createAuditEntry(
    userId,
    'COLLATERAL_DELETED',
    'collateral',
    collateralId,
    { value: existing.value, type: existing.collateral_type },
    { deleted_at: new Date().toISOString() },
    ipAddress,
    userAgent,
  );

  logger.info('Collateral soft deleted', {
    component: 'collateral',
    collateralId,
    userId,
  });
}

// ---------------------------------------------------------------------------
// Coverage check — used by payments module before disbursement
// ---------------------------------------------------------------------------

export interface CoverageCheckResult {
  totalCollateral: string;
  faceValue: string;
  ratio: number;
  sufficient: boolean;
}

/**
 * Check whether collateral coverage meets the minimum threshold.
 * Coverage ratio = totalCollateral / faceValue.
 * Threshold: 100% for post-dated cheques, 50% for all others.
 * Returns ratio and sufficiency flag.
 */
export async function checkCoverageRatio(
  invoiceId: string,
  faceValue: string,
): Promise<CoverageCheckResult> {
  const totalStr = await repo.getTotalCollateralValueForInvoice(invoiceId);
  const total = BigInt(totalStr);
  const face = BigInt(faceValue);

  if (face === 0n) {
    return { totalCollateral: totalStr, faceValue, ratio: 0, sufficient: false };
  }

  const ratio = Number((total * 10000n) / face) / 10000;
  const threshold = await getMinCoverageRatio();
  const sufficient = ratio >= threshold;

  return { totalCollateral: totalStr, faceValue, ratio, sufficient };
}

// ---------------------------------------------------------------------------
// Expiry alerts — scheduled job queues notifications
// ---------------------------------------------------------------------------

/**
 * Check for collateral expiring within the given windows (30d, 7d)
 * and queue notifications for each.
 */
export async function checkExpiryAlerts(): Promise<number> {
  const expiring30 = await repo.getExpiringCollateral(30);
  const expiring7 = await repo.getExpiringCollateral(7);

  let queued = 0;
  for (const item of expiring30) {
    await queueExpiryNotification(item, 30);
    queued++;
  }
  for (const item of expiring7) {
    const already30 = expiring30.some((c) => c.id === item.id);
    if (!already30) {
      await queueExpiryNotification(item, 7);
      queued++;
    }
  }

  logger.info('Collateral expiry check complete', {
    component: 'collateral',
    expiring30: expiring30.length,
    expiring7: expiring7.length,
    queued,
  });

  return queued;
}

async function queueExpiryNotification(
  collateral: CollateralRecord,
  daysUntilExpiry: number,
): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'collateral',
      collateralId: collateral.id,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'collateral_expiry_warning',
    {
      collateralId: collateral.id,
      invoiceId: collateral.invoice_id,
      supplierId: collateral.supplier_id,
      daysUntilExpiry,
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

// =========================================================================
// BullMQ Worker factory — collateral expiry check
// =========================================================================

interface ExpiryCheckPayload {
  trigger: string;
}

/**
 * Create a BullMQ Worker for the 'collateral-expiry-check' queue.
 * Runs checkExpiryAlerts daily to warn about expiring collateral.
 */
export function createCollateralExpiryWorker(redisUrl: string): Worker<ExpiryCheckPayload> {
  const worker = new Worker<ExpiryCheckPayload>(
    'collateral-expiry-check',
    withJobContext<ExpiryCheckPayload>(async () => {
      await checkExpiryAlerts();
    }),
    { connection: { url: redisUrl }, concurrency: 1 },
  );

  worker.on('completed', (job: Job<ExpiryCheckPayload>) => {
    logger.info('Collateral expiry check completed', {
      component: 'collateral',
      jobId: job.id,
    });
  });

  worker.on('failed', (job: Job<ExpiryCheckPayload> | undefined, err: Error) => {
    logger.error('Collateral expiry check failed', {
      component: 'collateral',
      jobId: job?.id,
      errorMessage: err.message,
    });
  });

  return worker;
}
