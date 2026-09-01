import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import * as service from './approvals.service';

// =========================================================================
// POST /invoices/:id/approve
// =========================================================================

/**
 * Approve an invoice (credit_officer or management).
 */
export async function approveHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { comments, credit_memo, review_summary } = req.body as {
      comments?: string;
      credit_memo?: string;
      review_summary?: string;
    };

    const result = await service.approveInvoice(
      id,
      userId,
      role,
      ip,
      ua,
      comments,
      credit_memo,
      review_summary,
    );

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /invoices/:id/reject
// =========================================================================

/**
 * Reject an invoice (credit_officer or management).
 */
export async function rejectHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { comments, credit_memo, review_summary } = req.body as {
      comments: string;
      credit_memo?: string;
      review_summary?: string;
    };

    const result = await service.rejectInvoice(
      id,
      userId,
      role,
      ip,
      ua,
      comments,
      credit_memo,
      review_summary,
    );

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /approvals/queue
// =========================================================================

/**
 * Get the approval queue for the current officer.
 */
export async function getQueueHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';

    const data = await service.getApprovalQueue(userId);

    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// BullMQ job handler — SLA monitoring
// =========================================================================

/**
 * Process SLA breach check (called by scheduled BullMQ job).
 */
export async function handleSlaCheckJob(): Promise<void> {
  logger.info('Processing SLA check job', {
    component: 'approvals',
  });

  await service.checkSlaBreaches();

  logger.info('SLA check complete', {
    component: 'approvals',
  });
}
