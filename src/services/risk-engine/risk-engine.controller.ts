import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import * as service from './risk-engine.service';

// =========================================================================
// BullMQ job handler (called by Worker, NOT an Express handler)
// =========================================================================

/**
 * Process a 'score-invoice' BullMQ job.
 */
export async function handleScoreInvoiceJob(invoiceId: string): Promise<void> {
  logger.info('Processing risk scoring job', {
    component: 'risk-engine',
    invoiceId,
  });

  await service.scoreInvoice(invoiceId);

  logger.info('Risk scoring complete', {
    component: 'risk-engine',
    invoiceId,
  });
}

// =========================================================================
// Express handler — GET /invoices/:id/risk-score
// =========================================================================

/**
 * Return the risk score for a specific invoice.
 */
export async function getRiskScoreHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const score = await service.getRiskScore(id);
    res.status(200).json(score);
  } catch (err) {
    next(err);
  }
}
