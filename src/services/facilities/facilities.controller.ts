import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import * as service from './facilities.service';

// =========================================================================
// GET /facilities
// =========================================================================

/**
 * List all active bank facilities.
 */
export async function listFacilitiesHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await service.getActiveFacilities();
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /facilities/:id
// =========================================================================

/**
 * Get a single facility with its drawdowns and repayments.
 */
export async function getFacilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const detail = await service.getFacilityDetail(id);
    res.status(200).json({ data: detail });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /facilities/dashboard
// =========================================================================

/**
 * Get the facility utilisation dashboard.
 */
export async function dashboardHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dashboard = await service.getDashboard();
    res.status(200).json(dashboard);
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /facilities/:id/drawdown
// =========================================================================

/**
 * Create a drawdown against a facility.
 */
export async function drawdownHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { invoiceId, principal, bankFees, invoiceDueDate } = req.body as {
      invoiceId: string;
      principal: string;
      bankFees: string;
      invoiceDueDate: string;
    };

    const result = await service.createDrawdown(
      id,
      invoiceId,
      principal,
      bankFees,
      invoiceDueDate,
      userId,
      ip,
      ua,
    );

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /facilities/:id/repay
// =========================================================================

/**
 * Process a repayment for a facility drawdown.
 */
export async function repayHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { drawdownId } = req.body as { drawdownId: string };

    const result = await service.processRepayment(id, drawdownId, userId, ip, ua);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// BullMQ job handlers
// =========================================================================

/**
 * Process daily interest accrual (called by scheduled BullMQ job).
 */
export async function handleInterestAccrualJob(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  logger.info('Processing interest accrual job', {
    component: 'facilities',
    accrualDate: today,
  });

  await service.accrueInterest(today);

  logger.info('Interest accrual complete', {
    component: 'facilities',
  });
}

/**
 * Process utilisation check (called by scheduled BullMQ job).
 */
export async function handleUtilisationCheckJob(): Promise<void> {
  logger.info('Processing utilisation check', {
    component: 'facilities',
  });

  await service.checkUtilisationAlerts();
  await service.checkMaturityAlerts();

  logger.info('Utilisation check complete', {
    component: 'facilities',
  });
}
