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
  listFacilitiesHandler,
  dashboardHandler,
  getFacilityHandler,
  drawdownHandler,
  repayHandler,
  handleInterestAccrualJob,
  handleUtilisationCheckJob,
} from './facilities.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const drawdownSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    invoiceId: Joi.string().uuid().required(),
    principal: Joi.string()
      .pattern(/^\d+$/)
      .required()
      .messages({ 'string.pattern.base': 'principal must be a positive integer string' }),
    bankFees: Joi.string()
      .pattern(/^\d+$/)
      .required()
      .messages({ 'string.pattern.base': 'bankFees must be a positive integer string' }),
    invoiceDueDate: Joi.string().isoDate().required(),
  }),
};

const repaySchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    drawdownId: Joi.string().uuid().required(),
  }),
};

// =========================================================================
// Express Router
// =========================================================================

const router = Router();

router.get(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management']),
  asyncHandler(listFacilitiesHandler),
);

router.get(
  '/dashboard',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management']),
  asyncHandler(dashboardHandler),
);

// GET /facilities/:id — facility detail with drawdowns + repayments.
// Declared after the literal `/dashboard` path so that path wins over `/:id`.
const facilityIdSchema = {
  params: Joi.object({ id: Joi.string().uuid().required() }),
};

router.get(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management']),
  validate(facilityIdSchema),
  asyncHandler(getFacilityHandler),
);

router.post(
  '/:id/drawdown',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager']),
  validate(drawdownSchema),
  asyncHandler(drawdownHandler),
);

router.post(
  '/:id/repay',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager']),
  validate(repaySchema),
  asyncHandler(repayHandler),
);

// =========================================================================
// BullMQ Worker factory — Interest accrual (midnight Africa/Nairobi)
// =========================================================================

interface AccrualPayload {
  trigger: string;
}

/**
 * Create a BullMQ Worker for the 'facility-interest-accrual' queue.
 */
export function createInterestAccrualWorker(redisUrl: string): Worker<AccrualPayload> {
  const worker = new Worker<AccrualPayload>(
    'facility-interest-accrual',
    withJobContext<AccrualPayload>(async () => {
      await handleInterestAccrualJob();
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<AccrualPayload>) => {
    logger.info('Interest accrual job completed', {
      component: 'facilities',
      jobId: job.id,
    });
  });

  worker.on('failed', (job: Job<AccrualPayload> | undefined, err: Error) => {
    logger.error('Interest accrual job failed', {
      component: 'facilities',
      jobId: job?.id,
      errorMessage: err.message,
    });
  });

  return worker;
}

// =========================================================================
// BullMQ Worker factory — Utilisation / maturity checks
// =========================================================================

interface UtilCheckPayload {
  trigger: string;
}

/**
 * Create a BullMQ Worker for the 'facility-utilisation-check' queue.
 */
export function createUtilisationCheckWorker(redisUrl: string): Worker<UtilCheckPayload> {
  const worker = new Worker<UtilCheckPayload>(
    'facility-utilisation-check',
    withJobContext<UtilCheckPayload>(async () => {
      await handleUtilisationCheckJob();
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<UtilCheckPayload>) => {
    logger.info('Utilisation check job completed', {
      component: 'facilities',
      jobId: job.id,
    });
  });

  worker.on('failed', (job: Job<UtilCheckPayload> | undefined, err: Error) => {
    logger.error('Utilisation check job failed', {
      component: 'facilities',
      jobId: job?.id,
      errorMessage: err.message,
    });
  });

  return worker;
}

export { router as facilitiesRouter };
