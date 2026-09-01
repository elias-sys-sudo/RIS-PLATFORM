// ============================================================
// settlements.routes.ts — auth → role → validate → controller
// ============================================================

import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import {
  initiateHandler,
  repayFacilityHandler,
  bookProfitHandler,
  closeHandler,
  getHandler,
  listHandler,
  dashboardHandler,
} from './settlements.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const initiateSchema = {
  body: Joi.object({
    collection_id: Joi.string().uuid().required(),
    buyer_payment_amount: Joi.number().integer().positive().required(),
    penalty_income: Joi.number().integer().min(0).default(0),
  }),
};

const repayFacilitySchema = {
  body: Joi.object({
    facility_repayment_amount: Joi.number().integer().positive().required(),
    accrued_interest: Joi.number().integer().min(0).required(),
  }),
};

const bookProfitSchema = {
  body: Joi.object({
    discount_earned: Joi.number().integer().min(0).required(),
    bank_cost_paid: Joi.number().integer().min(0).required(),
  }),
};

const paginationSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const dashboardSchema = {
  query: Joi.object({
    period_start: Joi.string().isoDate().optional(),
    period_end: Joi.string().isoDate().optional(),
  }),
};

// =========================================================================
// Router
// =========================================================================

const router = Router();

// POST /settlements/:invoiceId/initiate — finance_manager
router.post(
  '/:invoiceId/initiate',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager']),
  validate(initiateSchema),
  asyncHandler(initiateHandler),
);

// POST /settlements/:id/repay-facility — finance_manager
router.post(
  '/:id/repay-facility',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager']),
  validate(repayFacilitySchema),
  asyncHandler(repayFacilityHandler),
);

// POST /settlements/:id/book-profit — finance_manager
router.post(
  '/:id/book-profit',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager']),
  validate(bookProfitSchema),
  asyncHandler(bookProfitHandler),
);

// POST /settlements/:id/close — management
router.post(
  '/:id/close',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management']),
  asyncHandler(closeHandler),
);

// GET /settlements/dashboard — aggregated metrics (REQ-SETTLE-008)
// Declared BEFORE /:id so the literal path wins over the UUID param.
router.get(
  '/dashboard',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'finance_manager', 'auditor']),
  validate(dashboardSchema),
  asyncHandler(dashboardHandler),
);

// GET /settlements/:id — finance_manager, management, auditor
router.get(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management', 'auditor']),
  asyncHandler(getHandler),
);

// GET /settlements — management, auditor
router.get(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'auditor', 'finance_manager']),
  validate(paginationSchema),
  asyncHandler(listHandler),
);

export default router;
