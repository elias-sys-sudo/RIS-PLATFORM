import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import * as service from './payments.service';

// =========================================================================
// POST /payments/:id/authorise
// =========================================================================

/**
 * Authorise a payment (first or second auth based on current status).
 */
export async function authoriseHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const ipAddress = req.ip ?? 'unknown';
    const userAgent = req.get('user-agent') ?? 'unknown';
    const rawComment = (req.body as { comment?: string } | undefined)?.comment ?? '';
    const comment = rawComment.trim().length > 0 ? rawComment.trim() : null;

    const payment = await service.getPaymentDetails(id);

    let result;
    if (payment.status === 'pending_first_auth') {
      result = await service.authoriseFirstAuth(id, userId, ipAddress, userAgent, comment);
    } else {
      result = await service.authoriseSecondAuth(id, userId, ipAddress, userAgent, comment);
    }

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /payments/pending
// =========================================================================

/**
 * Get payments pending authorisation.
 */
export async function getPendingHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await service.getPendingPayments();

    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /payments/:id
// =========================================================================

/**
 * Get payment details by ID.
 */
export async function getPaymentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;

    const data = await service.getPaymentDetails(id);

    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// Kill switch (REQ-PAYMENT-010)
// =========================================================================

/**
 * GET /payments/kill-switch — returns current state. management /
 * finance_manager / auditor are allowed to read.
 */
export async function getKillSwitchHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const active = await service.isKillSwitchActive();
    res.status(200).json({ active });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /payments/kill-switch/activate — management only. Body { reason }.
 * Halts payments and force-fails currently-executing rows in one transaction.
 */
export async function activateKillSwitchHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { reason } = req.body as { reason: string };

    const result = await service.activateKillSwitch(userId, reason, ip, ua);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /payments/kill-switch/deactivate — management only. Body { reason }.
 * Resumes new disbursements; previously-failed payments are NOT auto-retried.
 */
export async function deactivateKillSwitchHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { reason } = req.body as { reason: string };

    await service.deactivateKillSwitch(userId, reason, ip, ua);
    res.status(200).json({ active: false });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// BullMQ job handlers
// =========================================================================

/**
 * Process payment initiation from approval queue.
 */
export async function handleProcessPaymentJob(invoiceId: string): Promise<void> {
  logger.info('Processing payment job', {
    component: 'payments',
    invoiceId,
  });

  await service.initiatePayment(invoiceId);

  logger.info('Payment initiated', {
    component: 'payments',
    invoiceId,
  });
}

/**
 * Worker hook called once a process-payment job exhausts its BullMQ retries.
 * Delegates to the service-layer transaction; keeps the routes file free of
 * business logic per the module file pattern.
 */
export async function handleTerminalWorkerFailureJob(
  invoiceId: string,
  errorCode: string,
): Promise<void> {
  await service.handleTerminalWorkerFailure(invoiceId, errorCode);
}

/**
 * Process SLA breach check (called by scheduled BullMQ job).
 */
export async function handleSlaCheckJob(): Promise<void> {
  logger.info('Processing payment SLA check', {
    component: 'payments',
  });

  await service.checkSlaBreaches();

  logger.info('Payment SLA check complete', {
    component: 'payments',
  });
}
