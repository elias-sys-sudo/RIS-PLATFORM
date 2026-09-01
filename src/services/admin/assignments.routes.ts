import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import {
  createAssignmentHandler,
  getMyQueueHandler,
  getAssignmentsByEntityHandler,
  removeAssignmentHandler,
} from './assignments.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const createAssignmentSchema = {
  body: Joi.object({
    entity_type: Joi.string().valid('supplier_kyc', 'invoice').required(),
    entity_id: Joi.string().uuid().required(),
    assigned_to: Joi.string().uuid().required(),
    notes: Joi.string().max(500).optional(),
  }),
};

const entityParamsSchema = {
  params: Joi.object({
    entity_type: Joi.string().valid('supplier_kyc', 'invoice').required(),
    entity_id: Joi.string().uuid().required(),
  }),
};

const assignmentIdSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

// =========================================================================
// Express Router
// =========================================================================

const router = Router();

router.post(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'credit_officer']),
  validate(createAssignmentSchema),
  asyncHandler(createAssignmentHandler),
);

router.get(
  '/my-queue',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'compliance_officer']),
  asyncHandler(getMyQueueHandler),
);

router.get(
  '/:entity_type/:entity_id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management', 'compliance_officer']),
  validate(entityParamsSchema),
  asyncHandler(getAssignmentsByEntityHandler),
);

router.delete(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management']),
  validate(assignmentIdSchema),
  asyncHandler(removeAssignmentHandler),
);

export { router as assignmentsRouter };
