import { Router } from 'express';
import Joi from 'joi';
import { Worker, type Job } from 'bullmq';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { withJobContext } from '../../shared/workers/queue-helpers';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import { logger } from '../../shared/logger';
import { getRiskScoreHandler, handleScoreInvoiceJob } from './risk-engine.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const invoiceIdParamSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

// =========================================================================
// Express Router — GET /invoices/:id/risk-score
// =========================================================================

const router = Router();

router.get(
  '/:id/risk-score',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management']),
  validate(invoiceIdParamSchema),
  asyncHandler(getRiskScoreHandler),
);

// =========================================================================
// BullMQ Worker factory
// =========================================================================

/**
 * Create a BullMQ Worker for the 'score-invoice' queue.
 * Call once during server startup; close on shutdown.
 */
interface ScoreInvoicePayload {
  invoiceId: string;
}

export function createRiskScoringWorker(redisUrl: string): Worker<ScoreInvoicePayload> {
  const worker = new Worker<ScoreInvoicePayload>(
    'score-invoice',
    withJobContext<ScoreInvoicePayload>(async (job: Job<ScoreInvoicePayload>) => {
      await handleScoreInvoiceJob(job.data.invoiceId);
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<ScoreInvoicePayload>) => {
    logger.info('Risk scoring job completed', {
      component: 'risk-engine',
      jobId: job.id,
      invoiceId: job.data.invoiceId,
    });
  });

  worker.on('failed', (job: Job<ScoreInvoicePayload> | undefined, err: Error) => {
    logger.error('Risk scoring job failed', {
      component: 'risk-engine',
      jobId: job?.id,
      invoiceId: job?.data?.invoiceId,
      errorMessage: err.message,
    });
  });

  return worker;
}

export { router as riskEngineRouter };
