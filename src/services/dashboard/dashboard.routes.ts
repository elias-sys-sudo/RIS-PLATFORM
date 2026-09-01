// =============================================================================
// Dashboard — Routes (Express router + auth/role/validation middleware)
// =============================================================================

import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import {
  summaryHandler,
  paymentHistoryHandler,
  dashboardPaymentsHandler,
  approvalQueueHandler,
  fundingPipelineHandler,
  supplierSummaryHandler,
  legalSummaryHandler,
  riskDistributionHandler,
} from './dashboard.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const summarySchema = {
  query: Joi.object({
    period: Joi.string().valid('7d', '30d', '90d', '12m', 'all').optional(),
  }).unknown(true),
};

const paymentHistorySchema = {
  query: Joi.object({
    supplier_id: Joi.string().uuid().required(),
    from: Joi.string().isoDate().optional(),
    to: Joi.string().isoDate().optional(),
    method: Joi.string().valid('EFT').optional(),
    min_amount: Joi.string().pattern(/^\d+$/).optional(),
    sort: Joi.string().valid('funded_at', 'amount').optional(),
    order: Joi.string().valid('asc', 'desc').optional(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }).unknown(true),
};

const dashboardPaymentsSchema = {
  query: Joi.object({
    status: Joi.string().optional(),
    method: Joi.string().valid('EFT').optional(),
    direction: Joi.string().valid('inbound', 'outbound').optional(),
    from: Joi.string().isoDate().optional(),
    to: Joi.string().isoDate().optional(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }).unknown(true),
};

const periodOnlySchema = {
  query: Joi.object({
    period: Joi.string().valid('7d', '30d', '90d', '12m', 'all').optional(),
  }).unknown(true),
};

// =========================================================================
// Role guard sets
// =========================================================================

const approvalPipelineRoles = createRoleGuard(['credit_officer', 'finance_manager', 'management']);

const supplierOnly = createRoleGuard(['supplier']);

const legalRoles = createRoleGuard(['legal', 'compliance_officer', 'management']);

// =========================================================================
// Express Router
// =========================================================================

const router = Router();

// GET /dashboard/summary — any authenticated user
router.get(
  '/summary',
  asyncHandler(authenticateJwt),
  validate(summarySchema),
  asyncHandler(summaryHandler),
);

// GET /dashboard/payments — payment history with filters
router.get(
  '/payments',
  asyncHandler(authenticateJwt),
  validate(dashboardPaymentsSchema),
  asyncHandler(dashboardPaymentsHandler),
);

// GET /dashboard/approval-queue — top 5 invoices awaiting auth
router.get(
  '/approval-queue',
  asyncHandler(authenticateJwt),
  approvalPipelineRoles,
  asyncHandler(approvalQueueHandler),
);

// GET /dashboard/funding-pipeline — approved invoices waiting to be funded
router.get(
  '/funding-pipeline',
  asyncHandler(authenticateJwt),
  approvalPipelineRoles,
  asyncHandler(fundingPipelineHandler),
);

// GET /dashboard/supplier/summary — supplier-specific dashboard
router.get(
  '/supplier/summary',
  asyncHandler(authenticateJwt),
  supplierOnly,
  validate(periodOnlySchema),
  asyncHandler(supplierSummaryHandler),
);

// GET /dashboard/legal/summary — SAR flagged + tier 3 escalations
router.get(
  '/legal/summary',
  asyncHandler(authenticateJwt),
  legalRoles,
  asyncHandler(legalSummaryHandler),
);

// GET /dashboard/risk-distribution — invoices grouped by risk level
router.get(
  '/risk-distribution',
  asyncHandler(authenticateJwt),
  validate(periodOnlySchema),
  asyncHandler(riskDistributionHandler),
);

// =========================================================================
// Payment history router (mounted at /payments in server.ts)
// =========================================================================

const paymentHistoryRouter = Router();

// GET /payments?supplier_id=xxx — requires auth
paymentHistoryRouter.get(
  '/',
  asyncHandler(authenticateJwt),
  validate(paymentHistorySchema),
  asyncHandler(paymentHistoryHandler),
);

export { router as dashboardRouter, paymentHistoryRouter };
