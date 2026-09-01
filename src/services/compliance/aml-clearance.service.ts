// =============================================================================
// AML Clearance — Business logic (no Express, no SQL)
// =============================================================================
// Implements the four blocking refinements from the compliance review:
//   1. Three columns written atomically inside a transaction (also CHECK'd
//      at the storage layer by migration 037).
//   2. Audit metadata allowlist — `reason` MUST NOT appear.
//   3. Re-clearance is rejected with ComplianceErrorCode.AML_ALREADY_CLEARED.
//   4. Detail-view decryption emits an AML_DETAIL_VIEWED audit entry.

import type { Queue } from 'bullmq';
import { pool, beginWithRls } from '../../shared/database/pool';
import { decrypt } from '../../shared/crypto';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import * as repo from './aml-clearance.repository';
import {
  ComplianceErrorCode,
  AmlAuditAction,
  type ClearAmlInput,
  type ClearAmlResult,
  type AmlQueueRow,
  type AmlDetailResponse,
} from './aml-clearance.types';

// =========================================================================
// Notification queue — set during server bootstrap
// =========================================================================

let notificationQueue: Queue | null = null;

/**
 * Set the notification queue. The clearance service enqueues a
 * `notify-finance-manager-aml-cleared` job after COMMIT so the payment
 * workflow can resume automatically.
 */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// =========================================================================
// Public API
// =========================================================================

/**
 * Clear an AML-flagged invoice. Compliance officer only — caller's middleware
 * has already enforced the role gate.
 *
 * Refinement 3: rejects if the invoice has already been cleared. The original
 * officer's identity is regulatorily immutable.
 */
export async function clearInvoice(
  invoiceId: string,
  officerId: string,
  input: ClearAmlInput,
  ipAddress: string,
  userAgent: string,
): Promise<ClearAmlResult> {
  const state = await repo.getInvoiceClearanceState(invoiceId);
  if (state === null) {
    throw new NotFoundError('Invoice', invoiceId);
  }
  guardClearanceEligible(state);

  const result = await applyClearanceTxn(invoiceId, officerId, input, ipAddress, userAgent);
  await queueClearedNotification(invoiceId);

  logger.audit('AML_CLEARED', {
    component: 'compliance',
    invoiceId,
    officerId,
  });

  return result;
}

/**
 * List the AML clearance queue. Returns ONLY non-PII columns
 * (refinement 4 — PDPA 2019 minimisation).
 */
export async function listQueue(): Promise<AmlQueueRow[]> {
  return repo.listAmlQueue();
}

/**
 * View detail for one invoice in the queue. Decrypts supplier and buyer
 * company names — and audit-logs the read event with action
 * AML_DETAIL_VIEWED (refinement 4).
 */
export async function getDetail(
  invoiceId: string,
  viewerId: string,
  viewerRole: string,
  ipAddress: string,
  userAgent: string,
): Promise<AmlDetailResponse> {
  const row = await repo.getAmlDetail(invoiceId);
  if (row === null) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  const supplierName = decryptSafe(row.supplier_company_name_encrypted);
  const buyerName = decryptSafe(row.buyer_company_name_encrypted);

  await repo.createAuditEntry(
    viewerId,
    AmlAuditAction.AML_DETAIL_VIEWED,
    'invoices',
    invoiceId,
    {},
    { invoice_id: invoiceId, viewer_id: viewerId, viewer_role: viewerRole },
    ipAddress,
    userAgent,
  );

  return {
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    supplier_id: row.supplier_id,
    buyer_id: row.buyer_id,
    supplier_company_name: supplierName,
    buyer_company_name: buyerName,
    face_value: row.face_value,
    aml_flagged: row.aml_flagged,
    aml_cleared_at: row.aml_cleared_at,
    aml_cleared_by: row.aml_cleared_by,
    aml_clearance_reason: row.aml_clearance_reason,
    status: row.status,
    created_at: row.created_at,
  };
}

// =========================================================================
// Private helpers (each ≤ 25 lines per Rule 10)
// =========================================================================

/**
 * Refinement 3 — reject re-clearance, and reject clearance of invoices
 * that were never AML-flagged in the first place.
 */
function guardClearanceEligible(state: {
  aml_flagged: boolean;
  aml_cleared_at: string | null;
}): void {
  if (!state.aml_flagged) {
    throw new BusinessRuleError(
      ComplianceErrorCode.INVOICE_NOT_FLAGGED,
      'Invoice is not AML-flagged and does not require clearance',
    );
  }
  if (state.aml_cleared_at !== null) {
    throw new BusinessRuleError(
      ComplianceErrorCode.AML_ALREADY_CLEARED,
      'Invoice has already been AML-cleared and cannot be re-cleared',
    );
  }
}

/**
 * Apply the three-column update + audit log inside a single transaction.
 * Per Rule 11 — BEGIN/COMMIT, ROLLBACK on error, client.release() in finally.
 */
async function applyClearanceTxn(
  invoiceId: string,
  officerId: string,
  input: ClearAmlInput,
  ipAddress: string,
  userAgent: string,
): Promise<ClearAmlResult> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    const updated = await repo.applyAmlClearanceWithClient(
      client,
      invoiceId,
      officerId,
      input.reason,
    );
    if (updated === null) {
      throw new BusinessRuleError(
        ComplianceErrorCode.AML_ALREADY_CLEARED,
        'Invoice has already been AML-cleared and cannot be re-cleared',
      );
    }

    await writeClearanceAudit(
      client,
      invoiceId,
      officerId,
      input.sanctions_check_complete,
      ipAddress,
      userAgent,
    );

    await client.query('COMMIT');
    return {
      invoice_id: invoiceId,
      aml_cleared_at: updated.aml_cleared_at,
      aml_cleared_by: officerId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Refinement 2 — audit metadata allowlist. The free-text `reason` MUST NOT
 * appear here; it is stored only in invoices.aml_clearance_reason.
 */
async function writeClearanceAudit(
  client: import('pg').PoolClient,
  invoiceId: string,
  officerId: string,
  sanctionsCheckComplete: boolean,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createAuditEntryWithClient(
    client,
    officerId,
    AmlAuditAction.AML_CLEARED,
    'invoices',
    invoiceId,
    {},
    {
      invoice_id: invoiceId,
      officer_id: officerId,
      threshold: process.env.AML_FLAG_THRESHOLD_UGX ?? '100000000',
      sanctions_check_complete: sanctionsCheckComplete,
    },
    ipAddress,
    userAgent,
  );
}

/**
 * Post-commit notification so the payment workflow can resume automatically.
 */
async function queueClearedNotification(invoiceId: string): Promise<void> {
  if (notificationQueue === null) {
    logger.warn('Notification queue not configured', {
      component: 'compliance',
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'notify-finance-manager-aml-cleared',
    { invoiceId, type: 'finance_manager_notify' },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
}

/**
 * Safely decrypt an encrypted PII column, returning empty string on failure.
 */
function decryptSafe(value: string | null): string {
  if (value === null || value === '') return '';
  try {
    return decrypt(value);
  } catch {
    logger.warn('PII decryption failed — field returned as empty', {
      component: 'compliance',
    });
    return '';
  }
}
