// =============================================================================
// Payments — Orphaned Approved Invoices Service
// =============================================================================
// Surfaces invoices stuck in status='approved' with no `payments` row — the
// artefact of a BullMQ worker job that exhausted retries before createPaymentTxn
// ran. Read-only; no transaction. PII-free by repo contract.

import { logger } from '../../shared/logger';
import { RisError } from '../../shared/errors';
import * as repo from './payments.repository';
import { PaymentErrorCode, type OrphanedApprovedInvoice } from './payments.types';

/**
 * Fetch invoices stuck in 'approved' with no payment row (>5 min grace).
 */
export async function listOrphanedApprovedInvoices(): Promise<OrphanedApprovedInvoice[]> {
  try {
    return await repo.findOrphanedApprovedInvoices();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to query orphaned approved invoices', {
      component: 'payments',
      errorMessage,
    });
    throw new RisError(
      'Failed to query orphaned approved invoices',
      500,
      PaymentErrorCode.ORPHAN_QUERY_FAILED,
    );
  }
}
