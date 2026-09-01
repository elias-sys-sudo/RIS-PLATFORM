import { Router } from 'express';
import Joi from 'joi';
import { Worker, type Job } from 'bullmq';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { enqueueWithContext, withJobContext } from '../../shared/workers/queue-helpers';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import { logger } from '../../shared/logger';
import {
  getOverdueHandler,
  recordPaymentHandler,
  getPenaltyHandler,
  handleReminderJob,
  listCollectionsHandler,
  getCollectionDetailHandler,
  recordCollectionPaymentHandler,
  escalateHandler,
  deescalateHandler,
  resolveHandler,
  generateDraftHandler,
  updateDraftHandler,
  sendDocumentHandler,
  downloadDocumentHandler,
  listDocumentsHandler,
} from './collections.controller';
import { getNotificationQueueRef } from './collections.service';

// =========================================================================
// Joi Schemas
// =========================================================================

const recordPaymentSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    amount: Joi.string()
      .pattern(/^\d+$/)
      .required()
      .messages({ 'string.pattern.base': 'amount must be a whole number string' }),
    paymentDate: Joi.string().isoDate().required(),
    paymentMethod: Joi.string().valid('bank_transfer', 'cash', 'cheque').required(),
    paidBy: Joi.string().max(255).required(),
    paymentReference: Joi.string().max(255).optional(),
    notes: Joi.string().optional(),
  }),
};

const penaltyParamsSchema = {
  params: Joi.object({
    invoiceId: Joi.string().uuid().required(),
  }),
};

const listCollectionsSchema = {
  query: Joi.object({
    status: Joi.string()
      .valid('pending', 'overdue', 'escalated', 'collected', 'bad_debt', 'collecting', 'defaulted')
      .optional(),
    escalation_level: Joi.string().valid('none', 'reminder', 'formal', 'legal').optional(),
    days_overdue_min: Joi.number().integer().min(0).optional(),
    days_overdue_max: Joi.number().integer().min(0).optional(),
    search: Joi.string().max(255).optional(),
    sort_by: Joi.string()
      .valid(
        'invoice_number',
        'buyer_name',
        'face_value',
        'outstanding_amount',
        'days_overdue',
        'escalation_level',
        'last_payment_date',
        'due_date',
      )
      .optional(),
    sort_dir: Joi.string().valid('asc', 'desc').optional(),
    page: Joi.number().integer().min(1).optional(),
    page_size: Joi.number().integer().min(1).max(100).optional(),
  }),
};

const collectionIdParamsSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const frontendPaymentSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    amount: Joi.number().integer().positive().required(),
    method: Joi.string().valid('bank_transfer', 'cash', 'cheque').required(),
    reference: Joi.string().max(255).optional(),
    paid_by: Joi.string().max(255).required(),
    payment_date: Joi.string().isoDate().required(),
    notes: Joi.string().optional(),
  }),
};

const escalateSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    reason: Joi.string().min(1).max(1000).required(),
  }),
};

const deescalateSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    reason: Joi.string().min(1).max(1000).required(),
  }),
};

const resolveSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const generateDraftSchema = {
  params: Joi.object({ id: Joi.string().uuid().required() }),
  body: Joi.object({
    document_type: Joi.string()
      .valid('demand_letter', 'legal_notice', 'reminder_letter')
      .required(),
  }),
};

const updateDraftSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
    docId: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    deadline_days: Joi.number().integer().min(7).max(90).optional(),
    additional_notes: Joi.string().max(2000).allow('').optional(),
  }),
};

const documentParamsSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
    docId: Joi.string().uuid().required(),
  }),
};

// =========================================================================
// Express Router
// =========================================================================

const router = Router();

// -- Frontend-aligned endpoints (must come before parameterised routes) --

router.get(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management', 'legal']),
  validate(listCollectionsSchema),
  asyncHandler(listCollectionsHandler),
);

// -- Legacy endpoints --

router.get(
  '/overdue',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management', 'legal']),
  asyncHandler(getOverdueHandler),
);

router.get(
  '/:invoiceId/penalty',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management', 'legal']),
  validate(penaltyParamsSchema),
  asyncHandler(getPenaltyHandler),
);

// -- Escalation document endpoints (before /:id to avoid route shadowing) --

router.post(
  '/:id/documents/draft',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(generateDraftSchema),
  asyncHandler(generateDraftHandler),
);

router.get(
  '/:id/documents',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(collectionIdParamsSchema),
  asyncHandler(listDocumentsHandler),
);

router.get(
  '/:id/documents/:docId',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(documentParamsSchema),
  asyncHandler(downloadDocumentHandler),
);

router.patch(
  '/:id/documents/:docId',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager']),
  validate(updateDraftSchema),
  asyncHandler(updateDraftHandler),
);

router.post(
  '/:id/documents/:docId/send',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(documentParamsSchema),
  asyncHandler(sendDocumentHandler),
);

// -- Frontend-aligned detail + actions --

router.get(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management', 'legal']),
  validate(collectionIdParamsSchema),
  asyncHandler(getCollectionDetailHandler),
);

router.post(
  '/:id/payments',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager']),
  validate(frontendPaymentSchema),
  asyncHandler(recordCollectionPaymentHandler),
);

router.post(
  '/:id/escalate',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(escalateSchema),
  asyncHandler(escalateHandler),
);

router.post(
  '/:id/de-escalate',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(deescalateSchema),
  asyncHandler(deescalateHandler),
);

router.post(
  '/:id/resolve',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(resolveSchema),
  asyncHandler(resolveHandler),
);

// -- Legacy record-payment --

router.post(
  '/:id/record-payment',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager']),
  validate(recordPaymentSchema),
  asyncHandler(recordPaymentHandler),
);

// =========================================================================
// BullMQ Worker factory — Collection reminders
// =========================================================================

interface ReminderJobPayload {
  trigger: string;
}

/**
 * Create a BullMQ Worker for the 'collection-reminders' queue.
 * Call once during server startup; close on shutdown.
 */
export function createCollectionReminderWorker(redisUrl: string): Worker<ReminderJobPayload> {
  const worker = new Worker<ReminderJobPayload>(
    'collection-reminders',
    withJobContext<ReminderJobPayload>(async () => {
      await handleReminderJob();
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<ReminderJobPayload>) => {
    logger.info('Collection reminder job completed', {
      component: 'collections',
      jobId: job.id,
    });
  });

  worker.on('failed', (job: Job<ReminderJobPayload> | undefined, err: Error) => {
    logger.error('Collection reminder job failed', {
      component: 'collections',
      jobId: job?.id,
      errorMessage: err.message,
    });

    // Notify finance_manager on final failure (all retries exhausted)
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      const notifQueue = getNotificationQueueRef();
      if (notifQueue) {
        void enqueueWithContext(
          notifQueue,
          'collection-job-failure',
          {
            jobId: job.id,
            errorMessage: err.message,
            notifyRole: 'finance_manager',
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30000 },
          },
        );
      }
    }
  });

  return worker;
}

export { router as collectionsRouter };
