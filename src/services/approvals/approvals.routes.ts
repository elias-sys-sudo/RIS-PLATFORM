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
  approveHandler,
  rejectHandler,
  getQueueHandler,
  handleSlaCheckJob,
} from './approvals.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const approveSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    comments: Joi.string().min(20).max(2000).required(),
    credit_memo: Joi.string().min(50).max(5000).optional(),
    // G10 — case summary writeup. Enforced per-tier in the service.
    review_summary: Joi.string().min(30).max(5000).optional(),
  }),
};

const rejectSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    comments: Joi.string().min(20).max(2000).required(),
    reason: Joi.string().max(500).optional(),
    credit_memo: Joi.string().min(50).max(5000).optional(),
    review_summary: Joi.string().min(30).max(5000).optional(),
  }),
};

// =========================================================================
// Express Router
// =========================================================================

const router = Router();

router.post(
  '/:id/approve',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management']),
  validate(approveSchema),
  asyncHandler(approveHandler),
);

router.post(
  '/:id/reject',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management']),
  validate(rejectSchema),
  asyncHandler(rejectHandler),
);

router.get(
  '/queue',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management', 'legal']),
  asyncHandler(getQueueHandler),
);

// =========================================================================
// BullMQ Worker factory — SLA monitoring
// =========================================================================

interface SlaCheckPayload {
  trigger: string;
}

/**
 * Create a BullMQ Worker for the 'approval-sla-check' queue.
 * Call once during server startup; close on shutdown.
 */
export function createApprovalSlaWorker(redisUrl: string): Worker<SlaCheckPayload> {
  const worker = new Worker<SlaCheckPayload>(
    'approval-sla-check',
    withJobContext<SlaCheckPayload>(async () => {
      await handleSlaCheckJob();
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<SlaCheckPayload>) => {
    logger.info('SLA check job completed', {
      component: 'approvals',
      jobId: job.id,
    });
  });

  worker.on('failed', (job: Job<SlaCheckPayload> | undefined, err: Error) => {
    logger.error('SLA check job failed', {
      component: 'approvals',
      jobId: job?.id,
      errorMessage: err.message,
    });
  });

  return worker;
}

export { router as approvalsRouter };
