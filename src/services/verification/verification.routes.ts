import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import { buyerConfirmRateLimiter } from '../../shared/middleware/security';
import {
  getConfirmationPageHandler,
  confirmInvoiceHandler,
  raiseDisputeHandler,
  resendConfirmationHandler,
  listPendingConfirmationsHandler,
} from './verification.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const tokenParamSchema = {
  params: Joi.object({
    token: Joi.string().hex().length(64).required(),
  }),
};

const confirmBodySchema = {
  body: Joi.object({
    invoice_is_valid: Joi.boolean().valid(true).required(),
    amount_is_correct: Joi.boolean().valid(true).required(),
    due_date_is_correct: Joi.boolean().valid(true).required(),
    agrees_to_pay_ris: Joi.boolean().valid(true).required(),
  }),
};

const disputeBodySchema = {
  params: Joi.object({
    token: Joi.string().hex().length(64).required(),
  }),
  body: Joi.object({
    reason: Joi.string().min(1).max(2000).required(),
    dispute_type: Joi.string()
      .valid('incorrect_amount', 'incorrect_date', 'not_recognized', 'other')
      .optional(),
  }),
};

const invoiceIdParamSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const paginationQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
};

// =========================================================================
// Router
// =========================================================================

const router = Router();

// --- ADMIN routes (must be registered BEFORE wildcard :token routes) ---

router.post(
  '/admin/invoices/:id/resend-confirmation',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer']),
  validate(invoiceIdParamSchema),
  asyncHandler(resendConfirmationHandler),
);

router.get(
  '/admin/invoices/pending-confirmation',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer']),
  validate(paginationQuerySchema),
  asyncHandler(listPendingConfirmationsHandler),
);

// --- PUBLIC routes (token-authenticated, no JWT) ---

router.get('/:token', validate(tokenParamSchema), asyncHandler(getConfirmationPageHandler));

router.post(
  '/:token/confirm',
  buyerConfirmRateLimiter,
  validate(tokenParamSchema),
  validate(confirmBodySchema),
  asyncHandler(confirmInvoiceHandler),
);

router.post(
  '/:token/dispute',
  buyerConfirmRateLimiter,
  validate(disputeBodySchema),
  asyncHandler(raiseDisputeHandler),
);

export { router as verificationRouter };
