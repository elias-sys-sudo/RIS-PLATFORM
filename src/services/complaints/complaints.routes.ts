// ============================================================
// complaints.routes.ts — Router, middleware chain only. No logic.
// ============================================================
import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import {
  fileComplaintHandler,
  getComplaintHandler,
  listComplaintsHandler,
  updateComplaintHandler,
  resolveComplaintHandler,
  escalateComplaintHandler,
} from './complaints.controller';

const router = Router();

// =========================================================================
// Validation schemas
// =========================================================================

const createComplaintSchema = {
  body: Joi.object({
    entity_type: Joi.string().required().max(50),
    entity_id: Joi.string().uuid().optional(),
    subject: Joi.string().required().max(255),
    description: Joi.string().required().max(5000),
    category: Joi.string().valid('BILLING', 'SERVICE', 'PAYMENT', 'PRICING', 'GENERAL').required(),
    amount_involved: Joi.number().integer().min(0).optional(),
  }),
};

const complaintIdSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const updateComplaintSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    status: Joi.string().valid('OPEN', 'IN_PROGRESS', 'ESCALATED').optional(),
    priority: Joi.string().valid('LOW', 'NORMAL', 'HIGH', 'CRITICAL').optional(),
    assigned_to: Joi.string().uuid().optional(),
  }),
};

const resolveComplaintSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    resolution: Joi.string().required().max(5000),
  }),
};

const escalateComplaintSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    reason: Joi.string().required().max(2000),
  }),
};

const listComplaintsSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    status: Joi.string().valid('OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED').optional(),
    category: Joi.string().valid('BILLING', 'SERVICE', 'PAYMENT', 'PRICING', 'GENERAL').optional(),
  }),
};

// =========================================================================
// Routes
// =========================================================================

/** POST /complaints — supplier files a complaint. */
router.post(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  validate(createComplaintSchema),
  asyncHandler(fileComplaintHandler),
);

/** GET /complaints — list complaints (staff + supplier). */
router.get(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard([
    'supplier',
    'credit_officer',
    'finance_manager',
    'management',
    'compliance_officer',
  ]),
  validate(listComplaintsSchema),
  asyncHandler(listComplaintsHandler),
);

/** GET /complaints/:id — complaint detail (staff + supplier). */
router.get(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard([
    'supplier',
    'credit_officer',
    'finance_manager',
    'management',
    'compliance_officer',
  ]),
  validate(complaintIdSchema),
  asyncHandler(getComplaintHandler),
);

/** PUT /complaints/:id — update complaint (staff only). */
router.put(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(updateComplaintSchema),
  asyncHandler(updateComplaintHandler),
);

/** POST /complaints/:id/resolve — resolve complaint (staff only). */
router.post(
  '/:id/resolve',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(resolveComplaintSchema),
  asyncHandler(resolveComplaintHandler),
);

/** POST /complaints/:id/escalate — escalate complaint (staff only). */
router.post(
  '/:id/escalate',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate(escalateComplaintSchema),
  asyncHandler(escalateComplaintHandler),
);

export { router as complaintsRouter };
