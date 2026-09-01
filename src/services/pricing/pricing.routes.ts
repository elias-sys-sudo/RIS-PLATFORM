import { Router } from 'express';
import Joi from 'joi';
import { Worker, type Job } from 'bullmq';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { withJobContext } from '../../shared/workers/queue-helpers';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import { logger } from '../../shared/logger';
import {
  getPricingHandler,
  acceptPricingHandler,
  rejectPricingHandler,
  disputePricingHandler,
  generatePricingHandler,
  handlePriceInvoiceJob,
} from './pricing.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const invoiceIdParamSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const rejectPricingSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    reason: Joi.string().min(1).max(1000).required(),
  }),
};

const disputePricingSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    reason: Joi.string()
      .valid('rate_too_high', 'advance_too_low', 'tenor_mismatch', 'calculation_error', 'other')
      .required(),
    proposedRate: Joi.number().positive().max(100).optional(),
    proposedAdvancePct: Joi.number().positive().max(100).optional(),
    notes: Joi.string().max(2000).optional(),
  }),
};

// =========================================================================
// Express Router — GET /invoices/:id/pricing
// =========================================================================

const router = Router();

router.get(
  '/:id/pricing',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier', 'credit_officer', 'finance_manager', 'management']),
  validate(invoiceIdParamSchema),
  asyncHandler(getPricingHandler),
);

/**
 * POST /invoices/:id/pricing/generate — manually trigger pricing for a
 * scored invoice (synchronous). Use when the auto-queued job failed or
 * when staff want to re-run pricing after adjusting parameters. Surfaces
 * the failure reason directly (e.g. rate cap) rather than burying it in
 * worker logs.
 */
router.post(
  '/:id/pricing/generate',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(invoiceIdParamSchema),
  asyncHandler(generatePricingHandler),
);

router.post(
  '/:id/pricing/accept',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  validate(invoiceIdParamSchema),
  asyncHandler(acceptPricingHandler),
);

router.post(
  '/:id/pricing/reject',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  validate(rejectPricingSchema),
  asyncHandler(rejectPricingHandler),
);

router.post(
  '/:id/pricing/dispute',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  validate(disputePricingSchema),
  asyncHandler(disputePricingHandler),
);

// =========================================================================
// BullMQ Worker factory
// =========================================================================

interface PriceInvoicePayload {
  invoiceId: string;
}

/**
 * Create a BullMQ Worker for the 'price-invoice' queue.
 * Call once during server startup; close on shutdown.
 */
export function createPricingWorker(redisUrl: string): Worker<PriceInvoicePayload> {
  const worker = new Worker<PriceInvoicePayload>(
    'price-invoice',
    withJobContext<PriceInvoicePayload>(async (job: Job<PriceInvoicePayload>) => {
      await handlePriceInvoiceJob(job.data.invoiceId);
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<PriceInvoicePayload>) => {
    logger.info('Pricing job completed', {
      component: 'pricing',
      jobId: job.id,
      invoiceId: job.data.invoiceId,
    });
  });

  worker.on('failed', (job: Job<PriceInvoicePayload> | undefined, err: Error) => {
    logger.error('Pricing job failed', {
      component: 'pricing',
      jobId: job?.id,
      invoiceId: job?.data?.invoiceId,
      errorMessage: err.message,
    });
  });

  return worker;
}

export { router as pricingRouter };
