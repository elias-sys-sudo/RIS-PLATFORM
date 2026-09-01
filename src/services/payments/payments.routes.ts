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
  authoriseHandler,
  getPendingHandler,
  getPaymentHandler,
  handleProcessPaymentJob,
  handleTerminalWorkerFailureJob,
  handleSlaCheckJob,
  getKillSwitchHandler,
  activateKillSwitchHandler,
  deactivateKillSwitchHandler,
} from './payments.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const authoriseSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    // Optional finance-manager note captured in the audit log. Trimmed in the
    // controller — empty / whitespace-only strings are stored as null.
    comment: Joi.string().trim().max(1000).allow('').optional(),
  })
    .optional()
    .default({}),
};

const paymentIdSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

// =========================================================================
// Express Router
// =========================================================================

const router = Router();

// POST /payments/:id/authorise — finance_manager only
router.post(
  '/:id/authorise',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager']),
  validate(authoriseSchema),
  asyncHandler(authoriseHandler),
);

// GET /payments/pending — finance_manager, management, legal (read-only)
router.get(
  '/pending',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management', 'legal']),
  asyncHandler(getPendingHandler),
);

// =========================================================================
// REQ-PAYMENT-010 — Payment kill switch
// Declared BEFORE /:id so the literal paths win over the UUID param.
// =========================================================================

const killSwitchToggleSchema = {
  body: Joi.object({
    reason: Joi.string().min(20).max(1000).required(),
  }),
};

// GET /payments/kill-switch — management / finance_manager / auditor
router.get(
  '/kill-switch',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'finance_manager', 'auditor']),
  asyncHandler(getKillSwitchHandler),
);

// POST /payments/kill-switch/activate — management only
router.post(
  '/kill-switch/activate',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management']),
  validate(killSwitchToggleSchema),
  asyncHandler(activateKillSwitchHandler),
);

// POST /payments/kill-switch/deactivate — management only
router.post(
  '/kill-switch/deactivate',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management']),
  validate(killSwitchToggleSchema),
  asyncHandler(deactivateKillSwitchHandler),
);

// GET /payments/:id — finance_manager, management, legal (read-only)
router.get(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management', 'legal']),
  validate(paymentIdSchema),
  asyncHandler(getPaymentHandler),
);

// =========================================================================
// BullMQ Worker factories
// =========================================================================

interface ProcessPaymentPayload {
  invoiceId: string;
}

/**
 * Create a BullMQ Worker for the 'process-payment' queue.
 * Listens for approved invoices and initiates payment.
 */
export function createPaymentWorker(redisUrl: string): Worker<ProcessPaymentPayload> {
  const worker = new Worker<ProcessPaymentPayload>(
    'process-payment',
    withJobContext<ProcessPaymentPayload>(async (job: Job<ProcessPaymentPayload>) => {
      await handleProcessPaymentJob(job.data.invoiceId);
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<ProcessPaymentPayload>) => {
    logger.info('Payment processing job completed', {
      component: 'payments',
      jobId: job.id,
      invoiceId: job.data.invoiceId,
    });
  });

  worker.on('failed', (job: Job<ProcessPaymentPayload> | undefined, err: Error) => {
    const maxAttempts = job?.opts?.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    const isTerminal = attemptsMade >= maxAttempts;

    logger.error('Payment processing job failed', {
      component: 'payments',
      jobId: job?.id,
      invoiceId: job?.data?.invoiceId,
      errorMessage: err.message,
      attemptsMade,
      maxAttempts,
      terminal: isTerminal,
    });

    if (!isTerminal || !job?.data?.invoiceId) {
      return;
    }
    const errorCode = (err as { code?: string }).code ?? 'WORKER_EXHAUSTED';
    handleTerminalWorkerFailureJob(job.data.invoiceId, errorCode).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : 'unknown';
      logger.error('Terminal worker failure handler failed', {
        component: 'payments',
        invoiceId: job.data.invoiceId,
        errorMessage: message,
      });
    });
  });

  return worker;
}

interface SlaCheckPayload {
  trigger: string;
}

/**
 * Create a BullMQ Worker for the 'payment-sla-check' queue.
 * Runs every 30 minutes to check for SLA breaches.
 */
export function createPaymentSlaWorker(redisUrl: string): Worker<SlaCheckPayload> {
  const worker = new Worker<SlaCheckPayload>(
    'payment-sla-check',
    withJobContext<SlaCheckPayload>(async () => {
      await handleSlaCheckJob();
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<SlaCheckPayload>) => {
    logger.info('Payment SLA check completed', {
      component: 'payments',
      jobId: job.id,
    });
  });

  worker.on('failed', (job: Job<SlaCheckPayload> | undefined, err: Error) => {
    logger.error('Payment SLA check failed', {
      component: 'payments',
      jobId: job?.id,
      errorMessage: err.message,
    });
  });

  return worker;
}

export { router as paymentsRouter };
