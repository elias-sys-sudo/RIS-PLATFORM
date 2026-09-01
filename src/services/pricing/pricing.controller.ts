import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import * as service from './pricing.service';
import type { PricingDisputePayload } from './pricing.types';

// =========================================================================
// BullMQ job handler (called by Worker, NOT an Express handler)
// =========================================================================

/**
 * Process a 'price-invoice' BullMQ job.
 */
export async function handlePriceInvoiceJob(invoiceId: string): Promise<void> {
  logger.info('Processing pricing job', {
    component: 'pricing',
    invoiceId,
  });

  await service.priceInvoice(invoiceId);

  logger.info('Pricing complete', {
    component: 'pricing',
    invoiceId,
  });
}

// =========================================================================
// Express handler — POST /invoices/:id/pricing/generate
// =========================================================================

/**
 * Manually trigger pricing for a scored invoice. Synchronous (not via BullMQ
 * queue) so the caller can immediately surface success or the failure reason
 * (e.g. "Total annual rate exceeds maximum"). Useful when the auto-queued
 * pricing job exhausted retries, or when staff want to re-run pricing after
 * adjusting risk parameters.
 *
 * Role-gated to credit_officer / finance_manager / management. Service layer
 * enforces invoice.status === 'scored'.
 */
export async function generatePricingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const result = await service.priceInvoice(invoiceId);
    res.status(200).json({
      invoiceId: result.invoiceId,
      message: 'Pricing generated',
      pricing: result,
    });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// Express handler — POST /invoices/:id/pricing/accept
// =========================================================================

/**
 * Supplier accepts pricing terms for their invoice.
 */
export async function acceptPricingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const ipAddress = req.ip ?? '';
    const userAgent = req.get('user-agent') ?? '';
    await service.acceptPricing(id, userId, ipAddress, userAgent);
    res.status(200).json({ message: 'Pricing accepted' });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// Express handler — POST /invoices/:id/pricing/reject
// =========================================================================

/**
 * Supplier rejects pricing terms for their invoice.
 */
export async function rejectPricingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const ipAddress = req.ip ?? '';
    const userAgent = req.get('user-agent') ?? '';
    const { reason } = req.body as { reason: string };
    await service.rejectPricing(id, userId, reason, ipAddress, userAgent);
    res.status(200).json({ message: 'Pricing rejected' });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// Express handler — POST /invoices/:id/pricing/dispute
// =========================================================================

/**
 * Supplier raises a structured pricing concern.
 * Invoice stays in 'priced' status and remains eligible for funding.
 */
export async function disputePricingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const ipAddress = req.ip ?? '';
    const userAgent = req.get('user-agent') ?? '';
    const payload = req.body as PricingDisputePayload;
    const dispute = await service.disputePricing(id, userId, payload, ipAddress, userAgent);
    res.status(201).json(dispute);
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// Express handler — GET /invoices/:id/pricing
// =========================================================================

/**
 * Return the pricing breakdown for a specific invoice.
 */
export async function getPricingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const pricing = await service.getPricing(id);
    res.status(200).json(pricing);
  } catch (err) {
    next(err);
  }
}
